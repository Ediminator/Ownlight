import { eq } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { audit } from '@/server/audit';
import { logger } from '@/server/log';
import { leads } from '@/server/db/schema/leads';
import { clients, clientContacts, type ClientLocale } from '@/server/db/schema/clients';
import { inquiryForms } from '@/server/db/schema/inquiry-forms';
import { recordTimelineEvent } from '@/server/timeline/service';
import { insertClientNoteRecord } from '@/server/timeline/repo';
import { generateUuidV7 } from '@/lib/id';
import { resolveActor, type ActorInput } from './service';
import { getLeadConversionSteps } from './conversion-steps';
import '@/server/projects/conversion-step';

export interface ConvertLeadOptions {
  mode: 'new_client' | 'existing_client';
  existingClientId?: string | null;
}

export type ConvertLeadResult =
  | { success: true; clientId: string; data: { clientId: string; projectId?: string } }
  | { success: false; code: string; error: string; fields?: string[] };

/**
 * Converts an unconverted lead into a client record (ADR-0015 §8, TASK-0032).
 * Runs atomically within a single database transaction.
 */
export async function convertLeadToClient(
  leadId: string,
  options: ConvertLeadOptions,
  actor?: ActorInput,
  dbClient: DbClient = defaultDb,
): Promise<ConvertLeadResult> {
  const actorObj = resolveActor(actor);

  return await dbClient.transaction(async (tx) => {
    // 1. Fetch lead
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1);

    if (!lead) {
      return {
        success: false,
        code: 'NOT_FOUND',
        error: 'Lead not found',
      };
    }

    // 2. Precondition check (AC-6): status must be 'new' or 'contacted'
    if (lead.status !== 'new' && lead.status !== 'contacted') {
      return {
        success: false,
        code: 'INVALID_TRANSITION',
        error: 'INVALID_TRANSITION',
      };
    }

    const now = new Date();
    let targetClientId: string;

    // 3. Mode branching (AC-1, AC-2)
    if (options.mode === 'existing_client') {
      if (!options.existingClientId) {
        return {
          success: false,
          code: 'VALIDATION_FAILED',
          error: 'existingClientId is required for existing_client mode',
          fields: ['existingClientId'],
        };
      }

      const [existingClient] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, options.existingClientId))
        .limit(1);

      if (!existingClient) {
        return {
          success: false,
          code: 'CLIENT_NOT_FOUND',
          error: 'Client not found',
        };
      }

      targetClientId = existingClient.id;

      // Bump client last_activity_at
      await tx
        .update(clients)
        .set({ lastActivityAt: now, updatedAt: now })
        .where(eq(clients.id, targetClientId));
    } else {
      // mode === 'new_client'
      const clientId = generateUuidV7();
      const contactId = generateUuidV7();
      const displayName =
        [lead.givenName, lead.familyName].filter(Boolean).join(' ').trim() || 'Client';
      const preferredLocale: ClientLocale = lead.locale === 'de' ? 'de' : 'en';

      // Insert new person client with Google sync OFF by default (AC-1)
      await tx.insert(clients).values({
        id: clientId,
        kind: 'person',
        displayName,
        preferredLocale,
        googleContactsSyncEnabled: false,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Insert primary contact with lead details
      await tx.insert(clientContacts).values({
        id: contactId,
        clientId,
        givenName: lead.givenName ?? null,
        familyName: lead.familyName ?? null,
        email: lead.email ?? null,
        emailNormalized: lead.emailNormalized ?? null,
        phone: lead.phone ?? null,
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
      });

      // Emit client.created timeline event
      await recordTimelineEvent(tx, {
        clientId,
        type: 'client.created',
        occurredAt: now,
        actorType: 'owner',
        actorId: actorObj.actorId,
        subjectType: 'client',
        subjectId: clientId,
        data: {},
      });

      targetClientId = clientId;
    }

    // 4. Client note creation from inquiry message if non-empty (D7, AC-3)
    if (lead.message && lead.message.trim().length > 0) {
      const [formRow] = await tx
        .select({ name: inquiryForms.name })
        .from(inquiryForms)
        .where(eq(inquiryForms.id, lead.formId))
        .limit(1);

      const formName = formRow?.name ?? 'Inquiry form';
      const receivedDate = lead.receivedAt.toISOString().slice(0, 10);
      const noteTitle = `Inquiry message (${formName}, ${receivedDate})`;
      const noteBody = `${noteTitle}\n\n${lead.message}`;

      const note = await insertClientNoteRecord(tx, {
        clientId: targetClientId,
        body: noteBody,
        now,
      });

      await recordTimelineEvent(tx, {
        clientId: targetClientId,
        type: 'note.created',
        occurredAt: now,
        actorType: 'owner',
        actorId: actorObj.actorId,
        subjectType: 'note',
        subjectId: note.id,
        data: {},
      });
    }

    // 5. Timeline events via ADR-0011 registry (AC-5)
    // inquiry.received: actor system, occurred_at = lead.received_at, subject lead, no copied data keys
    await recordTimelineEvent(tx, {
      clientId: targetClientId,
      type: 'inquiry.received',
      occurredAt: lead.receivedAt,
      actorType: 'system',
      actorId: 'public-inquiry-endpoint',
      subjectType: 'lead',
      subjectId: lead.id,
      data: {},
    });

    // lead.converted: actor owner, subject lead, data keys ["mode"]
    await recordTimelineEvent(tx, {
      clientId: targetClientId,
      type: 'lead.converted',
      occurredAt: now,
      actorType: 'owner',
      actorId: actorObj.actorId,
      subjectType: 'lead',
      subjectId: lead.id,
      data: { mode: options.mode },
    });

    // 6. Update leads row and null PII (AC-4)
    await tx
      .update(leads)
      .set({
        status: 'converted',
        clientId: targetClientId,
        convertedAt: now,
        lastActivityAt: now,
        updatedAt: now,
        // Null PII columns
        givenName: null,
        familyName: null,
        email: null,
        emailNormalized: null,
        phone: null,
        message: null,
      })
      .where(eq(leads.id, lead.id));

    // 7. Execute registered post-conversion steps (AC-7)
    let createdProjectId: string | undefined;
    const conversionSteps = getLeadConversionSteps();
    for (const step of conversionSteps) {
      const stepRes = await step.run(lead, targetClientId, tx);
      if (
        stepRes &&
        typeof stepRes === 'object' &&
        'projectId' in stepRes &&
        typeof stepRes.projectId === 'string'
      ) {
        createdProjectId = stepRes.projectId;
      }
    }

    // 8. Audit event: lead.converted (ADR-0015 §11)
    await audit(
      {
        action: 'lead.converted',
        actorType: actorObj.actorType,
        actorId: actorObj.actorId,
        targetType: 'lead',
        targetId: lead.id,
        outcome: 'success',
        metadata: {
          client_id: targetClientId,
          mode: options.mode,
        },
      },
      tx,
    );

    logger.info(
      {
        leadId: lead.id,
        clientId: targetClientId,
        mode: options.mode,
      },
      'Lead successfully converted to client',
    );

    return {
      success: true,
      clientId: targetClientId,
      data: {
        clientId: targetClientId,
        ...(createdProjectId ? { projectId: createdProjectId } : {}),
      },
    };
  });
}
