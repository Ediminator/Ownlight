import 'server-only';
import crypto from 'node:crypto';
import { eq, desc, asc } from 'drizzle-orm';
import type { Transporter } from 'nodemailer';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';
import { getLeadById, updateLeadAutoReplyStatus } from '@/server/leads/repo';
import { inquiryFormNoticeVersions } from '@/server/db/schema/inquiry-forms';
import { getStudioSettings } from '@/server/settings/repo';
import { checkRateLimit, consumeRateLimit } from '@/server/auth/rate-limiter';
import {
  calculateNextAttemptDate,
  isTerminalRetry,
  type BackoffOptions,
} from '@/server/jobs/backoff';
import { sendEmail } from '@/server/auth/email';
import {
  fetchPendingEmailOutboxBatch,
  markEmailOutboxProcessing,
  deleteEmailOutboxItem,
  updateEmailOutboxRetry,
} from './outbox';
import { renderAutoReplyEmail } from './templates';
import { appointments } from '@/server/db/schema/calendar';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { leads } from '@/server/db/schema/leads';
import { proposals } from '@/server/db/schema/proposals';
import {
  renderAppointmentConfirmationEmail,
  renderAppointmentCancellationEmail,
  getAppointmentEmailHeaders,
} from './templates/appointment';
import {
  renderProposalSentEmail,
  renderProposalAcceptedClientEmail,
  renderProposalAcceptedOwnerEmail,
  getProposalEmailHeaders,
} from './templates';
import { getAcceptedProposalForProject } from '@/server/proposals/accepted-summary';

export interface EmailOutboxBatchOptions {
  batchSize?: number;
  dbClient?: DbClient;
  transporter?: Transporter;
  backoffOptions?: BackoffOptions;
  signal?: AbortSignal;
}

export interface EmailOutboxBatchResult {
  batchSize: number;
  processedCount: number;
  sentCount: number;
  suppressedCount: number;
  failedCount: number;
}

/**
 * Sanitizes SMTP / network error strings before storing in last_error or logs.
 * Strips recipient email addresses, URLs, credentials, and message content (ADR-0015 §12).
 */
export function sanitizeOutboxError(rawError: string, fallbackClass = 'SmtpError'): string {
  if (!rawError || typeof rawError !== 'string') {
    return fallbackClass;
  }

  const redacted = rawError
    // Redact email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    // Redact URLs
    .replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]')
    // Redact potential password / auth values
    .replace(/(?:password|pass|secret|token|key)[:=]\s*[^\s]+/gi, '$1=[REDACTED]');

  return redacted.slice(0, 500);
}

/**
 * Worker job processor for transactional email outbox (TASK-0030).
 * Processes batches of PENDING outbox items, enforces anti-abuse caps,
 * renders plain-text templates, sends via SMTP, and records audit events.
 */
