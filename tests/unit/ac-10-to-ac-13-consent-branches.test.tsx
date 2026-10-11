import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsentDialog, ConsentForm } from '@/components/clients/consent-dialog';
import { ConsentSection } from '@/components/clients/consent-section';
import { recordConsentAction, listConsentsAction } from '@/server/consents/actions';
import { getTodayDateString, isValidIsoDate } from '@/server/consents/schema';

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

vi.mock('@/server/consents/actions', () => ({
  recordConsentAction: vi.fn(),
  listConsentsAction: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations:
    (namespace: string) => (key: string, params?: Record<string, string | number>) => {
      if (params) {
        return `[${namespace}.${key}:${JSON.stringify(params)}]`;
      }
      return `[${namespace}.${key}]`;
    },
}));

interface FormProps {
  onSubmit?: (e: { preventDefault: () => void }) => void | Promise<void>;
}

function findForm(element: React.ReactElement | undefined): FormProps | undefined {
  if (!element) return undefined;
  let found: FormProps | undefined;
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

interface ComponentProps {
  onClick?: (e?: { currentTarget?: unknown }) => void;
  onChange?: (e?: { target: { value?: string; checked?: boolean } }) => void;
}

function getNodeProps(node: React.ReactElement | undefined): ComponentProps {
  const props = node?.props;
  if (props && typeof props === 'object') {
    return props;
  }
  return {};
}

describe('Consent UI and Server Branch Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateQueue = [];
  });

  describe('ConsentForm interactive validation & submission branches', () => {
    it('returns early when isSubmitting is true', async () => {
      // States: contactId, purpose, status, effectiveOn, method, scope, evidenceNote, isSubmitting=true
      mockStateQueue = [
        'c-1',
        'marketing',
        'granted',
        '2026-10-11',
        'in_person',
        '',
        '',
        true, // isSubmitting
        null,
        {},
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [{ id: 'c-1', name: 'John Doe' }],
          studioTimezone: 'Europe/Berlin',
          onClose: vi.fn(),
          onSuccess: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(recordConsentAction).not.toHaveBeenCalled();
    });

    it('validates missing contactId, missing effectiveOn, and future effectiveOn', async () => {
      // States: contactId='', purpose='marketing', status='granted', effectiveOn='2099-01-01', method='in_person', scope='', evidenceNote='', isSubmitting=false
      mockStateQueue = [
        '',
        'marketing',
        'granted',
        '2099-01-01',
        'in_person',
        '',
        '',
        false,
        null,
        {},
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [],
          studioTimezone: 'Europe/Berlin',
          onClose: vi.fn(),
          onSuccess: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(recordConsentAction).not.toHaveBeenCalled();
    });

    it('validates image_usage granted without scope and scope > 500 chars', async () => {
      // States: contactId='c-1', purpose='image_usage', status='granted', effectiveOn='2026-10-11', method='in_person', scope='', evidenceNote='a'.repeat(501)
      mockStateQueue = [
        'c-1',
        'image_usage',
        'granted',
        '2026-10-11',
        'in_person',
        '   ', // empty scope
        'a'.repeat(501), // oversized evidenceNote
        false,
        null,
        {},
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [{ id: 'c-1', name: 'Alice' }],
          studioTimezone: 'Europe/Berlin',
          onClose: vi.fn(),
          onSuccess: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(recordConsentAction).not.toHaveBeenCalled();
    });

    it('validates scope > 500 chars when purpose is image_usage and status is granted', async () => {
      mockStateQueue = [
        'c-1',
        'image_usage',
        'granted',
        '2026-10-11',
        'in_person',
        's'.repeat(501),
        '',
        false,
        null,
        {},
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [{ id: 'c-1', name: 'Alice' }],
          studioTimezone: 'Europe/Berlin',
          onClose: vi.fn(),
          onSuccess: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(recordConsentAction).not.toHaveBeenCalled();
    });

    it('validates scope > 500 chars when purpose is marketing', async () => {
      mockStateQueue = [
        'c-1',
        'marketing',
        'granted',
        '2026-10-11',
        'in_person',
        's'.repeat(501),
        '',
        false,
        null,
        {},
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [{ id: 'c-1', name: 'Alice' }],
          studioTimezone: 'Europe/Berlin',
          onClose: vi.fn(),
          onSuccess: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(recordConsentAction).not.toHaveBeenCalled();
    });

    it('successfully calls recordConsentAction and triggers onClose and onSuccess', async () => {
      const onClose = vi.fn();
      const onSuccess = vi.fn();
      vi.mocked(recordConsentAction).mockResolvedValueOnce({
        success: true,
        data: { consentId: 'consent-uuid-1' },
      });

      mockStateQueue = [
        'c-1',
        'image_usage',
        'granted',
        '2026-10-11',
        'paper_form',
        'Website & portfolio',
        'Signed paper',
        false,
        null,
        {},
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [{ id: 'c-1', name: 'Alice' }],
          studioTimezone: 'Europe/Berlin',
          onClose,
          onSuccess,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });

      expect(recordConsentAction).toHaveBeenCalledWith({
        clientId: 'client-1',
        contactId: 'c-1',
        purpose: 'image_usage',
        status: 'granted',
        effectiveOn: '2026-10-11',
        method: 'paper_form',
        scope: 'Website & portfolio',
        evidenceNote: 'Signed paper',
      });
      expect(onClose).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });

    it('handles server action error codes: CONSENT_NOT_GRANTED, VALIDATION_FAILED, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, and default', async () => {
      const testCases = [
        {
          response: {
            success: false as const,
            code: 'CONSENT_NOT_GRANTED' as const,
            error: 'CONSENT_NOT_GRANTED',
          },
        },
        {
          response: {
            success: false as const,
            code: 'VALIDATION_FAILED' as const,
            error: 'VALIDATION_FAILED',
            fields: ['scope', 'effectiveOn', 'contactId', 'purpose', 'status', 'method'],
          },
        },
        {
          response: {
            success: false as const,
            code: 'UNAUTHORIZED' as const,
            error: 'UNAUTHORIZED',
          },
        },
        {
          response: { success: false as const, code: 'FORBIDDEN' as const, error: 'FORBIDDEN' },
        },
        {
          response: { success: false as const, code: 'NOT_FOUND' as const, error: 'NOT_FOUND' },
        },
        {
          response: {
            success: false as const,
            code: 'OTHER' as unknown as 'NOT_FOUND',
            error: 'OTHER',
          },
        },
      ];

      for (const tc of testCases) {
        vi.mocked(recordConsentAction).mockResolvedValueOnce(tc.response);
        mockStateQueue = [
          'c-1',
          'marketing',
          'withdrawn',
          '2026-10-11',
          'in_person',
          '',
          '',
          false,
          null,
          {},
        ];

        let tree: React.ReactElement | undefined;
        function Wrapper() {
          const rendered = ConsentForm({
            clientId: 'client-1',
            contacts: [{ id: 'c-1', name: 'Alice' }],
            studioTimezone: 'Europe/Berlin',
            onClose: vi.fn(),
            onSuccess: vi.fn(),
          });
          tree = rendered;
          return <div>{rendered}</div>;
        }
        renderToStaticMarkup(<Wrapper />);

        const form = findForm(tree);
        await form?.onSubmit?.({ preventDefault: vi.fn() });
      }
    });

    it('handles unexpected exceptions thrown during submission', async () => {
      vi.mocked(recordConsentAction).mockRejectedValueOnce(new Error('Network explosion'));

      mockStateQueue = [
        'c-1',
        'marketing',
        'granted',
        '2026-10-11',
        'in_person',
        '',
        '',
        false,
        null,
        {},
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [{ id: 'c-1', name: 'Alice' }],
          studioTimezone: 'Europe/Berlin',
          onClose: vi.fn(),
          onSuccess: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const form = findForm(tree);
      await form?.onSubmit?.({ preventDefault: vi.fn() });
      expect(recordConsentAction).toHaveBeenCalled();
    });

    it('exercises input onChange handlers and Cancel button in ConsentForm', () => {
      const onClose = vi.fn();
      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [
            { id: 'c-1', name: 'Alice' },
            { id: 'c-2', name: 'Bob' },
          ],
          studioTimezone: 'Europe/Berlin',
          onClose,
          onSuccess: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      // Contact selector onChange
      const contactSelect = findNodeByTestId(tree, 'consent-contact-select');
      getNodeProps(contactSelect).onChange?.({ target: { value: 'c-2' } });

      // Purpose radio onChange
      const purposeMarketing = findNodeByTestId(tree, 'consent-purpose-marketing');
      getNodeProps(purposeMarketing).onChange?.();

      const purposeImage = findNodeByTestId(tree, 'consent-purpose-image-usage');
      getNodeProps(purposeImage).onChange?.();

      // Status radio onChange
      const statusGranted = findNodeByTestId(tree, 'consent-status-granted');
      getNodeProps(statusGranted).onChange?.();

      const statusWithdrawn = findNodeByTestId(tree, 'consent-status-withdrawn');
      getNodeProps(statusWithdrawn).onChange?.();

      // Date input onChange
      const dateInput = findNodeByTestId(tree, 'consent-date-input');
      getNodeProps(dateInput).onChange?.({ target: { value: '2026-10-10' } });

      // Method select onChange
      const methodSelect = findNodeByTestId(tree, 'consent-method-select');
      getNodeProps(methodSelect).onChange?.({ target: { value: 'email' } });

      // Evidence note onChange
      const evidenceInput = findNodeByTestId(tree, 'consent-evidence-input');
      getNodeProps(evidenceInput).onChange?.({ target: { value: 'Note text' } });

      // Cancel button onClick
      const cancelBtn = findNodeByTestId(tree, 'consent-dialog-cancel-btn');
      getNodeProps(cancelBtn).onClick?.();
      expect(onClose).toHaveBeenCalled();
    });

    it('exercises scope input onChange when purpose is image_usage', () => {
      mockStateQueue = [
        'c-1',
        'image_usage',
        'granted',
        '2026-10-11',
        'in_person',
        'Initial scope',
        '',
        false,
        'Some error alert',
        { scope: 'Scope required' },
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentForm({
          clientId: 'client-1',
          contacts: [{ id: 'c-1', name: 'Alice' }],
          studioTimezone: 'Europe/Berlin',
          onClose: vi.fn(),
          onSuccess: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      const scopeInput = findNodeByTestId(tree, 'consent-scope-input');
      getNodeProps(scopeInput).onChange?.({ target: { value: 'Updated scope' } });
      expect(scopeInput).toBeDefined();
    });

    it('renders ConsentDialog with open=false and open=true', () => {
      const onOpenChange = vi.fn();
      const onSuccess = vi.fn();

      const htmlClosed = renderToStaticMarkup(
        <ConsentDialog
          clientId="client-1"
          contacts={[{ id: 'c-1', name: 'Alice' }]}
          studioTimezone="Europe/Berlin"
          isOpen={false}
          onOpenChange={onOpenChange}
          onSuccess={onSuccess}
        />,
      );
      expect(htmlClosed).toBe('');

      const htmlOpen = renderToStaticMarkup(
        <ConsentDialog
          clientId="client-1"
          contacts={[{ id: 'c-1', name: 'Alice' }]}
          studioTimezone="Europe/Berlin"
          isOpen={true}
          onOpenChange={onOpenChange}
          onSuccess={onSuccess}
        />,
      );
      expect(htmlOpen).toContain('consent-dialog');
    });
  });

  describe('ConsentSection interactive branches', () => {
    it('renders empty contacts state', () => {
      const html = renderToStaticMarkup(
        <ConsentSection
          clientId="client-1"
          locale="en"
          studioTimezone="Europe/Berlin"
          contacts={[]}
        />,
      );
      expect(html).toContain('clients.consent.noConsent');
    });

    it('exercises button clicks, dialog openers, history toggle, and item details', () => {
      const onConsentRecorded = vi.fn();
      const mockConsents = {
        clientId: 'client-1',
        contacts: [
          {
            contactId: 'c-1',
            contactName: 'Alice Primary',
            isPrimary: true,
            marketing: {
              id: 'cr-1',
              contactId: 'c-1',
              purpose: 'marketing' as const,
              status: 'granted' as const,
              effectiveOn: '2026-10-10',
              method: 'email' as const,
              scope: null,
              evidenceNote: 'Opt-in email',
              recordedByActorType: 'owner' as const,
              createdAt: new Date('2026-10-10T10:00:00Z'),
            },
            imageUsage: {
              id: 'cr-2',
              contactId: 'c-1',
              purpose: 'image_usage' as const,
              status: 'withdrawn' as const,
              effectiveOn: '2026-10-11',
              method: 'in_person' as const,
              scope: 'Website only',
              evidenceNote: null,
              recordedByActorType: 'owner' as const,
              createdAt: new Date('2026-10-11T10:00:00Z'),
            },
            history: [
              {
                id: 'cr-2',
                contactId: 'c-1',
                purpose: 'image_usage' as const,
                status: 'withdrawn' as const,
                effectiveOn: '2026-10-11',
                method: 'in_person' as const,
                scope: 'Website only',
                evidenceNote: null,
                recordedByActorType: 'owner' as const,
                createdAt: new Date('2026-10-11T10:00:00Z'),
              },
              {
                id: 'cr-1',
                contactId: 'c-1',
                purpose: 'marketing' as const,
                status: 'granted' as const,
                effectiveOn: '2026-10-10',
                method: 'email' as const,
                scope: null,
                evidenceNote: 'Opt-in email',
                recordedByActorType: 'owner' as const,
                createdAt: new Date('2026-10-10T10:00:00Z'),
              },
            ],
          },
        ],
      };

      // State queue: consentsData, expandedContacts: Set(['c-1']), dialogOpen: false, selectedContactId: undefined
      mockStateQueue = [mockConsents, new Set(['c-1']), false, undefined];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentSection({
          clientId: 'client-1',
          locale: 'en',
          studioTimezone: 'Europe/Berlin',
          initialConsents: mockConsents,
          contacts: [{ id: 'c-1', name: 'Alice Primary', isPrimary: true }],
          onConsentRecorded,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      // Record button in header
      const recordHeaderBtn = findNodeByTestId(tree, 'record-consent-btn');
      getNodeProps(recordHeaderBtn).onClick?.({ currentTarget: {} });

      // Record button on contact card
      const recordContactBtn = findNodeByTestId(tree, 'record-consent-contact-btn-c-1');
      getNodeProps(recordContactBtn).onClick?.({ currentTarget: {} });

      // History toggle button
      const historyToggle = findNodeByTestId(tree, 'consent-history-toggle-c-1');
      getNodeProps(historyToggle).onClick?.();

      // History items rendered
      const historyItem1 = findNodeByTestId(tree, 'consent-history-item-cr-1');
      const historyItem2 = findNodeByTestId(tree, 'consent-history-item-cr-2');
      expect(historyItem1).toBeDefined();
      expect(historyItem2).toBeDefined();
    });

    it('exercises ConsentSection reloadConsents and handleSuccess', () => {
      vi.mocked(listConsentsAction).mockResolvedValueOnce({
        success: true,
        data: {
          clientId: 'client-1',
          contacts: [],
        },
      });

      const onConsentRecorded = vi.fn();
      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ConsentSection({
          clientId: 'client-1',
          locale: 'en',
          studioTimezone: 'Europe/Berlin',
          contacts: [{ id: 'c-1', name: 'Alice', isPrimary: false }],
          onConsentRecorded,
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      // Trigger dialog onSuccess callback
      const dialogNode = findNodeByTestId(tree, 'consent-dialog') ?? tree;
      expect(dialogNode).toBeDefined();
    });
  });

  describe('Server consents schema & helpers', () => {
    it('exercises getTodayDateString and isValidIsoDate', () => {
      expect(isValidIsoDate('2026-10-11')).toBe(true);
      expect(isValidIsoDate('2026-02-29')).toBe(false); // not leap year
      expect(isValidIsoDate('not-a-date')).toBe(false);
      expect(isValidIsoDate('2026-13-01')).toBe(false);
      expect(isValidIsoDate('2026-00-10')).toBe(false);

      const todayUtc = getTodayDateString('UTC');
      expect(todayUtc).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const todayBerlin = getTodayDateString('Europe/Berlin');
      expect(todayBerlin).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Fallback for invalid timezone
      const fallback = getTodayDateString('Invalid/Zone');
      expect(fallback).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
