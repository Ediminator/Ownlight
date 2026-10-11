import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)): [T, (val: T) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [val, vi.fn()];
      }
      return actual.useState(initial);
    },
  };
});

const mockPlanErasureAction = vi.fn();
const mockExecuteErasureAction = vi.fn();
vi.mock('@/server/privacy/erasure/actions', () => ({
  planErasureAction: (args: unknown): Promise<unknown> => {
    return Promise.resolve(mockPlanErasureAction(args));
  },
  executeErasureAction: (args: unknown): Promise<unknown> => {
    return Promise.resolve(mockExecuteErasureAction(args));
  },
}));

const mockReauthenticateAction = vi.fn();
vi.mock('@/server/auth/mfa-actions', () => ({
  reauthenticateAction: (args: unknown): Promise<unknown> => {
    return Promise.resolve(mockReauthenticateAction(args));
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="mock-dialog">{children}</div> : null,
  DialogContent: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <div data-testid="mock-dialog-content" {...props}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  DialogDescription: ({
    children,
    id,
    className,
  }: {
    children: React.ReactNode;
    id?: string;
    className?: string;
  }) => (
    <p id={id} className={className}>
      {children}
    </p>
  ),
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <footer className={className}>{children}</footer>
  ),
}));

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
  onClick?: (e?: unknown) => void;
  onChange?: (e?: { target: { value?: string } }) => void;
  onSubmit?: (e?: { preventDefault: () => void }) => void | Promise<void>;
  disabled?: boolean;
  value?: unknown;
  children?: React.ReactNode;
}

function getNodeProps(node: React.ReactElement | undefined): ComponentProps {
  const props = node?.props as ComponentProps | undefined;
  if (props && typeof props === 'object') {
    return props;
  }
  return {};
}

function findFormNode(element: unknown): ComponentProps | undefined {
  if (!element || typeof element !== 'object') return undefined;
  if (React.isValidElement(element)) {
    const props = element.props as ComponentProps;
    if (element.type === 'form' || typeof props.onSubmit === 'function') {
      return props;
    }
    if (props.children) {
      const res = findFormNode(props.children);
      if (res) return res;
    }
  } else if (Array.isArray(element)) {
    for (const item of element) {
      const res = findFormNode(item);
      if (res) return res;
    }
  }
  return undefined;
}

import { ErasureDialog, ErasureDialogInner } from '@/components/clients/erasure-dialog';