export async function processEmailOutboxBatch(
  options: EmailOutboxBatchOptions = {},
): Promise<EmailOutboxBatchResult> {
  const dbClient = options.dbClient ?? defaultDb;
  const batchSize = options.batchSize ?? 20;

  const batch = await fetchPendingEmailOutboxBatch(batchSize, dbClient);
  if (batch.length === 0) {
    return {
      batchSize: 0,
      processedCount: 0,
      sentCount: 0,
      suppressedCount: 0,
      failedCount: 0,
    };
  }

  let processedCount = 0;
  let sentCount = 0;
  let suppressedCount = 0;
  let failedCount = 0;

  for (const item of batch) {
    if (options.signal?.aborted) {
      break;
    }

    processedCount += 1;

    try {
      await markEmailOutboxProcessing(item.id, dbClient);

      // Branch A: Appointment transactional emails (TASK-0041 / AC-5, AC-6, AC-8)
      if (item.kind === 'appointment_confirmation' || item.kind === 'appointment_cancellation') {
        if (!item.appointmentId) {
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        const [appointment] = await dbClient
          .select()
          .from(appointments)
          .where(eq(appointments.id, item.appointmentId))
          .limit(1);

        if (!appointment) {
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        // If erased before delivery, suppress sending
        if (
          appointment.attendeeEmail.endsWith('@redacted.local') ||
          appointment.attendeeName === 'Erased Attendee'
        ) {
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        let studioName = 'Photo Studio';
        let defaultLocale = 'en';
        try {
          const settings = await getStudioSettings(dbClient);
          studioName = settings.studio_name;
          defaultLocale = settings.default_locale;
        } catch {
          studioName = 'Photo Studio';
        }

        const recipientEmail = item.recipient ?? appointment.attendeeEmail;
        if (!recipientEmail) {
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        let locale = defaultLocale;
        if (appointment.clientId) {
          const [cl] = await dbClient
            .select({ preferredLocale: clients.preferredLocale })
            .from(clients)
            .where(eq(clients.id, appointment.clientId))
            .limit(1);
          if (cl?.preferredLocale) locale = cl.preferredLocale;
        } else if (appointment.leadId) {
          const [ld] = await dbClient
            .select({ locale: leads.locale })
            .from(leads)
            .where(eq(leads.id, appointment.leadId))
            .limit(1);
          if (ld?.locale) locale = ld.locale;
        }

        const rendered =
          item.kind === 'appointment_confirmation'
            ? renderAppointmentConfirmationEmail({ appointment, studioName, locale })
            : renderAppointmentCancellationEmail({ appointment, studioName, locale });

        const headers = getAppointmentEmailHeaders();

        try {
          await sendEmail({
            to: { address: recipientEmail },
            subject: rendered.subject,
            text: rendered.text,
            headers,
            transporter: options.transporter,
          });

          await deleteEmailOutboxItem(item.id, dbClient);

          // AC-8: Log appointment ID and outbox ID only, never recipient email or attendee notes
          logger.info(
            {
              appointmentId: appointment.id,
              outboxId: item.id,
              kind: item.kind,
            },
            'Appointment transactional email sent successfully',
          );

          sentCount += 1;
        } catch (err) {
          failedCount += 1;
          const newAttempts = item.attempts + 1;
          const isTerminal = isTerminalRetry(newAttempts);
          const nextAttemptAt = calculateNextAttemptDate(newAttempts, options.backoffOptions);

          const rawMsg = err instanceof Error ? err.message : String(err);
          const errorClass = err instanceof Error ? err.constructor.name : 'Error';
          const sanitizedError = sanitizeOutboxError(rawMsg, errorClass);

          // AC-8: Log appointment ID and outbox ID only, never recipient email or attendee notes
          logger.warn(
            {
              outboxId: item.id,
              appointmentId: appointment.id,
              attempts: newAttempts,
              isTerminal,
              errorClass,
            },
            'Appointment transactional email sending failed',
          );

          await updateEmailOutboxRetry(
            item.id,
            newAttempts,
            nextAttemptAt,
            sanitizedError,
            isTerminal,
            dbClient,
          );
        }

        continue;
      }

      // Branch B: Proposal transactional emails (TASK-0060 / AC-1, AC-2, AC-4)
      if (
        item.kind === 'proposal_sent' ||
        item.kind === 'proposal_accepted_client' ||
        item.kind === 'proposal_accepted_owner'
      ) {
        if (!item.proposalId) {
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        const [proposal] = await dbClient
          .select()
          .from(proposals)
          .where(eq(proposals.id, item.proposalId))
          .limit(1);

        if (!proposal) {
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        // Suppress proposal_sent delivery if token is revoked or proposal is no longer in 'sent' status (I1-S02 / ASVS V2.2.1)
        if (
          item.kind === 'proposal_sent' &&
          (proposal.tokenRevokedAt !== null || proposal.status !== 'sent')
        ) {
          logger.info(
            {
              outboxId: item.id,
              proposalId: proposal.id,
              status: proposal.status,
              isRevoked: proposal.tokenRevokedAt !== null,
            },
            'Suppressing proposal_sent email for revoked or non-sent proposal',
          );
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        // Suppress proposal_accepted_* if proposal is no longer in 'accepted' status
        if (
          (item.kind === 'proposal_accepted_client' || item.kind === 'proposal_accepted_owner') &&
          proposal.status !== 'accepted'
        ) {
          logger.info(
            {
              outboxId: item.id,
              proposalId: proposal.id,
              status: proposal.status,
            },
            'Suppressing proposal_accepted email for non-accepted proposal',
          );
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        const [clientRow] = await dbClient
          .select()
          .from(clients)
          .where(eq(clients.id, proposal.clientId))
          .limit(1);

        let studioName = 'Photo Studio';
        let defaultLocale = 'en';
        try {
          const settings = await getStudioSettings(dbClient);
          studioName = settings.studio_name;
          defaultLocale = settings.default_locale;
        } catch {
          studioName = 'Photo Studio';
        }

        const clientLocale = clientRow?.preferredLocale ?? defaultLocale;
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

        let recipientEmail: string | null | undefined = item.recipient;
        if (!recipientEmail) {
          if (item.kind === 'proposal_sent') {
            const [contact] = await dbClient
              .select({ email: clientContacts.email })
              .from(clientContacts)
              .where(eq(clientContacts.clientId, proposal.clientId))
              .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt))
              .limit(1);
            recipientEmail = contact?.email;
          } else if (item.kind === 'proposal_accepted_client') {
            if (proposal.acceptedByEmail) {
              recipientEmail = proposal.acceptedByEmail;
            } else {
              const [contact] = await dbClient
                .select({ email: clientContacts.email })
                .from(clientContacts)
                .where(eq(clientContacts.clientId, proposal.clientId))
                .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt))
                .limit(1);
              recipientEmail = contact?.email;
            }
          } else {
            recipientEmail = process.env.SMTP_FROM ?? 'owner@example.org';
          }
        }

        if (!recipientEmail) {
          await deleteEmailOutboxItem(item.id, dbClient);
          suppressedCount += 1;
          continue;
        }

        let rendered;
        if (item.kind === 'proposal_sent') {
          const payload = item.payload as { token?: string; tokenUrl?: string } | null | undefined;
          const payloadToken = payload?.token;
          const payloadTokenUrl = payload?.tokenUrl;
          rendered = renderProposalSentEmail({
            proposal: {
              id: proposal.id,
              title: proposal.title,
              totalMinor: proposal.totalMinor,
              currency: proposal.currency,
              validUntil: proposal.validUntil,
              token: payloadToken,
              tokenUrl: payloadTokenUrl,
            },
            clientName: clientRow?.displayName ?? 'Client',
            studioName,
            locale: clientLocale,
            baseUrl,
          });
        } else if (item.kind === 'proposal_accepted_client') {
          const summary = await getAcceptedProposalForProject(proposal.projectId, dbClient);
          rendered = renderProposalAcceptedClientEmail({
            proposal: {
              id: proposal.id,
              title: proposal.title,
              packageName: summary?.packageName,
              includedItems: summary?.includedItems,
              selectedAddons: summary?.selectedAddons,
              totalMinor: proposal.totalMinor,
              currency: proposal.currency,
            },
            clientName: proposal.acceptedByName ?? clientRow?.displayName ?? 'Client',
            studioName,
            locale: clientLocale,
          });
        } else {
          // proposal_accepted_owner
          const summary = await getAcceptedProposalForProject(proposal.projectId, dbClient);
          rendered = renderProposalAcceptedOwnerEmail({
            proposal: {
              id: proposal.id,
              projectId: proposal.projectId,
              title: proposal.title,
              packageName: summary?.packageName,
              totalMinor: proposal.totalMinor,
              currency: proposal.currency,
              acceptedByName: proposal.acceptedByName,
              acceptedByEmail: proposal.acceptedByEmail,
            },
            clientName: clientRow?.displayName ?? 'Client',
            studioName,
            locale: defaultLocale,
            baseUrl,
          });
        }

        const headers = getProposalEmailHeaders();

        try {
          await sendEmail({
            to: { address: recipientEmail },
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
            headers,
            transporter: options.transporter,
          });

          await deleteEmailOutboxItem(item.id, dbClient);

          logger.info(
            {
              proposalId: proposal.id,
              outboxId: item.id,
              kind: item.kind,
            },
            'Proposal transactional email sent successfully',
          );

          sentCount += 1;
        } catch (err) {
          failedCount += 1;
          const newAttempts = item.attempts + 1;
          const isTerminal = isTerminalRetry(newAttempts);
          const nextAttemptAt = calculateNextAttemptDate(newAttempts, options.backoffOptions);

          const rawMsg = err instanceof Error ? err.message : String(err);
          const errorClass = err instanceof Error ? err.constructor.name : 'Error';
          const sanitizedError = sanitizeOutboxError(rawMsg, errorClass);

          logger.warn(
            {
              outboxId: item.id,
              proposalId: proposal.id,
              attempts: newAttempts,
              isTerminal,
              errorClass,
            },
            'Proposal transactional email sending failed',
          );

          await updateEmailOutboxRetry(
            item.id,
            newAttempts,
            nextAttemptAt,
            sanitizedError,
            isTerminal,
            dbClient,
          );
        }

        continue;
      }

      // Branch C: Lead auto-reply
      if (!item.leadId) {
        await deleteEmailOutboxItem(item.id, dbClient);
        suppressedCount += 1;
        continue;
      }

      // 1. Resolve lead details
      const lead = await getLeadById(item.leadId, dbClient);

      // AC-11: If lead row is missing (deleted), cleanly delete outbox row without sending
      if (!lead) {
        await deleteEmailOutboxItem(item.id, dbClient);
        suppressedCount += 1;
        continue;
      }

      // If lead was already converted before sending, suppress and delete outbox
      if (lead.status === 'converted') {
        await updateLeadAutoReplyStatus(lead.id, 'suppressed', dbClient);
        await deleteEmailOutboxItem(item.id, dbClient);
        suppressedCount += 1;
        continue;
      }

      // 2. Anti-abuse cap checks (AC-7, AC-8)
      const emailNormalized = lead.emailNormalized ?? lead.email?.trim().toLowerCase() ?? '';
      const emailHash = crypto.createHash('sha256').update(emailNormalized).digest('hex');

      const recipientKey = `auto_reply_recipient:${emailHash}`;
      const globalKey = 'auto_reply_global';

      // Per-recipient cap: 1 per 24 hours (86,400,000 ms)
      const recipientCap = await checkRateLimit(recipientKey, 1, 24 * 60 * 60 * 1000, dbClient);

      // Instance-wide cap: 30 per 1 hour (3,600,000 ms)
      const globalCap = await checkRateLimit(globalKey, 30, 60 * 60 * 1000, dbClient);

      if (!recipientCap.allowed || !globalCap.allowed) {
        // Suppress sending
        await updateLeadAutoReplyStatus(lead.id, 'suppressed', dbClient);
        await deleteEmailOutboxItem(item.id, dbClient);

        await audit(
          {
            action: 'lead.auto_reply.suppressed',
            actorType: 'system',
            actorId: 'email-outbox-worker',
            targetType: 'lead',
            targetId: lead.id,
            outcome: 'success',
            metadata: {
              reason: 'rate_limited',
            },
          },
          dbClient,
        );

        logger.info(
          {
            leadId: lead.id,
            outboxId: item.id,
            recipientAllowed: recipientCap.allowed,
            globalAllowed: globalCap.allowed,
          },
          'Lead auto-reply suppressed due to rate limit cap',
        );

        suppressedCount += 1;
        continue;
      }

      // 3. Resolve studio settings & notice version for rendering
      let studioName = 'Photo Studio';
      try {
        const settings = await getStudioSettings(dbClient);
        studioName = settings.studio_name;
      } catch {
        studioName = 'Photo Studio';
      }

      let privacyPolicyUrl = '';
      if (lead.noticeVersionId) {
        const [noticeVersion] = await dbClient
          .select({ privacyPolicyUrl: inquiryFormNoticeVersions.privacyPolicyUrl })
          .from(inquiryFormNoticeVersions)
          .where(eq(inquiryFormNoticeVersions.id, lead.noticeVersionId))
          .limit(1);

        privacyPolicyUrl = noticeVersion?.privacyPolicyUrl ?? '';
      }

      // 4. Render plain-text template (AC-1, AC-2, AC-4)
      const { subject, text } = renderAutoReplyEmail({
        locale: lead.locale,
        studioName,
        privacyPolicyUrl,
      });

      // 5. Send plain-text email with RFC 3834 headers (AC-3, AC-13)
      if (!lead.email) {
        await deleteEmailOutboxItem(item.id, dbClient);
        await updateLeadAutoReplyStatus(lead.id, 'failed', dbClient);
        continue;
      }

      try {
        await sendEmail({
          to: { address: lead.email },
          subject,
          text,
          headers: {
            'Auto-Submitted': 'auto-replied',
            'X-Auto-Response-Suppress': 'All',
          },
          transporter: options.transporter,
        });

        // 6. On send success: consume caps, delete outbox, set sent status, audit
        await consumeRateLimit(recipientKey, 1, 24 * 60 * 60 * 1000, dbClient);
        await consumeRateLimit(globalKey, 30, 60 * 60 * 1000, dbClient);

        await deleteEmailOutboxItem(item.id, dbClient);
        await updateLeadAutoReplyStatus(lead.id, 'sent', dbClient);

        await audit(
          {
            action: 'lead.auto_reply.sent',
            actorType: 'system',
            actorId: 'email-outbox-worker',
            targetType: 'lead',
            targetId: lead.id,
            outcome: 'success',
            metadata: {},
          },
          dbClient,
        );

        sentCount += 1;
      } catch (err) {
        // 7. On send failure: retry with backoff or mark FAILED (AC-9, AC-10)
        failedCount += 1;
        const newAttempts = item.attempts + 1;
        const isTerminal = isTerminalRetry(newAttempts);
        const nextAttemptAt = calculateNextAttemptDate(newAttempts, options.backoffOptions);

        const rawMsg = err instanceof Error ? err.message : String(err);
        const errorClass = err instanceof Error ? err.constructor.name : 'Error';
        const sanitizedError = sanitizeOutboxError(rawMsg, errorClass);

        logger.warn(
          {
            outboxId: item.id,
            leadId: lead.id,
            attempts: newAttempts,
            isTerminal,
            errorClass,
          },
          'Auto-reply SMTP sending failed',
        );

        if (isTerminal) {
          // Terminal failure: status = FAILED, lead auto_reply_status = failed (AC-10)
          await updateEmailOutboxRetry(
            item.id,
            newAttempts,
            nextAttemptAt,
            sanitizedError,
            true,
            dbClient,
          );
          await updateLeadAutoReplyStatus(lead.id, 'failed', dbClient);
          await audit(
            {
              action: 'lead.auto_reply.failed',
              actorType: 'system',
              actorId: 'email-outbox-worker',
              targetType: 'lead',
              targetId: lead.id,
              outcome: 'failure',
              metadata: {
                reason: errorClass,
              },
            },
            dbClient,
          );
        } else {
          // Retryable failure: lead remains queued (AC-9)
          await updateEmailOutboxRetry(
            item.id,
            newAttempts,
            nextAttemptAt,
            sanitizedError,
            false,
            dbClient,
          );
        }
      }
    } catch (unexpectedErr) {
      logger.error(
        {
          outboxId: item.id,
          error: unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr),
        },
        'Unexpected error processing email outbox item',
      );
      failedCount += 1;
    }
  }

  return {
    batchSize: batch.length,
    processedCount,
    sentCount,
    suppressedCount,
    failedCount,
  };
}
