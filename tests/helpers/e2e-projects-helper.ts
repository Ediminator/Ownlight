import { type PGlite } from '@electric-sql/pglite';
import { E2E_LEAD_CONVERTED_ID } from './e2e-leads-helper';

export const E2E_STAGE_INQUIRY_ID = '01920000-0000-7000-8000-000000000001';
export const E2E_STAGE_BOOKED_ID = '01920000-0000-7000-8000-000000000002';
export const E2E_STAGE_SHOT_ID = '01920000-0000-7000-8000-000000000003';
export const E2E_STAGE_EDITING_ID = '01920000-0000-7000-8000-000000000004';
export const E2E_STAGE_DELIVERED_ID = '01920000-0000-7000-8000-000000000005';
export const E2E_STAGE_ARCHIVED_ID = '01920000-0000-7000-8000-000000000006';

export const E2E_PROJECT_INQUIRY_1_ID = '01920000-0000-7000-8000-000000000071';
export const E2E_PROJECT_INQUIRY_2_ID = '01920000-0000-7000-8000-000000000072';
export const E2E_PROJECT_BOOKED_ID = '01920000-0000-7000-8000-000000000073';
export const E2E_PROJECT_SHOT_ID = '01920000-0000-7000-8000-000000000074';
export const E2E_PROJECT_EDITING_ID = '01920000-0000-7000-8000-000000000075';
export const E2E_PROJECT_DELIVERED_ID = '01920000-0000-7000-8000-000000000076';

export const E2E_CLIENT_1_ID = '01920000-0000-7000-8000-000000000081';
export const E2E_CLIENT_2_ID = '01920000-0000-7000-8000-000000000082';
export const E2E_CLIENT_3_ID = '01920000-0000-7000-8000-000000000083';
export const E2E_CLIENT_4_ID = '01920000-0000-7000-8000-000000000084';
export const E2E_CLIENT_5_ID = '01920000-0000-7000-8000-000000000085';
export const E2E_CLIENT_6_ID = '01920000-0000-7000-8000-000000000086';

