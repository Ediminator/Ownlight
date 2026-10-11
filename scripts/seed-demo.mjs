#!/usr/bin/env node
/**
 * scripts/seed-demo.mjs
 * Seeds deterministic synthetic demo data for development and testing.
 *
 * Safety guards:
 * 1. Strictly refuses to execute in production unless --force-demo is explicitly passed.
 * 2. Uses fixed-seed faker to guarantee identical, reproducible data.
 * 3. Enforces RFC 2606 safe domains (@example.com, @example.org) for ALL emails.
 * 4. Fake, non-routable phone numbers only.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faker } from '@faker-js/faker';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { pgTable, uuid, varchar, char, boolean, timestamp, jsonb, text } from 'drizzle-orm/pg-core';

export const SAFE_EMAIL_DOMAINS = ['example.com', 'example.org'];
export const DEFAULT_SEED = 42;

export const studioSettings = pgTable('studio_settings', {
  id: uuid('id').primaryKey(),
  studio_name: varchar('studio_name', { length: 255 }).notNull(),
  default_locale: varchar('default_locale', { length: 10 }).notNull().default('en'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const clientsTable = pgTable('clients', {
  id: uuid('id').primaryKey(),
  kind: varchar('kind', { length: 20 }).notNull(),
  displayName: varchar('display_name', { length: 200 }).notNull(),
  preferredLocale: varchar('preferred_locale', { length: 10 }).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const clientContactsTable = pgTable('client_contacts', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').notNull(),
  givenName: varchar('given_name', { length: 100 }),
  familyName: varchar('family_name', { length: 100 }),
  email: varchar('email', { length: 254 }),
  emailNormalized: varchar('email_normalized', { length: 254 }),
  phone: varchar('phone', { length: 32 }),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const clientAddressesTable = pgTable('client_addresses', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  line1: varchar('line1', { length: 200 }).notNull(),
  line2: varchar('line2', { length: 200 }),
  postalCode: varchar('postal_code', { length: 20 }).notNull(),
  city: varchar('city', { length: 100 }).notNull(),
  region: varchar('region', { length: 100 }),
  countryCode: char('country_code', { length: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const tagsTable = pgTable('tags', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const clientTagsTable = pgTable('client_tags', {
  clientId: uuid('client_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const clientTimelineEventsTable = pgTable('client_timeline_events', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').notNull(),
  type: varchar('type', { length: 100 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  actorType: varchar('actor_type', { length: 20 }).notNull(),
  actorId: varchar('actor_id', { length: 100 }),
  subjectType: varchar('subject_type', { length: 50 }),
  subjectId: varchar('subject_id', { length: 100 }),
  data: jsonb('data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const clientNotesTable = pgTable('client_notes', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/**
 * Generates an RFC 9562 UUIDv7 deterministically using the provided faker PRNG.
 * @param {any} fakerInstance
 * @param {number} timestampMs
 * @returns {string}
 */
export function generateDeterministicUuidV7(fakerInstance, timestampMs) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = fakerInstance.number.int({ min: 0, max: 255 });
  }

  const ts = BigInt(timestampMs);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Validates that an email address belongs exclusively to safe reserved domains.
 * @param {string} email
 * @returns {boolean}
 */
export function isSafeEmail(email) {
  if (typeof email !== 'string') return false;
  return SAFE_EMAIL_DOMAINS.some((domain) => email.endsWith(`@${domain}`));
}

/**
 * Generates synthetic demo dataset deterministically.
 * @param {number} [seed=DEFAULT_SEED]
 */
