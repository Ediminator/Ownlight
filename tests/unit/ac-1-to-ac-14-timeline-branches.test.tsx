import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { EditNoteDialog, EditNoteForm } from '@/components/clients/edit-note-dialog';
import {
  addNoteAction,
  updateNoteAction,
  deleteNoteAction,
  listTimelineAction,
} from '@/server/timeline/actions';
import { decodeTimelineCursor } from '@/server/timeline/cursor';
import { addNote, updateNote, deleteNote } from '@/server/timeline/service';
import {
  getClientTimelineEvents,
  insertTimelineEventRecord,
  insertClientNoteRecord,
} from '@/server/timeline/repo';
import { UnauthorizedError, ForbiddenError } from '@/server/auth/guards';

let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, (val: T) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [val, vi.fn()];
      }
      return actual.useState(initial);
    },
  };
});

vi.mock('server-only', () => ({}));

vi.mock('@/server/auth/guards', () => {
  class MockUnauthorizedError extends Error {
    constructor() {
      super('UNAUTHORIZED');
      this.name = 'UnauthorizedError';
    }
  }
  class MockForbiddenError extends Error {
    constructor() {
      super('FORBIDDEN');
      this.name = 'ForbiddenError';
    }
  }
  return {
    requireAuth: vi.fn(),
    UnauthorizedError: MockUnauthorizedError,
    ForbiddenError: MockForbiddenError,
  };
});

vi.mock('@/server/clients/policy', () => ({
  authorizeClientWrite: vi.fn(),
  authorizeClientRead: vi.fn(),
}));

vi.mock('@/server/timeline/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/timeline/actions')>();
  return {
    ...actual,
    updateNoteAction: vi.fn(actual.updateNoteAction),
  };
});

vi.mock('@/server/timeline/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/timeline/service')>();
  return {
    ...actual,
    addNote: vi.fn(actual.addNote),
    updateNote: vi.fn(actual.updateNote),
    deleteNote: vi.fn(actual.deleteNote),
    listTimeline: vi.fn(actual.listTimeline),
  };
});

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const table: Record<string, string> = {
      'clients.timeline.note.edit': 'Edit note',
      'clients.timeline.note.bodyLabel': 'Edit note content',
      'clients.timeline.note.cancel': 'Cancel',
      'clients.timeline.note.save': 'Save changes',
      'clients.timeline.note.saving': 'Saving...',
      'clients.errors.VALIDATION_FAILED': 'Validation failed.',
      'clients.errors.NOT_FOUND': 'Record not found.',
      'clients.errors.GENERIC_ERROR': 'An unexpected error occurred.',
    };
    const fullKey = `${namespace}.${key}`;
    return Object.prototype.hasOwnProperty.call(table, fullKey) ? table[fullKey] : `[${key}]`;
  },
}));

interface ComponentProps {
  onClick?: (e?: unknown) => void;
  onChange?: (e?: { target?: { value?: string } }) => void;
  onClose?: () => void;
  onCloseAutoFocus?: (e: { preventDefault: () => void }) => void;
  [key: string]: unknown;
}

function findNodeByTestId(
  element: React.ReactElement | undefined,
  testId: string,
): React.ReactElement | undefined {
  if (!element) return undefined;
  let found: React.ReactElement | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (props['data-testid'] === testId) {
        found = node;
        return;
      }
      if (props.children) traverse(props.children);
    } else if (Array.isArray(node)) {
      for (const item of node) traverse(item);
    }
  }
  traverse(element);
  return found;
}

function findForm(
  element: React.ReactElement | undefined,
): { onSubmit?: (e?: { preventDefault: () => void }) => void | Promise<void> } | undefined {
  if (!element) return undefined;
  let found:
    { onSubmit?: (e?: { preventDefault: () => void }) => void | Promise<void> } | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (node.type === 'form' || typeof props.onSubmit === 'function') {
        found = props;
        return;
      }
      if (props.children) traverse(props.children);
    } else if (Array.isArray(node)) {
      for (const item of node) traverse(item);
    }
  }
  traverse(element);
  return found;
}

function findNodeWithProp(
  element: React.ReactElement | undefined,
  propName: string,
): React.ReactElement | undefined {
  if (!element) return undefined;
  let found: React.ReactElement | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (propName in props) {
        found = node;
        return;
      }
      if (props.children) traverse(props.children);
    } else if (Array.isArray(node)) {
      for (const item of node) traverse(item);
    }
  }
  traverse(element);
  return found;
}

function getProps(element: React.ReactElement | undefined): ComponentProps {
  return (element?.props ?? {}) as ComponentProps;
}

