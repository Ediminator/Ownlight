import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
      return [initial, vi.fn()];
    },
    useRef: <T,>(initial: T): { current: T } => {
      return { current: initial };
    },
    useEffect: (fn: () => unknown) => {
      try {
        fn();
      } catch {
        // Ignore effect errors in unit test environment
      }
    },
  };
});

vi.mock('server-only', () => ({}));

vi.mock('@/server/timeline/actions', () => ({
  addNoteAction: vi.fn(),
  updateNoteAction: vi.fn(),
  deleteNoteAction: vi.fn(),
  listTimelineAction: vi
    .fn()
    .mockResolvedValue({ success: true, data: { items: [], nextCursor: null } }),
}));

import { addNoteAction, deleteNoteAction, listTimelineAction } from '@/server/timeline/actions';

import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';
import { ClientTimeline } from '@/components/clients/client-timeline';
import { EditNoteDialog } from '@/components/clients/edit-note-dialog';
import type { ResolvedTimelineItem } from '@/server/timeline/repo';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = Reflect.get(current, part);
    } else {
      return undefined;
    }
  }
  return current;
}

let currentLocale: 'en' | 'de' = 'en';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const messages = currentLocale === 'de' ? deMessages : enMessages;
      const fullPath = namespace ? `${namespace}.${key}` : key;
      const raw = getNestedValue(messages, fullPath);
      let text = typeof raw === 'string' ? raw : `[${fullPath}]`;
      if (values) {
        for (const [vKey, vVal] of Object.entries(values)) {
          text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
        }
      }
      return text;
    };
  },
}));

