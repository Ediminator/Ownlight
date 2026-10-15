import { type PGlite } from '@electric-sql/pglite';

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

  // 1. Seed Clients
  const clientsData = [
    { id: E2E_CLIENT_1_ID, name: 'Emma Watson', locale: 'en' },
    { id: E2E_CLIENT_2_ID, name: 'Lucas Scott', locale: 'en' },
    { id: E2E_CLIENT_3_ID, name: 'Acme Studio Corp', locale: 'en' },
    { id: E2E_CLIENT_4_ID, name: 'Sarah & David', locale: 'en' },
    { id: E2E_CLIENT_5_ID, name: 'Sophie & Noah', locale: 'en' },
    { id: E2E_CLIENT_6_ID, name: 'Fashion Lookbook Inc', locale: 'en' },
  ];

  for (const c of clientsData) {
    await pglite.query(
      `INSERT INTO clients (
        id, kind, display_name, preferred_locale, last_activity_at, created_at, updated_at
      ) VALUES ($1, 'person', $2, $3, $4, $4, $4)
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [c.id, c.name, c.locale, now],
    );
  }

  // 2. Seed Projects across stages
  const projectsData = [
    {
      id: E2E_PROJECT_INQUIRY_1_ID,
      clientId: E2E_CLIENT_1_ID,
      stageId: E2E_STAGE_INQUIRY_ID,
      title: 'Emma & Liam Wedding',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: '2027-06-19T10:00:00.000Z',
      currency: 'EUR',
      priceMinor: 250000, // €2,500.00
    },
    {
      id: E2E_PROJECT_INQUIRY_2_ID,
      clientId: E2E_CLIENT_2_ID,
      stageId: E2E_STAGE_INQUIRY_ID,
      title: 'Lucas Portrait Session',
      projectTypeKey: 'portrait',
      primaryShootStartsAt: '2027-07-10T14:00:00.000Z',
      currency: 'EUR',
      priceMinor: 600000, // €6,000.00 (Total in Inquiry: €8,500.00)
    },
    {
      id: E2E_PROJECT_BOOKED_ID,
      clientId: E2E_CLIENT_3_ID,
      stageId: E2E_STAGE_BOOKED_ID,
      title: 'Corporate Campaign',
      projectTypeKey: 'commercial',
      primaryShootStartsAt: '2027-08-01T09:00:00.000Z',
      currency: 'EUR',
      priceMinor: 300000, // €3,000.00
    },
    {
      id: E2E_PROJECT_SHOT_ID,
      clientId: E2E_CLIENT_4_ID,
      stageId: E2E_STAGE_SHOT_ID,
      title: 'Sarah & David Engagement',
      projectTypeKey: 'engagement',
      primaryShootStartsAt: '2027-05-15T16:00:00.000Z',
      currency: 'EUR',
      priceMinor: 120000, // €1,200.00
    },
    {
      id: E2E_PROJECT_EDITING_ID,
      clientId: E2E_CLIENT_5_ID,
      stageId: E2E_STAGE_EDITING_ID,
      title: 'Sophie & Noah Wedding',
      projectTypeKey: 'wedding',
      primaryShootStartsAt: '2027-04-20T11:00:00.000Z',
      currency: 'EUR',
      priceMinor: 350000, // €3,500.00
    },
    {
      id: E2E_PROJECT_DELIVERED_ID,
      clientId: E2E_CLIENT_6_ID,
      stageId: E2E_STAGE_DELIVERED_ID,
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
        id, client_id, stage_id, title, project_type_key, primary_shoot_starts_at,
        currency, price_minor, last_activity_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)
      ON CONFLICT (id) DO UPDATE SET
        stage_id = EXCLUDED.stage_id,
        title = EXCLUDED.title,
        price_minor = EXCLUDED.price_minor`,
      [
        p.id,
        p.clientId,
        p.stageId,
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