describe('Timeline Branches & Edge Cases Unit Tests', () => {
  beforeEach(() => {
    mockStateQueue = [];
    vi.clearAllMocks();
  });

  describe('EditNoteForm & EditNoteDialog branch coverage', () => {
    it('EditNoteForm: early returns when isSubmitting is true', async () => {
      mockStateQueue = ['Updated note text', true, null]; // isSubmitting = true
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();

      const tree = EditNoteForm({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: 'Updated note text',
        onClose: mockClose,
        onSuccess: mockSuccess,
      });

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateNoteAction).not.toHaveBeenCalled();
    });

    it('EditNoteForm: validates empty body and body > 5000 chars', async () => {
      // 1. Empty body
      mockStateQueue = ['   ', false, null];
      const tree1 = EditNoteForm({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: '',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree1)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateNoteAction).not.toHaveBeenCalled();

      // 2. Body > 5000 chars
      mockStateQueue = ['a'.repeat(5001), false, null];
      const tree2 = EditNoteForm({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: '',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree2)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateNoteAction).not.toHaveBeenCalled();
    });

    it('EditNoteForm: handles successful submission calling onSuccess and onClose', async () => {
      const mockSuccess = vi.fn();
      const mockClose = vi.fn();
      mockStateQueue = ['Valid edited note body', false, null];

      vi.mocked(updateNoteAction).mockResolvedValueOnce({
        success: true,
        data: { noteId: 'n1' },
      });

      const tree = EditNoteForm({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: 'Initial',
        onClose: mockClose,
        onSuccess: mockSuccess,
      });

      await findForm(tree)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(updateNoteAction).toHaveBeenCalledWith({
        clientId: 'c1',
        noteId: 'n1',
        body: 'Valid edited note body',
      });
      expect(mockSuccess).toHaveBeenCalledWith('Valid edited note body');
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('EditNoteForm: handles server error response and exceptions', async () => {
      // Server error response
      mockStateQueue = ['Edited body', false, null];
      vi.mocked(updateNoteAction).mockResolvedValueOnce({
        success: false,
        code: 'NOT_FOUND',
        error: 'Record not found.',
      });

      const tree1 = EditNoteForm({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: 'Initial',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree1)?.onSubmit?.({ preventDefault: vi.fn() });

      // Exception thrown
      mockStateQueue = ['Edited body', false, null];
      vi.mocked(updateNoteAction).mockRejectedValueOnce(new Error('Network failure'));
      const tree2 = EditNoteForm({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: 'Initial',
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      });
      await findForm(tree2)?.onSubmit?.({ preventDefault: vi.fn() });
    });

    it('EditNoteForm: cancel button invokes onClose', () => {
      const mockClose = vi.fn();
      mockStateQueue = ['Initial', false, null];
      const tree = EditNoteForm({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: 'Initial',
        onClose: mockClose,
        onSuccess: vi.fn(),
      });

      const cancelBtn = findNodeByTestId(tree, 'edit-note-cancel-btn');
      getProps(cancelBtn).onClick?.();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('EditNoteDialog: handles triggerRef auto focus and dialog onClose wrapper', () => {
      const mockOpenChange = vi.fn();
      const mockFocus = vi.fn();
      const fakeTrigger = { current: { focus: mockFocus } as unknown as HTMLElement };

      mockStateQueue = ['Body', false, null];
      const tree = EditNoteDialog({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: 'Body',
        isOpen: true,
        triggerRef: fakeTrigger,
        onOpenChange: mockOpenChange,
        onSuccess: vi.fn(),
      });

      const content = findNodeByTestId(tree, 'edit-note-dialog');
      const fakeEvent = { preventDefault: vi.fn() };
      getProps(content).onCloseAutoFocus?.(fakeEvent);
      expect(fakeEvent.preventDefault).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();

      // Check onClose wrapper inside EditNoteDialog calls onOpenChange(false)
      const formNode = findNodeWithProp(tree, 'onClose');
      getProps(formNode).onClose?.();
      expect(mockOpenChange).toHaveBeenCalledWith(false);

      // Without trigger
      mockStateQueue = ['Body', false, null];
      const treeNoTrigger = EditNoteDialog({
        clientId: 'c1',
        noteId: 'n1',
        initialBody: 'Body',
        isOpen: true,
        onOpenChange: mockOpenChange,
        onSuccess: vi.fn(),
      });
      const contentNoTrigger = findNodeByTestId(treeNoTrigger, 'edit-note-dialog');
      const fakeEvent2 = { preventDefault: vi.fn() };
      getProps(contentNoTrigger).onCloseAutoFocus?.(fakeEvent2);
      expect(fakeEvent2.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('timeline server actions error handling branches', () => {
    it('handles UnauthorizedError and ForbiddenError across all actions', async () => {
      const { requireAuth } = await import('@/server/auth/guards');

      // 1. Unauthorized
      vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());
      const r1 = await addNoteAction({
        clientId: '018f0000-0000-7000-8000-000000000001',
        body: 'test',
      });
      expect(r1).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());
      const r2 = await updateNoteAction({
        clientId: '018f0000-0000-7000-8000-000000000001',
        noteId: '018f0000-0000-7000-8000-000000000002',
        body: 'test',
      });
      expect(r2).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());
      const r3 = await deleteNoteAction({
        clientId: '018f0000-0000-7000-8000-000000000001',
        noteId: '018f0000-0000-7000-8000-000000000002',
      });
      expect(r3).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());
      const r4 = await listTimelineAction({ clientId: '018f0000-0000-7000-8000-000000000001' });
      expect(r4).toEqual({ success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' });

      // 2. Forbidden
      vi.mocked(requireAuth).mockRejectedValueOnce(new ForbiddenError());
      const f1 = await addNoteAction({
        clientId: '018f0000-0000-7000-8000-000000000001',
        body: 'test',
      });
      expect(f1).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      vi.mocked(requireAuth).mockRejectedValueOnce(new ForbiddenError());
      const f2 = await updateNoteAction({
        clientId: '018f0000-0000-7000-8000-000000000001',
        noteId: '018f0000-0000-7000-8000-000000000002',
        body: 'test',
      });
      expect(f2).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      vi.mocked(requireAuth).mockRejectedValueOnce(new ForbiddenError());
      const f3 = await deleteNoteAction({
        clientId: '018f0000-0000-7000-8000-000000000001',
        noteId: '018f0000-0000-7000-8000-000000000002',
      });
      expect(f3).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });

      vi.mocked(requireAuth).mockRejectedValueOnce(new ForbiddenError());
      const f4 = await listTimelineAction({ clientId: '018f0000-0000-7000-8000-000000000001' });
      expect(f4).toEqual({ success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' });
    });

    it('handles input validation failure across actions', async () => {
      const { requireAuth } = await import('@/server/auth/guards');
      vi.mocked(requireAuth).mockResolvedValue({
        user: { id: 'u1', role: 'owner', email: 'owner@example.com' },
        session: { id: 's1' },
      } as unknown as Awaited<ReturnType<typeof requireAuth>>);

      // Missing or invalid inputs
      const v1 = await addNoteAction({ clientId: 'invalid-uuid', body: '' });
      expect(v1.success).toBe(false);
      expect(v1.code).toBe('VALIDATION_FAILED');

      const v2 = await updateNoteAction({
        clientId: 'invalid-uuid',
        noteId: 'invalid-note-uuid',
        body: '',
      });
      expect(v2.success).toBe(false);
      expect(v2.code).toBe('VALIDATION_FAILED');

      const v3 = await deleteNoteAction({ clientId: 'invalid-uuid', noteId: 'invalid-note-uuid' });
      expect(v3.success).toBe(false);
      expect(v3.code).toBe('VALIDATION_FAILED');

      const v4 = await listTimelineAction({ clientId: 'invalid-uuid' });
      expect(v4.success).toBe(false);
      expect(v4.code).toBe('VALIDATION_FAILED');

      // extractClientId with non-object, null, and empty clientId
      const v5 = await addNoteAction(null);
      expect(v5.success).toBe(false);
      expect(v5.code).toBe('VALIDATION_FAILED');

      const v6 = await addNoteAction('not-an-object');
      expect(v6.success).toBe(false);
      expect(v6.code).toBe('VALIDATION_FAILED');

      const v7 = await addNoteAction({ clientId: '' });
      expect(v7.success).toBe(false);
      expect(v7.code).toBe('VALIDATION_FAILED');
    });

    it('actions rethrow generic errors from auth or policy', async () => {
      const { requireAuth } = await import('@/server/auth/guards');
      vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Generic auth failure'));
      await expect(
        addNoteAction({ clientId: '018f0000-0000-7000-8000-000000000001', body: 'text' }),
      ).rejects.toThrow('Generic auth failure');

      vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Generic auth failure'));
      await expect(
        updateNoteAction({
          clientId: '018f0000-0000-7000-8000-000000000001',
          noteId: '018f0000-0000-7000-8000-000000000002',
          body: 'text',
        }),
      ).rejects.toThrow('Generic auth failure');

      vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Generic auth failure'));
      await expect(
        deleteNoteAction({
          clientId: '018f0000-0000-7000-8000-000000000001',
          noteId: '018f0000-0000-7000-8000-000000000002',
        }),
      ).rejects.toThrow('Generic auth failure');

      vi.mocked(requireAuth).mockRejectedValueOnce(new Error('Generic auth failure'));
      await expect(
        listTimelineAction({ clientId: '018f0000-0000-7000-8000-000000000001' }),
      ).rejects.toThrow('Generic auth failure');
    });
  });

  describe('cursor edge cases and service client not found', () => {
    it('decodeTimelineCursor returns null on invalid parts or structure', () => {
      // 1. Missing date part
      const b64MissingDate = Buffer.from('|018f0000-0000-7000-8000-000000000001|sig').toString(
        'base64url',
      );
      expect(decodeTimelineCursor(b64MissingDate)).toBeNull();

      // 2. Missing id part
      const b64MissingId = Buffer.from('2026-06-15T12:00:00.000Z||sig').toString('base64url');
      expect(decodeTimelineCursor(b64MissingId)).toBeNull();

      // 3. Missing sig part
      const b64MissingSig = Buffer.from(
        '2026-06-15T12:00:00.000Z|018f0000-0000-7000-8000-000000000001|',
      ).toString('base64url');
      expect(decodeTimelineCursor(b64MissingSig)).toBeNull();

      // 4. Invalid base64 or decode error
      expect(decodeTimelineCursor('invalid-cursor-value-without-delimiters')).toBeNull();
    });

    it('service.addNote returns NOT_FOUND if client does not exist in DB', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]), // Client not found
            }),
          }),
        }),
      };

      const result = await addNote(
        { clientId: '018f0000-0000-7000-8000-000000000001', body: 'Note body' },
        { user: { id: 'u1', role: 'owner' } } as unknown as Parameters<typeof addNote>[1],
        mockDb as unknown as Parameters<typeof addNote>[2],
      );

      expect(result).toEqual({ success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' });
    });

    it('service functions handle apiKey actor type with id, prefix, and missing apiKey', async () => {
      const mockDbClientExists = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: '018f0000-0000-7000-8000-000000000001' }]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([{ id: 'audit-1' }]),
          }),
        }),
        transaction: (cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            insert: () => ({
              values: () => ({
                returning: () =>
                  Promise.resolve([
                    {
                      id: 'note-1',
                      clientId: '018f0000-0000-7000-8000-000000000001',
                      body: 'text',
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                  ]),
              }),
            }),
            update: () => ({
              set: () => ({
                where: () => Promise.resolve(),
              }),
            }),
          }),
      };

      // 1. apiKey with id
      const r1 = await addNote(
        { clientId: '018f0000-0000-7000-8000-000000000001', body: 'text' },
        {
          authType: 'apiKey',
          apiKey: { id: 'key_123', prefix: 'own_' },
          user: { id: 'u1', role: 'owner' },
        } as unknown as Parameters<typeof addNote>[1],
        mockDbClientExists as unknown as Parameters<typeof addNote>[2],
      );
      expect(r1.success).toBe(true);

      // 2. apiKey with prefix (no id)
      const r2 = await addNote(
        { clientId: '018f0000-0000-7000-8000-000000000001', body: 'text' },
        {
          authType: 'apiKey',
          apiKey: { prefix: 'own_' },
          user: { id: 'u1', role: 'owner' },
        } as unknown as Parameters<typeof addNote>[1],
        mockDbClientExists as unknown as Parameters<typeof addNote>[2],
      );
      expect(r2.success).toBe(true);

      // 3. apiKey with undefined apiKey
      const r3 = await addNote(
        { clientId: '018f0000-0000-7000-8000-000000000001', body: 'text' },
        {
          authType: 'apiKey',
          apiKey: undefined,
          user: { id: 'u1', role: 'owner' },
        } as unknown as Parameters<typeof addNote>[1],
        mockDbClientExists as unknown as Parameters<typeof addNote>[2],
      );
      expect(r3.success).toBe(true);
    });

    it('service.updateNote and deleteNote return NOT_FOUND if note does not exist, and handle success', async () => {
      const mockDbNoNote = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      };

      const r1 = await updateNote(
        {
          clientId: '018f0000-0000-7000-8000-000000000001',
          noteId: '018f0000-0000-7000-8000-000000000002',
          body: 'new text',
        },
        { user: { id: 'u1', role: 'owner' } } as unknown as Parameters<typeof updateNote>[1],
        mockDbNoNote as unknown as Parameters<typeof updateNote>[2],
      );
      expect(r1).toEqual({ success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' });

      const r2 = await deleteNote(
        {
          clientId: '018f0000-0000-7000-8000-000000000001',
          noteId: '018f0000-0000-7000-8000-000000000002',
        },
        { user: { id: 'u1', role: 'owner' } } as unknown as Parameters<typeof deleteNote>[1],
        mockDbNoNote as unknown as Parameters<typeof deleteNote>[2],
      );
      expect(r2).toEqual({ success: false, code: 'NOT_FOUND', error: 'NOT_FOUND' });

      // Successful update and delete with transaction
      const mockDbSuccess = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: '018f0000-0000-7000-8000-000000000002',
                    clientId: '018f0000-0000-7000-8000-000000000001',
                    body: 'old text',
                  },
                ]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([{ id: 'audit-1' }]),
          }),
        }),
        transaction: (cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            update: () => ({
              set: () => {
                const whereObj = {
                  returning: () =>
                    Promise.resolve([
                      {
                        id: '018f0000-0000-7000-8000-000000000002',
                        clientId: '018f0000-0000-7000-8000-000000000001',
                        body: 'new text',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      },
                    ]),
                  then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
                };
                return {
                  where: () => whereObj,
                };
              },
            }),
            delete: () => ({
              where: () => ({
                returning: () => Promise.resolve([{ id: '018f0000-0000-7000-8000-000000000002' }]),
              }),
            }),
          }),
      };

      const r3 = await updateNote(
        {
          clientId: '018f0000-0000-7000-8000-000000000001',
          noteId: '018f0000-0000-7000-8000-000000000002',
          body: 'new text',
        },
        { user: { id: 'u1', role: 'owner' } } as unknown as Parameters<typeof updateNote>[1],
        mockDbSuccess as unknown as Parameters<typeof updateNote>[2],
      );
      expect(r3.success).toBe(true);

      const r4 = await deleteNote(
        {
          clientId: '018f0000-0000-7000-8000-000000000001',
          noteId: '018f0000-0000-7000-8000-000000000002',
        },
        { user: { id: 'u1', role: 'owner' } } as unknown as Parameters<typeof deleteNote>[1],
        mockDbSuccess as unknown as Parameters<typeof deleteNote>[2],
      );
      expect(r4.success).toBe(true);
    });

    it('repo functions throw when insert returns no row', async () => {
      const mockTxNoRow = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      };

      await expect(
        insertTimelineEventRecord(
          mockTxNoRow as unknown as Parameters<typeof insertTimelineEventRecord>[0],
          {
            clientId: '018f0000-0000-7000-8000-000000000001',
            type: 'client.created',
            occurredAt: new Date(),
            actorType: 'owner',
            data: {},
          },
        ),
      ).rejects.toThrow('Failed to insert timeline event');

      await expect(
        insertClientNoteRecord(
          mockTxNoRow as unknown as Parameters<typeof insertClientNoteRecord>[0],
          {
            clientId: '018f0000-0000-7000-8000-000000000001',
            body: 'text',
          },
        ),
      ).rejects.toThrow('Failed to insert client note');
    });

    it('repo getClientTimelineEvents handles missing note in notesMap and contactName fallback', async () => {
      const mockDbEvents = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () =>
                  Promise.resolve([
                    // note.created event whose noteId does not exist in notesMap (simulates deleted note row)
                    {
                      id: '018f0000-0000-7000-8000-000000000010',
                      clientId: '018f0000-0000-7000-8000-000000000001',
                      type: 'note.created',
                      occurredAt: new Date(),
                      actorType: 'owner',
                      actorId: null,
                      subjectType: 'note',
                      subjectId: 'missing-note-id',
                      data: {},
                      createdAt: new Date(),
                    },
                    // contact.added event whose contactId does not exist in contactsMap (simulates deleted contact)
                    {
                      id: '018f0000-0000-7000-8000-000000000020',
                      clientId: '018f0000-0000-7000-8000-000000000001',
                      type: 'client.contact.added',
                      occurredAt: new Date(),
                      actorType: 'owner',
                      actorId: null,
                      subjectType: 'contact',
                      subjectId: 'missing-contact-id',
                      data: {},
                      createdAt: new Date(),
                    },
                  ]),
              }),
              then: (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const result = await getClientTimelineEvents(
        '018f0000-0000-7000-8000-000000000001',
        null,
        20,
        mockDbEvents as unknown as Parameters<typeof getClientTimelineEvents>[3],
      );

      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.noteBody).toBeNull();
      expect(result.items[0]?.edited).toBe(false);
      expect(result.items[1]?.contactName).toBeNull();
    });
  });
});