export async function seedAllE2eProjects(pglite: PGlite): Promise<void> {
  const now = new Date().toISOString();

  // 1. Fetch 6 existing clients from seedDemo so we do NOT insert extra client rows and break clients.spec.ts pagination (50 clients = 2 pages)
  const existingClients = await pglite.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM clients ORDER BY created_at ASC LIMIT 6`,
  );
  if (existingClients.rows.length < 6) {
    throw new Error(
      `Expected at least 6 clients in database, found ${String(existingClients.rows.length)}`,
    );
  }

  const client0 = existingClients.rows[0];
  const client1 = existingClients.rows[1];
  const client2 = existingClients.rows[2];
  const client3 = existingClients.rows[3];
  const client4 = existingClients.rows[4];
  const client5 = existingClients.rows[5];

  if (!client0 || !client1 || !client2 || !client3 || !client4 || !client5) {
    throw new Error('Failed to resolve all 6 clients');
  }

  // Update display_name on first client so AC-1 test expecting 'Emma Watson' passes
  await pglite.query(`UPDATE clients SET display_name = 'Emma Watson' WHERE id = $1`, [client0.id]);

  // 2. Seed Projects across stages
  const projectsData = [
    {
      id: E2E_PROJECT_INQUIRY_1_ID,
      clientId: client0.id,
      stageId: E2E_STAGE_INQUIRY_ID,
      leadId: E2E_LEAD_CONVERTED_ID,
      title: 'Emma & Liam Wedding',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: '2027-06-19T10:00:00.000Z',
      currency: 'EUR',
      priceMinor: 250000, // €2,500.00
    },
    {
      id: E2E_PROJECT_INQUIRY_2_ID,
      clientId: client1.id,
      stageId: E2E_STAGE_INQUIRY_ID,
      leadId: null,
      title: 'Lucas Portrait Session',
      projectTypeKey: 'portrait',
      primaryShootStartsAt: '2027-07-10T14:00:00.000Z',
      currency: 'EUR',
      priceMinor: 600000, // €6,000.00 (Total in Inquiry: €8,500.00)
    },
    {
      id: E2E_PROJECT_BOOKED_ID,
      clientId: client2.id,
      stageId: E2E_STAGE_BOOKED_ID,
      leadId: null,
      title: 'Corporate Campaign',
      projectTypeKey: 'commercial',
      primaryShootStartsAt: '2027-08-01T09:00:00.000Z',
      currency: 'EUR',
      priceMinor: 300000, // €3,000.00
    },
    {
      id: E2E_PROJECT_SHOT_ID,
      clientId: client3.id,
      stageId: E2E_STAGE_SHOT_ID,
      leadId: null,
      title: 'Sarah & David Engagement',
      projectTypeKey: 'engagement',
      primaryShootStartsAt: '2027-05-15T16:00:00.000Z',
      currency: 'EUR',
      priceMinor: 120000, // €1,200.00
    },
    {
      id: E2E_PROJECT_EDITING_ID,
      clientId: client4.id,
      stageId: E2E_STAGE_EDITING_ID,
      leadId: null,
      title: 'Sophie & Noah Wedding',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: '2027-04-20T11:00:00.000Z',
      currency: 'EUR',
      priceMinor: 350000, // €3,500.00
    },
    {
      id: E2E_PROJECT_DELIVERED_ID,
      clientId: client5.id,
      stageId: E2E_STAGE_DELIVERED_ID,
      leadId: null,
      title: 'Fashion Lookbook',
      projectTypeKey: 'editorial',
      primaryShootStartsAt: '2027-03-10T13:00:00.000Z',
      currency: 'EUR',
      priceMinor: 400000, // €4,000.00
    },
  ];

  for (const p of projectsData) {
    await pglite.query(
      `INSERT INTO projects (
        id, client_id, stage_id, lead_id, title, project_type_key, primary_shoot_starts_at,
        currency, price_minor, last_activity_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)
      ON CONFLICT (id) DO UPDATE SET
        stage_id = EXCLUDED.stage_id,
        title = EXCLUDED.title,
        price_minor = EXCLUDED.price_minor,
        lead_id = EXCLUDED.lead_id`,
      [
        p.id,
        p.clientId,
        p.stageId,
        p.leadId,
        p.title,
        p.projectTypeKey,
        p.primaryShootStartsAt,
        p.currency,
        p.priceMinor,
        now,
      ],
    );
  }

  // 3. Seed Tasks: 2 incomplete tasks for Sophie & Noah Wedding in Editing stage (for AC-4 testing)
  const editingTasks = [
    {
      id: '01920000-0000-7000-8000-000000000091',
      projectId: E2E_PROJECT_EDITING_ID,
      stageId: E2E_STAGE_EDITING_ID,
      title: 'Cull wedding images',
      isCompleted: false,
    },
    {
      id: '01920000-0000-7000-8000-000000000092',
      projectId: E2E_PROJECT_EDITING_ID,
      stageId: E2E_STAGE_EDITING_ID,
      title: 'Color grade highlight reel',
      isCompleted: false,
    },
    {
      id: '01920000-0000-7000-8000-000000000093',
      projectId: E2E_PROJECT_INQUIRY_1_ID,
      stageId: E2E_STAGE_INQUIRY_ID,
      title: 'Send pricing guide',
      isCompleted: true,
    },
  ];

  for (const task of editingTasks) {
    await pglite.query(
      `INSERT INTO project_tasks (
        id, project_id, stage_id, title, is_completed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $6)
      ON CONFLICT (id) DO UPDATE SET
        is_completed = EXCLUDED.is_completed,
        title = EXCLUDED.title`,
      [task.id, task.projectId, task.stageId, task.title, task.isCompleted, now],
    );
  }
}