export function generateDemoData(seed = DEFAULT_SEED) {
  faker.seed(seed);

  // Fixed anchor timestamp for deterministic created_at/updated_at dates
  const baseTimestampMs = 1770000000000;

  const settings = {
    id: generateDeterministicUuidV7(faker, baseTimestampMs),
    studio_name: 'Lumière Photo & Film Studio',
    default_locale: 'en',
    timezone: 'Europe/Berlin',
    currency: 'EUR',
    created_at: new Date(baseTimestampMs),
    updated_at: new Date(baseTimestampMs),
  };

  // Generate synthetic contacts/leads with strictly safe emails and fake numbers
  const contacts = Array.from({ length: 5 }, (_, idx) => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const domain = SAFE_EMAIL_DOMAINS[idx % SAFE_EMAIL_DOMAINS.length];
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`;
    const phone = `+49 30 000000${String(idx).padStart(2, '0')}`;
    const contactTimestampMs = baseTimestampMs + (idx + 1) * 3600000;

    return {
      id: generateDeterministicUuidV7(faker, contactTimestampMs),
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      created_at: new Date(contactTimestampMs),
    };
  });

  // Fixed synthetic tags (TASK-0010)
  const DEMO_TAG_NAMES = ['Wedding', 'Portrait', 'Corporate', '2026'];
  const tags = DEMO_TAG_NAMES.map((name, idx) => {
    const tagTs = baseTimestampMs + (idx + 1) * 10000;
    return {
      id: generateDeterministicUuidV7(faker, tagTs),
      name,
      nameNormalized: name.toLowerCase(),
      createdAt: new Date(tagTs),
      updatedAt: new Date(tagTs),
    };
  });

  // Generate 50 deterministic synthetic clients (TASK-0009, AC-17)
  let phoneCounter = 1;
  const clients = Array.from({ length: 50 }, (_, i) => {
    const clientTimestampMs = baseTimestampMs + (i + 10) * 3600000;
    const clientId = generateDeterministicUuidV7(faker, clientTimestampMs);
    const isCompany = i % 3 === 0;
    const kind = isCompany ? 'company' : 'person';
    const companyName = `${faker.company.name()} GmbH`.slice(0, 200);
    const personName = `${faker.person.firstName()} ${faker.person.lastName()}`.slice(0, 200);
    const displayName = isCompany ? companyName : personName;
    const preferredLocale = i % 2 === 0 ? 'de' : 'en';

    // 1 to 3 contacts per client
    const numContacts = (i % 3) + 1;
    const clientContactsList = Array.from({ length: numContacts }, (_, cIdx) => {
      const contactTs = clientTimestampMs + (cIdx + 1) * 60000;
      const contactId = generateDeterministicUuidV7(faker, contactTs);
      const givenName = faker.person.firstName();
      const familyName = faker.person.lastName();
      const domain = SAFE_EMAIL_DOMAINS[(i + cIdx) % SAFE_EMAIL_DOMAINS.length];
      const email = `${givenName.toLowerCase()}.${familyName.toLowerCase()}.${i}.${cIdx}@${domain}`;
      const phone = `+49 30 0000 ${String(phoneCounter++).padStart(4, '0')}`;

      return {
        id: contactId,
        clientId,
        givenName,
        familyName,
        email,
        emailNormalized: email.toLowerCase(),
        phone,
        isPrimary: cIdx === 0,
        createdAt: new Date(contactTs),
        updatedAt: new Date(contactTs),
      };
    });

    // 0 to 2 addresses per client
    const numAddresses = i % 3;
    const clientAddressesList = Array.from({ length: numAddresses }, (_, aIdx) => {
      const addrTs = clientTimestampMs + (aIdx + 1) * 120000;
      const addressId = generateDeterministicUuidV7(faker, addrTs);
      const type = aIdx === 0 ? 'postal' : 'billing';
      const postalCode = String(10115 + (i % 20));
      const city = 'Berlin';
      const line1 = `Musterstraße ${i + 1}`;
      const line2 = aIdx === 1 ? 'Etage 2' : null;

      return {
        id: addressId,
        clientId,
        type,
        line1,
        line2,
        postalCode,
        city,
        region: 'Berlin',
        countryCode: 'DE',
        createdAt: new Date(addrTs),
        updatedAt: new Date(addrTs),
      };
    });

    // 1 to 2 tags per client (TASK-0010)
    const clientTagsList = [
      tags[i % tags.length],
      ...(i % 2 === 0 ? [tags[(i + 1) % tags.length]] : []),
    ];

    // Synthetic notes and timeline events (TASK-0013)
    const clientNotesList = [];
    const clientTimelineEventsList = [];

    // 1. client.created event
    clientTimelineEventsList.push({
      id: generateDeterministicUuidV7(faker, clientTimestampMs),
      clientId,
      type: 'client.created',
      actorType: 'owner',
      actorId: null,
      subjectType: 'client',
      subjectId: clientId,
      occurredAt: new Date(clientTimestampMs),
      data: {},
      createdAt: new Date(clientTimestampMs),
    });

    // 2. client.contact.added events
    for (const c of clientContactsList) {
      clientTimelineEventsList.push({
        id: generateDeterministicUuidV7(faker, c.createdAt.getTime()),
        clientId,
        type: 'client.contact.added',
        actorType: 'owner',
        actorId: null,
        subjectType: 'contact',
        subjectId: c.id,
        occurredAt: c.createdAt,
        data: {},
        createdAt: c.createdAt,
      });
    }

    // 3. Demo note for every other client
    if (i % 2 === 0) {
      const noteTs = clientTimestampMs + 3600000;
      const noteId = generateDeterministicUuidV7(faker, noteTs);
      const note = {
        id: noteId,
        clientId,
        body: `Initial consultation for ${displayName}. Discussed shoot details and package preferences.`,
        createdAt: new Date(noteTs),
        updatedAt: new Date(noteTs),
      };
      clientNotesList.push(note);
      clientTimelineEventsList.push({
        id: generateDeterministicUuidV7(faker, noteTs + 10),
        clientId,
        type: 'note.created',
        actorType: 'owner',
        actorId: null,
        subjectType: 'note',
        subjectId: noteId,
        occurredAt: new Date(noteTs),
        data: {},
        createdAt: new Date(noteTs),
      });
    }

    return {
      id: clientId,
      kind,
      displayName,
      preferredLocale,
      lastActivityAt: new Date(clientTimestampMs),
      createdAt: new Date(clientTimestampMs),
      updatedAt: new Date(clientTimestampMs),
      contacts: clientContactsList,
      addresses: clientAddressesList,
      tags: clientTagsList,
      notes: clientNotesList,
      timelineEvents: clientTimelineEventsList,
    };
  });

  return {
    settings,
    contacts,
    clients,
    tags,
  };
}

/**
 * Executes demo seeding into target database with production guards.
 * @param {{
 *   dbClient?: any,
 *   connectionUrl?: string,
 *   seed?: number,
 *   forceDemo?: boolean,
 *   nodeEnv?: string
 * }} [options={}]
 * @returns {Promise<{ success: boolean, data: ReturnType<typeof generateDemoData> }>}
 */
export async function seedDemo(options = {}) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const forceDemo = options.forceDemo ?? process.argv.includes('--force-demo');

  // Guard against production execution
  if (nodeEnv === 'production' && !forceDemo) {
    throw new Error(
      'FATAL: db:seed:demo refused to run in production environment without explicit --force-demo flag.',
    );
  }

  const seed = options.seed ?? DEFAULT_SEED;
  const demoData = generateDemoData(seed);

  // Validate email safety upfront
  for (const contact of demoData.contacts) {
    if (!isSafeEmail(contact.email)) {
      throw new Error(`Unsafe synthetic email domain detected: "${contact.email}"`);
    }
  }

  for (const client of demoData.clients) {
    for (const contact of client.contacts) {
      if (!isSafeEmail(contact.email)) {
        throw new Error(`Unsafe synthetic email domain detected: "${contact.email}"`);
      }
      if (!/^\+49 30 0000 \d{4}$/.test(contact.phone)) {
        throw new Error(`Unsafe synthetic phone number detected: "${contact.phone}"`);
      }
    }
  }

  let client = options.dbClient;
  let rawClient = null;

  if (!client) {
    const url =
      options.connectionUrl ||
      process.env.DATABASE_URL ||
      'postgres://ownlight_app:password@127.0.0.1:5432/ownlight_dev';
    rawClient = postgres(url, { max: 1, onnotice: () => {} });
    client = drizzle(rawClient);
  }

  try {
    // Upsert studio settings
    const existing = await client.select().from(studioSettings).limit(1);
    if (existing.length > 0) {
      await client
        .update(studioSettings)
        .set({
          studio_name: demoData.settings.studio_name,
          default_locale: demoData.settings.default_locale,
          timezone: demoData.settings.timezone,
          currency: demoData.settings.currency,
          updated_at: demoData.settings.updated_at,
        })
        .where(eq(studioSettings.id, existing[0].id));
    } else {
      await client.insert(studioSettings).values(demoData.settings);
    }

    // Insert tags (TASK-0010)
    for (const tag of demoData.tags) {
      await client
        .insert(tagsTable)
        .values({
          id: tag.id,
          name: tag.name,
          nameNormalized: tag.nameNormalized,
          createdAt: tag.createdAt,
          updatedAt: tag.updatedAt,
        })
        .onConflictDoNothing();
    }

    // Insert clients, contacts, addresses, and tags
    for (const cl of demoData.clients) {
      await client.insert(clientsTable).values({
        id: cl.id,
        kind: cl.kind,
        displayName: cl.displayName,
        preferredLocale: cl.preferredLocale,
        lastActivityAt: cl.lastActivityAt,
        createdAt: cl.createdAt,
        updatedAt: cl.updatedAt,
      });

      for (const contact of cl.contacts) {
        await client.insert(clientContactsTable).values({
          id: contact.id,
          clientId: contact.clientId,
          givenName: contact.givenName,
          familyName: contact.familyName,
          email: contact.email,
          emailNormalized: contact.emailNormalized,
          phone: contact.phone,
          isPrimary: contact.isPrimary,
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
        });
      }

      for (const addr of cl.addresses) {
        await client.insert(clientAddressesTable).values({
          id: addr.id,
          clientId: addr.clientId,
          type: addr.type,
          line1: addr.line1,
          line2: addr.line2,
          postalCode: addr.postalCode,
          city: addr.city,
          region: addr.region,
          countryCode: addr.countryCode,
          createdAt: addr.createdAt,
          updatedAt: addr.updatedAt,
        });
      }

      for (const tag of cl.tags) {
        await client
          .insert(clientTagsTable)
          .values({
            clientId: cl.id,
            tagId: tag.id,
            createdAt: cl.createdAt,
          })
          .onConflictDoNothing();
      }

      for (const note of cl.notes) {
        await client.insert(clientNotesTable).values({
          id: note.id,
          clientId: note.clientId,
          body: note.body,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        });
      }

      for (const event of cl.timelineEvents) {
        await client.insert(clientTimelineEventsTable).values({
          id: event.id,
          clientId: event.clientId,
          type: event.type,
          actorType: event.actorType,
          actorId: event.actorId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          occurredAt: event.occurredAt,
          data: event.data,
          createdAt: event.createdAt,
        });
      }
    }

    return {
      success: true,
      data: demoData,
    };
  } finally {
    if (rawClient) {
      await rawClient.end();
    }
  }
}

// CLI entry point
const isCli =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isCli) {
  try {
    const result = await seedDemo();
    console.log('✅ Synthetic demo seed completed successfully:');
    console.log(`  Studio: "${result.data.settings.studio_name}"`);
    console.log(`  Safe synthetic contacts generated: ${result.data.contacts.length}`);
    console.log(`  Safe synthetic clients generated: ${result.data.clients.length}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Demo seed failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
