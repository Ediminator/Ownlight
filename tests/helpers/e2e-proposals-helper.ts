import { type PGlite } from '@electric-sql/pglite';
import { E2E_PROJECT_INQUIRY_1_ID } from './e2e-projects-helper';

export const E2E_PACKAGE_WEDDING_ID = '01920000-0000-7000-8000-000000000101';
export const E2E_CATALOGUE_ITEM_1_ID = '01920000-0000-7000-8000-000000000111';
export const E2E_CATALOGUE_ITEM_2_ID = '01920000-0000-7000-8000-000000000112';
export const E2E_DRAFT_PROPOSAL_ID = '01920000-0000-7000-8000-000000000201';

export async function seedAllE2eProposals(pglite: PGlite): Promise<void> {
  const now = new Date().toISOString();

  // 1. Seed base package
  const existingPkg = await pglite.query<{ id: string }>(`SELECT id FROM packages WHERE id = $1`, [
    E2E_PACKAGE_WEDDING_ID,
  ]);
  if (existingPkg.rows.length === 0) {
    await pglite.query(
      `INSERT INTO packages (
        id, name, slug, description, project_type_key, base_price_minor, currency, tax_rate_basis_points, position, is_active, created_at, updated_at
      ) VALUES (
        $1, 'Intimate Wedding Story', 'intimate-wedding-story', 'Comprehensive wedding photography coverage.',
        'wedding', 280000, 'EUR', 1900, 0, true, $2, $2
      )`,
      [E2E_PACKAGE_WEDDING_ID, now],
    );

    await pglite.query(
      `INSERT INTO package_included_items (
        id, package_id, title, description, quantity, position, created_at, updated_at
      ) VALUES 
      ('01920000-0000-7000-8000-000000000102', $1, '8 Hours Continuous Coverage', 'From preparations to cake cutting', 1, 0, $2, $2),
      ('01920000-0000-7000-8000-000000000103', $1, '400+ High-Resolution Edited Images', 'Delivered in digital gallery', 400, 1, $2, $2)`,
      [E2E_PACKAGE_WEDDING_ID, now],
    );
  }

  // 2. Seed catalogue add-ons
  const existingCat1 = await pglite.query<{ id: string }>(
    `SELECT id FROM catalogue_items WHERE id = $1`,
    [E2E_CATALOGUE_ITEM_1_ID],
  );
  if (existingCat1.rows.length === 0) {
    await pglite.query(
      `INSERT INTO catalogue_items (
        id, name, slug, description, category, unit_price_minor, currency, tax_rate_basis_points, position, is_active, created_at, updated_at
      ) VALUES (
        $1, 'Extra Photography Hour', 'extra-photography-hour', 'Additional hour of coverage on the event day',
        'service', 25000, 'EUR', 1900, 0, true, $2, $2
      )`,
      [E2E_CATALOGUE_ITEM_1_ID, now],
    );
  }

  const existingCat2 = await pglite.query<{ id: string }>(
    `SELECT id FROM catalogue_items WHERE id = $1`,
    [E2E_CATALOGUE_ITEM_2_ID],
  );
  if (existingCat2.rows.length === 0) {
    await pglite.query(
      `INSERT INTO catalogue_items (
        id, name, slug, description, category, unit_price_minor, currency, tax_rate_basis_points, position, is_active, created_at, updated_at
      ) VALUES (
        $1, 'Fine Art Linen Album 30x30', 'fine-art-linen-album-30x30', 'Handcrafted 30-page album with archival paper',
        'product', 45000, 'EUR', 1900, 1, true, $2, $2
      )`,
      [E2E_CATALOGUE_ITEM_2_ID, now],
    );
  }

  // 3. Seed sample draft proposal on E2E_PROJECT_INQUIRY_1_ID
  const projectRes = await pglite.query<{ client_id: string }>(
    `SELECT client_id FROM projects WHERE id = $1`,
    [E2E_PROJECT_INQUIRY_1_ID],
  );
  if (projectRes.rows.length > 0 && projectRes.rows[0]) {
    const clientId = projectRes.rows[0].client_id;
    const existingProposal = await pglite.query<{ id: string }>(
      `SELECT id FROM proposals WHERE id = $1`,
      [E2E_DRAFT_PROPOSAL_ID],
    );
    if (existingProposal.rows.length === 0) {
      await pglite.query(
        `INSERT INTO proposals (
          id, project_id, client_id, title, status, version, currency,
          subtotal_minor, tax_minor, total_minor, prices_include_tax, is_kleinunternehmer,
          tax_notice, token_hash, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 'Emma & Liam Wedding Photography Proposal', 'draft', 1, 'EUR',
          305000, 48700, 305000, true, false,
          NULL, '0192000000007000800000000000020101920000000070008000000000000201', $4, $4
        )`,
        [E2E_DRAFT_PROPOSAL_ID, E2E_PROJECT_INQUIRY_1_ID, clientId, now],
      );

      await pglite.query(
        `INSERT INTO proposal_line_items (
          id, proposal_id, package_id, catalogue_item_id, item_type, name, description,
          unit_price_minor, quantity, min_quantity, max_quantity, tax_rate_basis_points,
          is_optional, is_selected, position, created_at, updated_at
        ) VALUES
        (
          '01920000-0000-7000-8000-000000000202', $1, $2, NULL, 'base_package',
          'Intimate Wedding Story', 'Included Deliverables:\n• 8 Hours Continuous Coverage\n• 400+ High-Resolution Edited Images',
          280000, 1, 1, 1, 1900, false, true, 0, $3, $3
        ),
        (
          '01920000-0000-7000-8000-000000000203', $1, NULL, $4, 'addon',
          'Extra Photography Hour', 'Additional hour of coverage on the event day',
          25000, 1, 0, 2, 1900, true, true, 1, $3, $3
        )`,
        [E2E_DRAFT_PROPOSAL_ID, E2E_PACKAGE_WEDDING_ID, now, E2E_CATALOGUE_ITEM_1_ID],
      );
    }
  }
}