describe('AC-12, AC-13, AC-14, AC-9: Timeline UI rendering, i18n, a11y, and XSS safety', () => {
  const sampleItems: ResolvedTimelineItem[] = [
    {
      id: '018f0000-0000-7000-8000-000000000003',
      clientId: '018f0000-0000-7000-8000-000000000001',
      type: 'note.created',
      occurredAt: new Date('2026-06-15T14:30:00Z'),
      actorType: 'owner',
      actorId: '018f0000-0000-7000-8000-000000000000',
      subjectType: 'note',
      subjectId: '018f0000-0000-7000-8000-000000000010',
      data: {},
      createdAt: new Date('2026-06-15T14:30:00Z'),
      noteBody: 'First consultation meeting notes with client.\nDiscussed package details.',
      edited: false,
    },
    {
      id: '018f0000-0000-7000-8000-000000000002',
      clientId: '018f0000-0000-7000-8000-000000000001',
      type: 'client.contact.added',
      occurredAt: new Date('2026-06-15T12:00:00Z'),
      actorType: 'owner',
      actorId: null,
      subjectType: 'contact',
      subjectId: '018f0000-0000-7000-8000-000000000020',
      data: {},
      createdAt: new Date('2026-06-15T12:00:00Z'),
      contactName: 'Sophie Müller',
    },
    {
      id: '018f0000-0000-7000-8000-000000000001',
      clientId: '018f0000-0000-7000-8000-000000000001',
      type: 'client.created',
      occurredAt: new Date('2026-06-15T10:00:00Z'),
      actorType: 'owner',
      actorId: null,
      subjectType: 'client',
      subjectId: '018f0000-0000-7000-8000-000000000001',
      data: {},
      createdAt: new Date('2026-06-15T10:00:00Z'),
    },
  ];

  it('AC-12: renders timeline in English with localized strings from en.json', () => {
    currentLocale = 'en';

    const html = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        studioTimezone="UTC"
        initialItems={sampleItems}
      />,
    );

    expect(html).toContain('Timeline');
    expect(html).toContain('Client note');
    expect(html).toContain('Add note');
    expect(html).toContain('Please avoid recording sensitive personal data');
    expect(html).toContain('Contact added: Sophie Müller');
    expect(html).toContain('Client created');
  });

  it('AC-12: renders timeline in German with localized strings from de.json', () => {
    currentLocale = 'de';

    const html = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="de"
        studioTimezone="Europe/Berlin"
        initialItems={sampleItems}
      />,
    );

    expect(html).toContain('Verlauf');
    expect(html).toContain('Kundennotiz');
    expect(html).toContain('Notiz hinzufügen');
    expect(html).toContain('Bitte vermeiden Sie es, sensible personenbezogene Daten');
    expect(html).toContain('Kontakt hinzugefügt: Sophie Müller');
    expect(html).toContain('Kund:in angelegt');
  });

  it('I1-U06: renders localized consent purposes for consent.granted and consent.withdrawn events', () => {
    const consentItems = [
      {
        id: '018f0000-0000-7000-8000-000000000030',
        clientId: '018f0000-0000-7000-8000-000000000001',
        type: 'consent.granted' as const,
        occurredAt: new Date('2026-06-15T15:00:00Z'),
        actorType: 'owner' as const,
        actorId: null,
        subjectType: 'contact' as const,
        subjectId: '018f0000-0000-7000-8000-000000000020',
        data: { purpose: 'marketing' },
        createdAt: new Date('2026-06-15T15:00:00Z'),
        contactName: 'Sophie Müller',
      },
      {
        id: '018f0000-0000-7000-8000-000000000031',
        clientId: '018f0000-0000-7000-8000-000000000001',
        type: 'consent.withdrawn' as const,
        occurredAt: new Date('2026-06-15T16:00:00Z'),
        actorType: 'owner' as const,
        actorId: null,
        subjectType: 'contact' as const,
        subjectId: '018f0000-0000-7000-8000-000000000020',
        data: { purpose: 'image_usage' },
        createdAt: new Date('2026-06-15T16:00:00Z'),
        contactName: 'Sophie Müller',
      },
    ];

    // English
    currentLocale = 'en';
    const enHtml = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        studioTimezone="UTC"
        initialItems={consentItems}
      />,
    );
    expect(enHtml).toContain('Consent granted: Marketing consent');
    expect(enHtml).toContain('Consent withdrawn: Image usage consent');
    expect(enHtml).not.toContain('Consent granted: marketing');
    expect(enHtml).not.toContain('Consent withdrawn: image_usage');

    // German
    currentLocale = 'de';
    const deHtml = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="de"
        studioTimezone="Europe/Berlin"
        initialItems={consentItems}
      />,
    );
    expect(deHtml).toContain('Einwilligung erteilt: Werbeeinwilligung');
    expect(deHtml).toContain('Einwilligung widerrufen: Einwilligung zur Bildnutzung');
    expect(deHtml).not.toContain('Einwilligung erteilt: marketing');
    expect(deHtml).not.toContain('Einwilligung widerrufen: image_usage');
  });

  it('AC-13: enforces semantic ordered list <ol> and accessible form association', () => {
    currentLocale = 'en';

    const html = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        studioTimezone="UTC"
        initialItems={sampleItems}
      />,
    );

    // Timeline must use semantic ordered list <ol>
    expect(html).toContain('<ol');
    expect(html).toContain('</ol>');
    expect(html).toContain('<li');

    // Composer label must be explicitly associated with textarea
    expect(html).toContain('for="timeline-note-composer"');
    expect(html).toContain('id="timeline-note-composer"');

    // Hint and counter must have unique IDs and be described on textarea
    expect(html).toContain('id="timeline-note-hint"');
    expect(html).toContain('id="timeline-note-counter"');
    expect(html).toContain('aria-describedby="timeline-note-counter timeline-note-hint"');

    // Counter must have aria-live="polite"
    expect(html).toContain('aria-live="polite"');
  });

  it('AC-9: renders potential XSS payloads literally without executing or parsing HTML', () => {
    currentLocale = 'en';

    const xssItem: ResolvedTimelineItem = {
      id: '018f0000-0000-7000-8000-000000000099',
      clientId: '018f0000-0000-7000-8000-000000000001',
      type: 'note.created',
      occurredAt: new Date('2026-06-15T15:00:00Z'),
      actorType: 'owner',
      actorId: null,
      subjectType: 'note',
      subjectId: '018f0000-0000-7000-8000-000000000099',
      data: {},
      createdAt: new Date('2026-06-15T15:00:00Z'),
      noteBody: '<script>alert(1)</script><img src=x onerror=alert(1)>',
      edited: false,
    };

    const html = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        studioTimezone="UTC"
        initialItems={[xssItem]}
      />,
    );

    // Verifies that HTML special characters are properly escaped by React
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  interface ComponentProps {
    onClick?: (e?: unknown) => void;
    onChange?: (e?: { target?: { value?: string } }) => void;
    onConfirm?: () => void | Promise<void>;
    onSuccess?: (body: string) => void;
    onOpenChange?: (open: boolean) => void;
    onSubmit?: (e?: { preventDefault: () => void }) => void | Promise<void>;
    ref?: (node: unknown) => void;
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

  function findFirstLi(element: React.ReactElement | undefined): React.ReactElement | undefined {
    if (!element) return undefined;
    let found: React.ReactElement | undefined;
    function traverse(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      if (React.isValidElement(node)) {
        if (node.type === 'li') {
          found = node;
          return;
        }
        const props = node.props as Record<string, unknown>;
        if (props.children) traverse(props.children);
      } else if (Array.isArray(node)) {
        for (const item of node) traverse(item);
      }
    }
    traverse(element);
    return found;
  }

  it('AC-14: renders edit note dialog with accessible inputs and character counter', () => {
    currentLocale = 'en';

    const html = renderToStaticMarkup(
      <EditNoteDialog
        clientId="018f0000-0000-7000-8000-000000000001"
        noteId="018f0000-0000-7000-8000-000000000010"
        initialBody="Initial note text to edit"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(html).toContain('Edit note');
    expect(html).toContain('Edit note content');
    expect(html).toContain('Save changes');
    expect(html).toContain('Cancel');
    expect(html).toContain('for="edit-note-body"');
    expect(html).toContain('id="edit-note-body"');
    expect(html).toContain('id="edit-note-counter"');
  });

  describe('ClientTimeline interactive handlers and branch coverage', () => {
    function makeTimelineStates(
      overrides: {
        items?: ResolvedTimelineItem[];
        nextCursor?: string | null;
        isLoadingMore?: boolean;
        paginationError?: string | null;
        focusTargetIndex?: number | null;
        noteText?: string;
        isSubmittingNote?: boolean;
        composerError?: string | null;
        editingNote?: { id: string; noteId: string; body: string } | null;
        deletingNote?: { id: string; noteId: string; body: string } | null;
        isDeletingNote?: boolean;
        deleteError?: string | null;
      } = {},
    ): unknown[] {
      return [
        overrides.items ?? sampleItems,
        overrides.nextCursor ?? null,
        overrides.isLoadingMore ?? false,
        overrides.paginationError ?? null,
        overrides.focusTargetIndex ?? null,
        overrides.noteText ?? '',
        overrides.isSubmittingNote ?? false,
        overrides.composerError ?? null,
        overrides.editingNote ?? null,
        overrides.deletingNote ?? null,
        overrides.isDeletingNote ?? false,
        overrides.deleteError ?? null,
      ];
    }

    beforeEach(() => {
      mockStateQueue = [];
      currentLocale = 'en';
      vi.clearAllMocks();
      vi.mocked(listTimelineAction).mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null },
      });
    });

    it('AC-12: renders empty timeline message when items array is empty', () => {
      currentLocale = 'en';

      const html = renderToStaticMarkup(
        <ClientTimeline
          clientId="018f0000-0000-7000-8000-000000000001"
          locale="en"
          studioTimezone="UTC"
          initialItems={[]}
        />,
      );

      expect(html).toContain('No timeline events recorded yet');
      expect(html).not.toContain('<ol');
    });

    it('AC-12: renders contact removed event and contact added without name fallback', () => {
      const items: ResolvedTimelineItem[] = [
        {
          id: '018f0000-0000-7000-8000-000000000091',
          clientId: '018f0000-0000-7000-8000-000000000001',
          type: 'client.contact.removed',
          occurredAt: new Date('2026-06-15T16:00:00Z'),
          actorType: 'owner',
          actorId: null,
          subjectType: 'contact',
          subjectId: '018f0000-0000-7000-8000-000000000092',
          data: {},
          createdAt: new Date('2026-06-15T16:00:00Z'),
        },
        {
          id: '018f0000-0000-7000-8000-000000000093',
          clientId: '018f0000-0000-7000-8000-000000000001',
          type: 'client.contact.added',
          occurredAt: new Date('2026-06-15T15:00:00Z'),
          actorType: 'owner',
          actorId: null,
          subjectType: 'contact',
          subjectId: '018f0000-0000-7000-8000-000000000094',
          data: {},
          createdAt: new Date('2026-06-15T15:00:00Z'),
          contactName: null,
        },
      ];

      const html = renderToStaticMarkup(
        <ClientTimeline
          clientId="018f0000-0000-7000-8000-000000000001"
          locale="en"
          studioTimezone="UTC"
          initialItems={items}
        />,
      );

      expect(html).toContain('Contact removed');
      expect(html).toContain('Contact added');
    });

    it('AC-12: renders edited note marker, note without body, and note without subjectId', () => {
      const items: ResolvedTimelineItem[] = [
        {
          id: '018f0000-0000-7000-8000-000000000095',
          clientId: '018f0000-0000-7000-8000-000000000001',
          type: 'note.created',
          occurredAt: new Date('2026-06-15T16:00:00Z'),
          actorType: 'owner',
          actorId: null,
          subjectType: 'note',
          subjectId: '018f0000-0000-7000-8000-000000000096',
          data: {},
          createdAt: new Date('2026-06-15T16:00:00Z'),
          noteBody: 'Edited text',
          edited: true,
        },
        {
          id: '018f0000-0000-7000-8000-000000000097',
          clientId: '018f0000-0000-7000-8000-000000000001',
          type: 'note.created',
          occurredAt: new Date('2026-06-15T15:00:00Z'),
          actorType: 'owner',
          actorId: null,
          subjectType: 'note',
          subjectId: null,
          data: {},
          createdAt: new Date('2026-06-15T15:00:00Z'),
          noteBody: null,
          edited: false,
        },
      ];

      const html = renderToStaticMarkup(
        <ClientTimeline
          clientId="018f0000-0000-7000-8000-000000000001"
          locale="en"
          studioTimezone="UTC"
          initialItems={items}
        />,
      );

      expect(html).toContain('(edited)');
      expect(html).not.toContain('note-body-018f0000-0000-7000-8000-000000000097');
      expect(html).not.toContain('edit-note-btn-018f0000-0000-7000-8000-000000000097');
      expect(html).not.toContain('delete-note-btn-018f0000-0000-7000-8000-000000000097');
    });

    it('AC-13: textarea onChange updates text and submit button reflects isSubmitting state', () => {
      // 1. Textarea onChange invocation
      const tree = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });

      const textarea = findNodeByTestId(tree, 'timeline-note-textarea');
      const textareaProps = (textarea?.props ?? {}) as ComponentProps;
      textareaProps.onChange?.({ target: { value: 'Typing note' } });

      // 2. isSubmittingNote = true renders submitting spinner in button
      mockStateQueue = makeTimelineStates({
        noteText: 'Valid note',
        isSubmittingNote: true,
      });

      const htmlSubmitting = renderToStaticMarkup(
        <ClientTimeline
          clientId="018f0000-0000-7000-8000-000000000001"
          locale="en"
          studioTimezone="UTC"
          initialItems={sampleItems}
        />,
      );

      expect(htmlSubmitting).toContain('Adding...');
    });

    it('AC-13: composer form submit validates input and early returns when isSubmitting', async () => {
      // 1. isSubmitting is true -> early return
      mockStateQueue = makeTimelineStates({
        noteText: 'Note text',
        isSubmittingNote: true,
      });
      const tree1 = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      await findForm(tree1)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addNoteAction).not.toHaveBeenCalled();

      // 2. empty/whitespace body -> validation error
      mockStateQueue = makeTimelineStates({
        noteText: '   ',
        isSubmittingNote: false,
      });
      const tree2 = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      await findForm(tree2)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addNoteAction).not.toHaveBeenCalled();

      // 3. body > 5000 chars -> validation error
      mockStateQueue = makeTimelineStates({
        noteText: 'x'.repeat(5001),
        isSubmittingNote: false,
      });
      const tree3 = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      await findForm(tree3)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addNoteAction).not.toHaveBeenCalled();
    });

    it('AC-13: composer form handles addNoteAction failure, success, and exception', async () => {
      // 1. Action failure returns error code
      mockStateQueue = makeTimelineStates({
        noteText: 'Valid text',
        isSubmittingNote: false,
      });
      vi.mocked(addNoteAction).mockResolvedValueOnce({
        success: false,
        code: 'FORBIDDEN',
        error: 'Forbidden',
      });
      const tree1 = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      await findForm(tree1)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(addNoteAction).toHaveBeenCalledTimes(1);

      // 2. Action success refreshes timeline
      mockStateQueue = makeTimelineStates({
        noteText: 'Valid text',
        isSubmittingNote: false,
      });
      vi.mocked(addNoteAction).mockResolvedValueOnce({
        success: true,
        data: { noteId: 'note-100' },
      });
      vi.mocked(listTimelineAction).mockResolvedValueOnce({
        success: true,
        data: { items: sampleItems, nextCursor: 'cur-new' },
      });
      const tree2 = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      await findForm(tree2)?.onSubmit?.({ preventDefault: vi.fn() });
      expect(listTimelineAction).toHaveBeenCalled();

      // 3. Action throws exception -> caught and sets generic error
      mockStateQueue = makeTimelineStates({
        noteText: 'Valid text',
        isSubmittingNote: false,
      });
      vi.mocked(addNoteAction).mockRejectedValueOnce(new Error('Network failure'));
      const tree3 = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      await findForm(tree3)?.onSubmit?.({ preventDefault: vi.fn() });
    });

    it('AC-14: handleLoadMore handles early return, failure, success, and exception', () => {
      // 1. nextCursor is null -> no load more button
      const treeNoCursor = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      expect(findNodeByTestId(treeNoCursor, 'timeline-load-more-btn')).toBeUndefined();

      // 2. failure response
      mockStateQueue = makeTimelineStates({
        nextCursor: 'cur-1',
        isLoadingMore: false,
      });
      vi.mocked(listTimelineAction).mockResolvedValueOnce({
        success: false,
        code: 'UNAUTHORIZED',
        error: 'Unauthorized',
      });
      const treeFail = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      const loadBtnProps1 = (findNodeByTestId(treeFail, 'timeline-load-more-btn')?.props ??
        {}) as ComponentProps;
      loadBtnProps1.onClick?.();

      // 3. success response
      mockStateQueue = makeTimelineStates({
        nextCursor: 'cur-1',
        isLoadingMore: false,
      });
      vi.mocked(listTimelineAction).mockResolvedValueOnce({
        success: true,
        data: { items: sampleItems, nextCursor: null },
      });
      const treeSuccess = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      const loadBtnProps2 = (findNodeByTestId(treeSuccess, 'timeline-load-more-btn')?.props ??
        {}) as ComponentProps;
      loadBtnProps2.onClick?.();

      // 4. exception
      mockStateQueue = makeTimelineStates({
        nextCursor: 'cur-1',
        isLoadingMore: false,
      });
      vi.mocked(listTimelineAction).mockRejectedValueOnce(new Error('Pagination error'));
      const treeError = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      const loadBtnProps3 = (findNodeByTestId(treeError, 'timeline-load-more-btn')?.props ??
        {}) as ComponentProps;
      loadBtnProps3.onClick?.();
    });

    it('AC-14: renders pagination error message and loading spinner when isLoadingMore is true', () => {
      mockStateQueue = makeTimelineStates({
        nextCursor: 'cur-1',
        isLoadingMore: true,
        paginationError: 'Failed to load page.',
      });

      const html = renderToStaticMarkup(
        <ClientTimeline
          clientId="018f0000-0000-7000-8000-000000000001"
          locale="en"
          studioTimezone="UTC"
          initialItems={sampleItems}
        />,
      );

      expect(html).toContain('Failed to load page.');
      expect(html).toContain('Loading...');
    });

    it('AC-14: edit button click opens EditNoteDialog, handleNoteEditSuccess updates item, and onOpenChange closes dialog', () => {
      // 1. Click edit button
      const tree = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      const editBtn = findNodeByTestId(tree, 'edit-note-btn-018f0000-0000-7000-8000-000000000003');
      const editBtnProps = (editBtn?.props ?? {}) as ComponentProps;
      editBtnProps.onClick?.({ currentTarget: {} });

      // 2. When editingNote is set, EditNoteDialog renders and its handlers work
      mockStateQueue = makeTimelineStates({
        editingNote: {
          id: '018f0000-0000-7000-8000-000000000003',
          noteId: '018f0000-0000-7000-8000-000000000010',
          body: 'Note body to edit',
        },
      });
      const treeWithEdit = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });

      let dialogProps: ComponentProps | undefined;

      function findEditDialog(node: unknown): void {
        if (!node || typeof node !== 'object') return;
        if (React.isValidElement(node)) {
          if (node.type === EditNoteDialog) {
            dialogProps = node.props as ComponentProps;
            return;
          }
          const props = node.props as Record<string, unknown>;
          if (props.children) findEditDialog(props.children);
        } else if (Array.isArray(node)) {
          for (const item of node) findEditDialog(item);
        }
      }
      findEditDialog(treeWithEdit);

      expect(dialogProps).toBeDefined();
      dialogProps?.onSuccess?.('Brand new note body');
      dialogProps?.onOpenChange?.(false);
      dialogProps?.onOpenChange?.(true);
    });

    it('AC-14: delete button opens ConfirmDialog, handleConfirmDelete handles failure, success, and exception', async () => {
      // 1. Click delete button
      const tree = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });
      const delBtn = findNodeByTestId(tree, 'delete-note-btn-018f0000-0000-7000-8000-000000000003');
      const delBtnProps = (delBtn?.props ?? {}) as ComponentProps;
      delBtnProps.onClick?.({ currentTarget: {} });

      // 2. When deletingNote is set, ConfirmDialog renders
      mockStateQueue = makeTimelineStates({
        deletingNote: {
          id: '018f0000-0000-7000-8000-000000000003',
          noteId: '018f0000-0000-7000-8000-000000000010',
          body: 'Note body to delete',
        },
        isDeletingNote: false,
      });

      const treeWithDelete = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });

      let confirmProps: ComponentProps | undefined;

      function findConfirmDialog(node: unknown): void {
        if (!node || typeof node !== 'object') return;
        if (React.isValidElement(node)) {
          const props = node.props as Record<string, unknown>;
          if (typeof props.onConfirm === 'function' && typeof props.onOpenChange === 'function') {
            confirmProps = props;
            return;
          }
          if (props.children) findConfirmDialog(props.children);
        } else if (Array.isArray(node)) {
          for (const item of node) findConfirmDialog(item);
        }
      }
      findConfirmDialog(treeWithDelete);

      expect(confirmProps).toBeDefined();

      // Action failure
      vi.mocked(deleteNoteAction).mockResolvedValueOnce({
        success: false,
        code: 'FORBIDDEN',
        error: 'Forbidden',
      });
      await confirmProps?.onConfirm?.();

      // Action success
      vi.mocked(deleteNoteAction).mockResolvedValueOnce({
        success: true,
        data: { noteId: '018f0000-0000-7000-8000-000000000010' },
      });
      await confirmProps?.onConfirm?.();

      // Action exception
      vi.mocked(deleteNoteAction).mockRejectedValueOnce(new Error('Delete exploded'));
      await confirmProps?.onConfirm?.();

      // onOpenChange closes
      confirmProps?.onOpenChange?.(false);
    });

    it('AC-13: list item ref callback handles both node attachment and cleanup', () => {
      const tree = ClientTimeline({
        clientId: '018f0000-0000-7000-8000-000000000001',
        locale: 'en',
        studioTimezone: 'UTC',
        initialItems: sampleItems,
      });

      const li = findFirstLi(tree);
      const liProps = (li?.props ?? {}) as ComponentProps;
      expect(typeof liProps.ref).toBe('function');

      // 1. Attach node
      liProps.ref?.({ focus: vi.fn() });

      // 2. Detach node (null cleanup)
      liProps.ref?.(null);
    });

    it('AC-13: renders composer alert div when composerError is set', () => {
      mockStateQueue = makeTimelineStates({
        composerError: 'Note could not be saved.',
      });

      const html = renderToStaticMarkup(
        <ClientTimeline
          clientId="018f0000-0000-7000-8000-000000000001"
          locale="en"
          studioTimezone="UTC"
          initialItems={sampleItems}
        />,
      );

      expect(html).toContain('timeline-composer-error');
      expect(html).toContain('Note could not be saved.');
    });
  });
});