describe('TASK-0016: ErasureDialog component (AC-1, AC-3, AC-4, AC-10, AC-11, AC-12, AC-13)', () => {
  beforeEach(() => {
    mockStateQueue = [];
    currentLocale = 'en';
    vi.clearAllMocks();
  });

  it('renders null when open is false or subject is null', () => {
    const htmlClosed = renderToStaticMarkup(
      <ErasureDialog
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Jane Doe"
        open={false}
        onOpenChange={vi.fn()}
      />,
    );
    expect(htmlClosed).toBe('');

    const htmlNoSubject = renderToStaticMarkup(
      <ErasureDialog
        subject={null}
        clientDisplayName="Jane Doe"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(htmlNoSubject).toBe('');
  });

  it('AC-1: renders loading state initially when plan is being fetched', () => {
    // useState sequence:
    // [0] isLoadingPlan = true
    // [1] categoryCounts = {}
    // [2] holds = []
    // [3] notesMayMentionPerson = false
    // [4] targetDisplayName = 'Jane Doe'
    // [5] confirmation = ''
    // [6] isSubmitting = false
    // [7] error = null
    // [8] reauthRequired = false
    // [9] password = ''
    // [10] isReauthenticating = false
    mockStateQueue = [
      true, // isLoadingPlan
      {}, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Jane Doe', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Jane Doe"
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Delete client');
    expect(html).toContain('Loading erasure plan...');
    expect(html).toContain('data-testid="erasure-loading-spinner"');
  });

  it('AC-10: renders client erasure plan with category counts and disabled confirm button when confirmation is empty', () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1, contacts: 2, addresses: 1, tags: 3, notes: 2, timeline: 5, consents: 2 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Acme Studio"
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Delete client');
    expect(html).toContain('Data to be erased');
    expect(html).toContain('Client profile');
    expect(html).toContain('Contacts');
    expect(html).toContain('Addresses');
    expect(html).toContain('Tag assignments');
    expect(html).toContain('Notes');
    expect(html).toContain('Timeline events');
    expect(html).toContain('Consent records');

    // Counts present
    expect(html).toContain('data-testid="erasure-count-contacts"');
    expect(html).toContain('data-testid="erasure-count-notes"');

    // Confirmation input and submit button disabled
    expect(html).toContain('data-testid="erasure-confirmation-input"');
    expect(html).toContain('data-testid="erasure-submit-btn"');
    expect(html).toContain('disabled=""');
  });

  it('AC-10: enables submit button when confirmation matches target client name', () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1, contacts: 1 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      'Acme Studio', // confirmation matching display name
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Acme Studio"
        onOpenChange={vi.fn()}
      />,
    );

    // Confirmation matches -> submit button is not disabled
    expect(html).toContain('data-testid="erasure-submit-btn"');
    // Button should not have disabled attribute
    const btnSection = html.slice(html.indexOf('data-testid="erasure-submit-btn"'));
    const btnTag = btnSection.slice(0, btnSection.indexOf('>'));
    expect(btnTag).not.toContain('disabled');
  });

  it('AC-3: renders warning that client notes may mention person for contact erasure', () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { contacts: 1, consents: 1, timeline: 2 }, // categoryCounts
      [], // holds
      true, // notesMayMentionPerson = true
      'John Doe', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'contact', clientId: 'c1', contactId: 'ct1' }}
        clientDisplayName="Acme Studio"
        contactName="John Doe"
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Erase person');
    expect(html).toContain('Review client notes');
    expect(html).toContain('data-testid="erasure-notes-warning"');
    expect(html).toContain(
      'Other free-text notes for this client may mention this person. Please review client notes manually after erasure.',
    );
  });

  it('AC-4: when retention holds exist, displays holds and offers NO confirm button', () => {
    const mockHolds = [
      {
        providerId: 'statutory-tax-hold',
        reason: 'Statutory 10-year commercial/tax retention (§147 AO, §257 HGB)',
        retainUntil: new Date('2036-12-31T23:59:59Z'),
      },
    ];

    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1, contacts: 1 }, // categoryCounts
      mockHolds, // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Acme Studio"
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Erasure blocked by active retention hold');
    expect(html).toContain('Statutory 10-year commercial/tax retention');
    expect(html).toContain('data-testid="erasure-hold-item"');
    // AC-4, AC-10: offers NO confirm button, only Close button
    expect(html).not.toContain('data-testid="erasure-submit-btn"');
    expect(html).toContain('data-testid="erasure-close-btn"');
  });

  it('AC-10: displays re-authentication step when reauthRequired is true', () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      null, // error
      true, // reauthRequired = true
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Acme Studio"
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Re-authentication required');
    expect(html).toContain('data-testid="erasure-password-input"');
    expect(html).toContain('data-testid="erasure-confirm-password-btn"');
    expect(html).toContain('Confirm and proceed');
  });

  it('AC-11: renders completely in German with all strings sourced from de.json', () => {
    currentLocale = 'de';
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1, contacts: 1, notes: 2 }, // categoryCounts
      [], // holds
      true, // notesMayMentionPerson
      'Musterfirma', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Musterfirma"
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Kunden löschen');
    expect(html).toContain('Zu löschende Daten');
    expect(html).toContain('Kundenprofil');
    expect(html).toContain('Kontakte');
    expect(html).toContain('Notizen');
    expect(html).toContain('Kundennotizen prüfen');
    expect(html).toContain('Abbrechen');
    // Ensure no untranslated keys like "[privacy.erasure." remain
    expect(html).not.toContain('[privacy.erasure');
    expect(html).not.toContain('[clients.');
  });

  it('AC-12: destructive buttons are identified with clear text and icon, not color alone (SC 1.4.1)', () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Jane Doe', // targetDisplayName
      'Jane Doe', // confirmation
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Jane Doe"
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Delete client');
    expect(html).toContain('data-testid="erasure-submit-btn"');
    // Check that SVG icon is rendered alongside the descriptive text
    expect(html).toContain('lucide-trash-2');
  });

  it('AC-13: touch targets on buttons are at least 24x24 px and confirmation input has a visible label', () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Jane Doe', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Jane Doe"
        onOpenChange={vi.fn()}
      />,
    );

    // Visible label for confirmation input with htmlFor linking to input id
    expect(html).toContain('for="erasure-confirmation"');
    expect(html).toContain('id="erasure-confirmation"');
    // Min height classes ensuring minimum touch targets (exceeds 24px)
    expect(html).toContain('min-h-[38px]');
  });

  it('AC-10: handles interactive confirmation input change, cancellation, and execution', async () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      'Acme Studio', // confirmation matching
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    let tree: React.ReactElement | undefined;
    function Wrapper() {
      const rendered = ErasureDialogInner({
        subject: { kind: 'client', clientId: 'c1' },
        clientDisplayName: 'Acme Studio',
        onOpenChange,
        onSuccess,
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper />);

    // Test input change
    const confirmInput = findNodeByTestId(tree, 'erasure-confirmation-input');
    getNodeProps(confirmInput).onChange?.({ target: { value: 'Acme Studio' } });

    // Test cancel button
    const cancelBtn = findNodeByTestId(tree, 'erasure-cancel-btn');
    getNodeProps(cancelBtn).onClick?.();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Test submit button execution success
    mockExecuteErasureAction.mockResolvedValueOnce({
      success: true,
      subjectKind: 'client',
    });

    const submitBtn = findNodeByTestId(tree, 'erasure-submit-btn');
    getNodeProps(submitBtn).onClick?.();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockExecuteErasureAction).toHaveBeenCalledWith({
      subject: { kind: 'client', clientId: 'c1' },
      confirmation: 'Acme Studio',
    });
    expect(onSuccess).toHaveBeenCalledWith('client');
  });

  it('AC-10: handles contact erasure execution success', async () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { contacts: 1 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Alice Smith', // targetDisplayName
      'Alice Smith', // confirmation matching
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    let tree: React.ReactElement | undefined;
    function Wrapper() {
      const rendered = ErasureDialogInner({
        subject: { kind: 'contact', clientId: 'c1', contactId: 'ct1' },
        clientDisplayName: 'Acme Studio',
        contactName: 'Alice Smith',
        onOpenChange,
        onSuccess,
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper />);

    mockExecuteErasureAction.mockResolvedValueOnce({
      success: true,
      subjectKind: 'contact',
    });

    const submitBtn = findNodeByTestId(tree, 'erasure-submit-btn');
    getNodeProps(submitBtn).onClick?.();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockExecuteErasureAction).toHaveBeenCalledWith({
      subject: { kind: 'contact', clientId: 'c1', contactId: 'ct1' },
      confirmation: 'Alice Smith',
    });
    expect(onSuccess).toHaveBeenCalledWith('contact');
  });

  it('AC-11: handles REAUTH_REQUIRED response during erasure execution', async () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      'Acme Studio', // confirmation matching
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    let tree: React.ReactElement | undefined;
    function Wrapper() {
      const rendered = ErasureDialogInner({
        subject: { kind: 'client', clientId: 'c1' },
        clientDisplayName: 'Acme Studio',
        onOpenChange: vi.fn(),
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper />);

    mockExecuteErasureAction.mockResolvedValueOnce({
      success: false,
      code: 'REAUTH_REQUIRED',
    });

    const submitBtn = findNodeByTestId(tree, 'erasure-submit-btn');
    getNodeProps(submitBtn).onClick?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockExecuteErasureAction).toHaveBeenCalled();
  });

  it('AC-11: handles ERASURE_BLOCKED, CONFIRMATION_MISMATCH, NOT_FOUND, generic, and throw during erasure execution', async () => {
    const errorCodes = [
      {
        code: 'ERASURE_BLOCKED',
        holds: [{ reason: 'Tax hold', retainUntil: '2030-01-01' }],
      },
      { code: 'CONFIRMATION_MISMATCH' },
      { code: 'NOT_FOUND' },
      { code: 'UNKNOWN_ERROR' },
    ];

    for (const errResp of errorCodes) {
      mockStateQueue = [
        false,
        { client: 1 },
        [],
        false,
        'Acme Studio',
        'Acme Studio',
        false,
        null,
        false,
        '',
        false,
      ];

      let tree: React.ReactElement | undefined;
      function Wrapper() {
        const rendered = ErasureDialogInner({
          subject: { kind: 'client', clientId: 'c1' },
          clientDisplayName: 'Acme Studio',
          onOpenChange: vi.fn(),
        });
        tree = rendered;
        return <div>{rendered}</div>;
      }
      renderToStaticMarkup(<Wrapper />);

      mockExecuteErasureAction.mockResolvedValueOnce({
        success: false,
        ...errResp,
      });

      const submitBtn = findNodeByTestId(tree, 'erasure-submit-btn');
      getNodeProps(submitBtn).onClick?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Also test execution rejection / throw
    mockStateQueue = [
      false,
      { client: 1 },
      [],
      false,
      'Acme Studio',
      'Acme Studio',
      false,
      null,
      false,
      '',
      false,
    ];

    let tree: React.ReactElement | undefined;
    function WrapperThrow() {
      const rendered = ErasureDialogInner({
        subject: { kind: 'client', clientId: 'c1' },
        clientDisplayName: 'Acme Studio',
        onOpenChange: vi.fn(),
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<WrapperThrow />);

    mockExecuteErasureAction.mockRejectedValueOnce(new Error('Network failure'));
    const submitBtn = findNodeByTestId(tree, 'erasure-submit-btn');
    getNodeProps(submitBtn).onClick?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('AC-7: handles interactive reauth form submission and failure/success/throw', async () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { client: 1 }, // categoryCounts
      [], // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      'Acme Studio', // confirmation
      false, // isSubmitting
      null, // error
      true, // reauthRequired
      'secret-password', // password
      false, // isReauthenticating
    ];

    const onOpenChange = vi.fn();
    let tree: React.ReactElement | undefined;
    function Wrapper() {
      const rendered = ErasureDialogInner({
        subject: { kind: 'client', clientId: 'c1' },
        clientDisplayName: 'Acme Studio',
        onOpenChange,
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper />);

    // Cancel reauth
    const cancelBtn = findNodeByTestId(tree, 'erasure-cancel-btn');
    getNodeProps(cancelBtn).onClick?.();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Password input change
    const passInput = findNodeByTestId(tree, 'erasure-password-input');
    getNodeProps(passInput).onChange?.({ target: { value: 'new-password' } });

    // Reauth failure
    mockReauthenticateAction.mockResolvedValueOnce({
      success: false,
      error: 'Invalid credentials',
    });

    const formNode = findFormNode(tree);
    expect(formNode).toBeDefined();
    const preventDefault = vi.fn();
    await formNode?.onSubmit?.({ preventDefault });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockReauthenticateAction).toHaveBeenCalledWith({ password: 'secret-password' });

    // Reauth success -> triggers executeErasure
    mockReauthenticateAction.mockResolvedValueOnce({
      success: true,
    });
    mockExecuteErasureAction.mockResolvedValueOnce({
      success: true,
      subjectKind: 'client',
    });

    await formNode?.onSubmit?.({ preventDefault });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockExecuteErasureAction).toHaveBeenCalled();

    // Reauth rejection / throw
    mockReauthenticateAction.mockRejectedValueOnce(new Error('Server crash'));
    await formNode?.onSubmit?.({ preventDefault });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('AC-4: handles close button click when holds alert is shown', () => {
    mockStateQueue = [
      false, // isLoadingPlan
      {}, // categoryCounts
      [{ reason: 'GoBD tax hold', retainUntil: '2034-12-31' }], // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const onOpenChange = vi.fn();
    let tree: React.ReactElement | undefined;
    function Wrapper() {
      const rendered = ErasureDialogInner({
        subject: { kind: 'client', clientId: 'c1' },
        clientDisplayName: 'Acme Studio',
        onOpenChange,
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper />);

    const closeBtn = findNodeByTestId(tree, 'erasure-close-btn');
    expect(closeBtn).toBeDefined();
    getNodeProps(closeBtn).onClick?.();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('handles unknown category translation fallback and zero category counts', () => {
    mockStateQueue = [
      false, // isLoadingPlan
      { custom_stuff: 4, client: 0 }, // categoryCounts: custom category and 0 client
      [], // holds
      false, // notesMayMentionPerson
      'Acme Studio', // targetDisplayName
      '', // confirmation
      false, // isSubmitting
      'Sample error banner', // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ErasureDialogInner
        subject={{ kind: 'client', clientId: 'c1' }}
        clientDisplayName="Acme Studio"
        onOpenChange={vi.fn()}
      />,
    );

    // custom_stuff rendered as-is (fallback)
    expect(html).toContain('custom_stuff');
    expect(html).toContain('4');
    // Error banner shown
    expect(html).toContain('Sample error banner');
    expect(html).toContain('data-testid="erasure-error"');
  });
});
