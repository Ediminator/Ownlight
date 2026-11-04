'use server';

import 'server-only';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, asc } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { resolveClientIp } from '@/server/http/client-ip';
import { consumeProposalRateLimit, anonymizeIp } from '@/server/auth/rate-limiter';
import { requireOwnerSession } from '@/server/auth/guards';
import { audit } from '@/server/audit';
import { recordTimelineEvent } from '@/server/timeline/service';
import { enqueueProposalAcceptedEmails } from '@/server/email/templates/proposal';
import { logger } from '@/server/log';
import {
  proposals,
  proposalLineItems,
  type Proposal,
  type ProposalLineItem,
} from '@/server/db/schema/proposals';
import { projects, pipelineStages } from '@/server/db/schema/projects';
import { calculateProposalTotals } from './calculator';
import { createAcceptedOptionsSnapshot } from './snapshot';
import { acceptProposalSchema, type AcceptProposalInput } from './schema';

export type PublicProposalActionResult<T = unknown> =
  { success: true; data: T } | { success: false; code: string; error: string; fields?: string[] };

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // Ignore outside Next.js request context (e.g. tests)
  }
}

/**
 * Accepts a proposal from the public client acceptance ceremony (TASK-0062 / ADR-0018 §3.3).
 * - Validates proposal exists by tokenHash = sha256(token).
 * - Rate-limits client IP (30 req/min fail-closed).
 * - Runs in a PostgreSQL serializable transaction.
 * - Enforces not revoked, not expired, status === 'sent' (or previewable 'draft' for studio owner).
 * - Freezes accepted_options_snapshot (jsonb) with exact minor units totals.
 * - Anonymizes client IP address and captures truncated User-Agent.
 * - Transitions status = 'accepted' and sets accepted_at = now().
 * - Updates projects.price_minor and currency, and if stage category is 'inquiry', advances to 'booked'.
 * - Emits proposal.accepted timeline and audit events.
 * - Enqueues proposal_accepted_client and proposal_accepted_owner in email_outbox.
 */
export async function acceptProposalAction(
  rawInput: unknown,
  explicitClient?: DbClient,
): Promise<
  PublicProposalActionResult<{
    proposalId: string;
    status: string;
    totalMinor: number;
    currency: string;
  }>
