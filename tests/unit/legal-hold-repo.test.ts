import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getLegalHold, upsertLegalHold, deleteLegalHold } from '@/server/clients/legal-hold-repo';
import type { DbClient } from '@/server/db/client';

describe('TASK-0019: Legal Hold Repository Branches', () => {
  it('getLegalHold returns row when found and null when not found', async () => {
    const mockRow = { id: 'hold-1', clientId: 'c-1', reason: 'dispute' };
    const mockTxFound = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRow]),
          }),
        }),
      }),
    } as unknown as DbClient;

    const resFound = await getLegalHold('c-1', mockTxFound);
    expect(resFound).toEqual(mockRow);

    const mockTxNotFound = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as DbClient;

    const resNotFound = await getLegalHold('c-1', mockTxNotFound);
    expect(resNotFound).toBeNull();
  });

  it('upsertLegalHold inserts when existing is null and throws if insert fails', async () => {
    const mockInserted = { id: 'hold-new', clientId: 'c-1', reason: 'dispute' };

    // 1. Success insert
    const mockTxInsertSuccess = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockInserted]),
        }),
      }),
    } as unknown as DbClient;

    const resInsert = await upsertLegalHold(
      {
        clientId: 'c-1',
        reason: 'dispute',
        actorType: 'owner',
        actorId: 'user-1',
      },
      mockTxInsertSuccess,
    );
    expect(resInsert).toEqual({ hold: mockInserted, isUpdate: false });

    // 2. Insert returns empty array -> throws
    const mockTxInsertFail = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as DbClient;

    await expect(
      upsertLegalHold(
        {
          clientId: 'c-1',
          reason: 'dispute',
          actorType: 'owner',
          actorId: 'user-1',
        },
        mockTxInsertFail,
      ),
    ).rejects.toThrow('Failed to insert client legal hold');
  });

  it('upsertLegalHold updates when existing is found and throws if update fails', async () => {
    const mockExisting = { id: 'hold-1', clientId: 'c-1', reason: 'dispute' };
    const mockUpdated = { id: 'hold-1', clientId: 'c-1', reason: 'statutory', note: 'tax' };

    // 1. Success update
    const mockTxUpdateSuccess = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockExisting]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUpdated]),
          }),
        }),
      }),
    } as unknown as DbClient;

    const resUpdate = await upsertLegalHold(
      {
        clientId: 'c-1',
        reason: 'statutory',
        note: 'tax',
        until: '2028-01-01',
        actorType: 'owner',
        actorId: 'user-1',
      },
      mockTxUpdateSuccess,
    );
    expect(resUpdate).toEqual({ hold: mockUpdated, isUpdate: true });

    // 2. Update returns empty array -> throws
    const mockTxUpdateFail = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockExisting]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as DbClient;

    await expect(
      upsertLegalHold(
        {
          clientId: 'c-1',
          reason: 'statutory',
          actorType: 'owner',
          actorId: 'user-1',
        },
        mockTxUpdateFail,
      ),
    ).rejects.toThrow('Failed to update client legal hold');
  });

  it('deleteLegalHold returns deleted row or null if not found', async () => {
    const mockDeleted = { id: 'hold-1', clientId: 'c-1' };

    const mockTxSuccess = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockDeleted]),
        }),
      }),
    } as unknown as DbClient;

    const resSuccess = await deleteLegalHold('c-1', mockTxSuccess);
    expect(resSuccess).toEqual(mockDeleted);

    const mockTxNone = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as DbClient;

    const resNone = await deleteLegalHold('c-1', mockTxNone);
    expect(resNone).toBeNull();
  });
});