> {
  const client = explicitClient ?? defaultDb;

  // 1. Validate input schema
  const parsed = acceptProposalSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_FAILED',
      error: parsed.error.issues[0]?.message ?? 'Validation failed',
      fields: parsed.error.issues.map((i) => i.path.join('.')),
    };
  }
  const data: AcceptProposalInput = parsed.data;

  // 2. Resolve client IP and User-Agent
  let clientIp = '127.0.0.1';
  let userAgent: string | null = null;
  try {
    const h = await headers();
    clientIp = resolveClientIp(h) ?? '127.0.0.1';
    const rawUa = h.get('user-agent');
    if (rawUa) {
      userAgent = rawUa.slice(0, 255);
    }
  } catch {
    // Outside Next.js request context (e.g. testing)
  }

  // 3. Rate limiting (30 requests/minute per client IP)
  try {
    const rateCheck = await consumeProposalRateLimit(clientIp, client);
    if (!rateCheck.allowed) {
      return {
        success: false,
        code: 'RATE_LIMITED',
        error: 'Too Many Requests',
      };
    }
  } catch (rateErr) {
    logger.warn({ error: String(rateErr) }, 'Proposal rate limit check failed; failing closed');
    return {
      success: false,
      code: 'SERVICE_UNAVAILABLE',
      error: 'Service temporarily unavailable',
    };
  }

  const tokenHash = createHash('sha256').update(data.token).digest('hex');
  const now = new Date();

  try {
    return await client.transaction(
      async (tx) => {
        // Look up proposal by tokenHash
        const [proposal] = await tx
          .select()
          .from(proposals)
          .where(eq(proposals.tokenHash, tokenHash))
          .limit(1);

        if (!proposal) {
          return {
            success: false,
            code: 'NOT_FOUND',
            error: 'Proposal not found',
          };
        }

        // Validate token revocation
        if (proposal.tokenRevokedAt !== null) {
          return {
            success: false,
            code: 'REVOKED',
            error: 'Proposal link has been revoked',
          };
        }

        // Validate already accepted
        if (proposal.status === 'accepted') {
          return {
            success: false,
            code: 'ALREADY_ACCEPTED',
            error: 'Proposal has already been accepted',
          };
        }

        // Validate validity expiration date
        if (proposal.validUntil && proposal.validUntil < now) {
          return {
            success: false,
            code: 'EXPIRED',
            error: 'Proposal has expired',
          };
        }

        // Validate status: must be 'sent' or previewable 'draft' for studio owner
        if (proposal.status !== 'sent') {
          let isOwner = false;
          try {
            const ownerAuth = await requireOwnerSession({ client: tx });
            isOwner = ownerAuth.user.role === 'owner';
          } catch {
            isOwner = false;
          }

          if (proposal.status !== 'draft' || !isOwner) {
            return {
              success: false,
              code: 'INVALID_STATUS',
              error: `Proposal cannot be accepted in '${proposal.status}' status`,
            };
          }
        }

        // Fetch line items
        const lineItems = await tx
          .select()
          .from(proposalLineItems)
          .where(eq(proposalLineItems.proposalId, proposal.id))
          .orderBy(asc(proposalLineItems.position), asc(proposalLineItems.createdAt));

        // Process client selection map: itemId -> desired quantity
        const selectedQtyMap = new Map<string, number>();

        if (data.selectedOptions && data.selectedOptions.length > 0) {
          for (const opt of data.selectedOptions) {
            selectedQtyMap.set(opt.id, opt.quantity ?? 1);
          }
        }

        if (data.selectedOptionIds && data.selectedOptionIds.length > 0) {
          for (const opt of data.selectedOptionIds) {
            if (typeof opt === 'string') {
              if (!selectedQtyMap.has(opt)) {
                selectedQtyMap.set(opt, 1);
              }
            } else if (typeof opt === 'object' && 'id' in opt) {
              selectedQtyMap.set(opt.id, opt.quantity ?? 1);
            }
          }
        }

        // Update line items selection and quantity
        const updatedItems: ProposalLineItem[] = [];
        for (const item of lineItems) {
          let isSelected = item.isSelected;
          let quantity = item.quantity;

          if (item.itemType === 'base_package') {
            // Base packages cannot be deselected
            isSelected = true;
            quantity = Math.max(1, item.quantity);
          } else if (item.isOptional) {
            // Optional add-ons: toggled if present in client selection map
            if (selectedQtyMap.has(item.id)) {
              isSelected = true;
              const requestedQty = selectedQtyMap.get(item.id) ?? 1;
              quantity = Math.max(item.minQuantity, Math.min(item.maxQuantity, requestedQty));
            } else {
              isSelected = false;
            }
          } else {
            // Non-optional deliverables are always included
            isSelected = true;
          }

          updatedItems.push({
            ...item,
            isSelected,
            quantity,
            updatedAt: now,
          });

          await tx
            .update(proposalLineItems)
            .set({
              isSelected,
              quantity,
              updatedAt: now,
            })
            .where(eq(proposalLineItems.id, item.id));
        }

        // Recalculate totals on the server
        const calcResult = calculateProposalTotals(
          updatedItems.map((item) => ({
            unitPriceMinor: item.unitPriceMinor,
            quantity: item.quantity,
            taxRateBasisPoints: item.taxRateBasisPoints,
            isSelected: item.isSelected,
          })),
          {
            pricesIncludeTax: proposal.pricesIncludeTax,
            isKleinunternehmer: proposal.isKleinunternehmer,
          },
        );

        // Freeze accepted_options_snapshot
        const snapshot = createAcceptedOptionsSnapshot(proposal, updatedItems, {
          acceptedByName: data.acceptedByName,
          acceptedByEmail: data.acceptedByEmail,
        });

        const anonymizedIp = anonymizeIp(clientIp);

        // Update proposal row to 'accepted'
        const [acceptedProposal] = (await tx
          .update(proposals)
          .set({
            status: 'accepted',
            acceptedAt: now,
            acceptedByName: data.acceptedByName,
            acceptedByEmail: data.acceptedByEmail,
            acceptanceIpAnonymized: anonymizedIp,
            acceptanceUserAgent: userAgent,
            acceptedOptionsSnapshot: snapshot,
            subtotalMinor: calcResult.subtotalMinor,
            taxMinor: calcResult.taxMinor,
            totalMinor: calcResult.totalMinor,
            updatedAt: now,
          })
          .where(eq(proposals.id, proposal.id))
          .returning()) as [Proposal];

        // Synchronize project price and currency, and advance 'inquiry' stage to 'booked' (ADR-0018 §3.3)
        const [project] = await tx
          .select({
            id: projects.id,
            stageId: projects.stageId,
            stageCategory: pipelineStages.category,
          })
          .from(projects)
          .innerJoin(pipelineStages, eq(projects.stageId, pipelineStages.id))
          .where(eq(projects.id, proposal.projectId))
          .limit(1);

        let targetStageId = project?.stageId;
        if (project?.stageCategory === 'inquiry') {
          const [bookedStage] = await tx
            .select({ id: pipelineStages.id })
            .from(pipelineStages)
            .where(eq(pipelineStages.category, 'booked'))
            .orderBy(asc(pipelineStages.position))
            .limit(1);
          if (bookedStage) {
            targetStageId = bookedStage.id;
          }
        }

        await tx
          .update(projects)
          .set({
            priceMinor: acceptedProposal.totalMinor,
            currency: acceptedProposal.currency,
            stageId: targetStageId,
            updatedAt: now,
          })
          .where(eq(projects.id, proposal.projectId));

        // Record client relationship timeline event
        await recordTimelineEvent(tx, {
          clientId: acceptedProposal.clientId,
          type: 'proposal.accepted',
          actorType: 'client',
          actorId: null,
          subjectType: 'proposal',
          subjectId: acceptedProposal.id,
          data: {
            proposal_id: acceptedProposal.id,
            total_minor: acceptedProposal.totalMinor,
            currency: acceptedProposal.currency,
          },
        });

        // Emit audit log event with anonymized IP metadata
        await audit(
          {
            actorType: 'client',
            actorId: 'anonymous_client',
            action: 'proposal.accepted',
            targetType: 'proposal',
            targetId: acceptedProposal.id,
            outcome: 'success',
            metadata: {
              proposal_id: acceptedProposal.id,
              project_id: acceptedProposal.projectId,
              client_id: acceptedProposal.clientId,
              total_minor: acceptedProposal.totalMinor,
              currency: acceptedProposal.currency,
            },
          },
          tx,
        );

        // Enqueue transactional confirmation emails in email_outbox (ADR-0018 §5 / AC-3)
        await enqueueProposalAcceptedEmails(acceptedProposal.id, tx);

        safeRevalidate(`/projects/${acceptedProposal.projectId}`);
        safeRevalidate(`/p/${data.token}`);

        return {
          success: true,
          data: {
            proposalId: acceptedProposal.id,
            status: acceptedProposal.status,
            totalMinor: acceptedProposal.totalMinor,
            currency: acceptedProposal.currency,
          },
        };
      },
      { isolationLevel: 'serializable' },
    );
  } catch (err) {
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      'Unexpected error in acceptProposalAction',
    );
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: err instanceof Error ? err.message : 'Internal error processing acceptance',
    };
  }
}
