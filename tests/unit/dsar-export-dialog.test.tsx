import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const mockReauthenticateAction = vi.fn();
vi.mock('@/server/auth/mfa-actions', () => ({
  reauthenticateAction: (...args: unknown[]) => mockReauthenticateAction(...args),
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
}

function getNodeProps(node: React.ReactElement | undefined): ComponentProps {
  const props = node?.props;
  if (props && typeof props === 'object') {
    return props as ComponentProps;
  }
  return {};
}

import { ExportDataDialog, ExportDataDialogInner } from '@/components/clients/export-data-dialog';

describe('TASK-0015: ExportDataDialog component (AC-9, AC-10, AC-11, AC-12)', () => {
  const mockContact = {
    id: 'c0000000-0000-4000-8000-000000000001',
    givenName: 'Jane',
    familyName: 'Doe',
  };

  const origFetch = global.fetch;

  beforeEach(() => {
    mockStateQueue = [];
    currentLocale = 'en';
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('AC-9: renders export dialog with Art. 15(4) review notice and format choices in English', () => {
    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Export personal data');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Third-party data review required (Art. 15(4) GDPR)');
    expect(html).toContain(
      'Before delivering this export to the data subject, carefully review the contents for third-party personal data',
    );
    expect(html).toContain('Machine-readable data (JSON)');
    expect(html).toContain('Printable document (HTML)');
    expect(html).toContain('data-testid="export-format-html-btn"');
    expect(html).toContain('data-testid="export-format-json-btn"');
    expect(html).toContain('Generate and download');
    expect(html).toContain('Cancel');
  });

  it('AC-10: renders export dialog in German with all strings sourced from de.json', () => {
    currentLocale = 'de';
    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="de"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Personenbezogene Daten exportieren');
    expect(html).toContain('Prüfung auf Drittpersonendaten erforderlich (Art. 15 Abs. 4 DSGVO)');
    expect(html).toContain(
      'Bevor Sie diesen Export an die betroffene Person weiterleiten, prüfen Sie bitte enthaltene Notizen',
    );
    expect(html).toContain('Maschinenlesbare Daten (JSON)');
    expect(html).toContain('Druckbares Dokument (HTML)');
    expect(html).toContain('Erstellen und herunterladen');
    expect(html).toContain('Abbrechen');
    expect(html).not.toMatch(/\[privacy\.export\./);
  });

  it('AC-11 & AC-12: ensures accessible form markup and mobile touch targets >= 24px', () => {
    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('for="export-locale-select"');
    expect(html).toContain('id="export-locale-select"');
    expect(html).toContain('min-h-[56px]');
    expect(html).toContain('min-h-[40px]');
    expect(html).toContain('max-w-md');
    expect(html).toContain('w-full');
  });

  it('AC-9: renders nothing when open is false', () => {
    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={false}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toBe('');
  });

  it('AC-9: renders error banner when error state is present', () => {
    mockStateQueue = [
      'html', // format
      'en', // locale
      false, // isSubmitting
      'Export generation failed. Please try again.', // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="export-error-alert"');
    expect(html).toContain('Export generation failed. Please try again.');
  });

  it('AC-9: renders JSON active button when format is json', () => {
    mockStateQueue = [
      'json', // format
      'de', // locale
      false, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="de"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="export-format-json-btn"');
    expect(html).toContain('border-primary bg-primary/5 text-primary');
  });

  it('AC-9: renders submitting state with spinner', () => {
    mockStateQueue = [
      'html', // format
      'en', // locale
      true, // isSubmitting
      null, // error
      false, // reauthRequired
      '', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Generating...');
    expect(html).toContain('animate-spin');
  });

  it('AC-4 & AC-9: renders step-up reauthentication form when reauthRequired is true', () => {
    mockStateQueue = [
      'html', // format
      'en', // locale
      false, // isSubmitting
      null, // error
      true, // reauthRequired
      'secret-pass', // password
      false, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Re-authentication required');
    expect(html).toContain('data-testid="export-password-input"');
    expect(html).toContain('value="secret-pass"');
    expect(html).toContain('data-testid="export-reauth-cancel-btn"');
    expect(html).toContain('data-testid="export-reauth-submit-btn"');
    expect(html).toContain('Confirm and proceed');
  });

  it('AC-4 & AC-9: renders reauthenticating loading state', () => {
    mockStateQueue = [
      'html', // format
      'en', // locale
      false, // isSubmitting
      null, // error
      true, // reauthRequired
      'secret-pass', // password
      true, // isReauthenticating
    ];

    const html = renderToStaticMarkup(
      <ExportDataDialog
        contact={mockContact}
        clientDisplayName="Jane Doe"
        preferredLocale="en"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(html).toContain('Verifying...');
    expect(html).toContain('animate-spin');
  });

  it('handles interactive button clicks and form changes', async () => {
    let tree: React.ReactElement | undefined;
    const mockOnOpenChange = vi.fn();
    const mockOnDownloadStarted = vi.fn();

    function Wrapper() {
      const rendered = ExportDataDialogInner({
        contact: mockContact,
        clientDisplayName: 'Jane Doe',
        preferredLocale: 'en',
        onOpenChange: mockOnOpenChange,
        onDownloadStarted: mockOnDownloadStarted,
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }

    renderToStaticMarkup(<Wrapper />);

    // Test format toggle buttons
    const jsonBtn = findNodeByTestId(tree, 'export-format-json-btn');
    expect(jsonBtn).toBeDefined();
    getNodeProps(jsonBtn).onClick?.();

    const htmlBtn = findNodeByTestId(tree, 'export-format-html-btn');
    expect(htmlBtn).toBeDefined();
    getNodeProps(htmlBtn).onClick?.();

    // Test locale selector
    const localeSelect = findNodeByTestId(tree, 'export-locale-select');
    expect(localeSelect).toBeDefined();
    getNodeProps(localeSelect).onChange?.({ target: { value: 'de' } });

    // Test cancel button
    const cancelBtn = findNodeByTestId(tree, 'export-cancel-btn');
    expect(cancelBtn).toBeDefined();
    getNodeProps(cancelBtn).onClick?.();
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);

    // Test submit button execution (200 OK download)
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy');
    const mockRevokeObjectURL = vi.fn();
    const mockClick = vi.fn();
    const mockAppendChild = vi.fn();
    const mockRemoveChild = vi.fn();

    const fakeWindow = {
      URL: {
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL,
      },
    };
    const fakeDoc = {
      createElement: vi.fn().mockReturnValue({ click: mockClick }),
      body: {
        appendChild: mockAppendChild,
        removeChild: mockRemoveChild,
      },
    };

    (globalThis as unknown as { window: unknown }).window = fakeWindow;
    (globalThis as unknown as { document: unknown }).document = fakeDoc;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-disposition': 'attachment; filename="dsar-export-test.html"',
      }),
      blob: vi.fn().mockResolvedValue(new Blob(['<html>test</html>'])),
    });

    const submitBtn = findNodeByTestId(tree, 'export-submit-btn');
    expect(submitBtn).toBeDefined();
    getNodeProps(submitBtn).onClick?.();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/privacy/exports',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockOnDownloadStarted).toHaveBeenCalled();
  });

  it('handles reauth required response from export endpoint', async () => {
    let tree: React.ReactElement | undefined;
    function Wrapper() {
      const rendered = ExportDataDialogInner({
        contact: mockContact,
        clientDisplayName: 'Jane Doe',
        preferredLocale: 'en',
        onOpenChange: vi.fn(),
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper />);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ code: 'REAUTH_REQUIRED', error: 'REAUTH_REQUIRED' }),
    });

    const submitBtn = findNodeByTestId(tree, 'export-submit-btn');
    await getNodeProps(submitBtn).onClick?.();
  });

  it('handles 403 generic error and 500 error from export endpoint', async () => {
    let tree: React.ReactElement | undefined;
    function Wrapper() {
      const rendered = ExportDataDialogInner({
        contact: mockContact,
        clientDisplayName: 'Jane Doe',
        preferredLocale: 'en',
        onOpenChange: vi.fn(),
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper />);

    // 403 other error
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ code: 'FORBIDDEN' }),
    });

    const submitBtn = findNodeByTestId(tree, 'export-submit-btn');
    await getNodeProps(submitBtn).onClick?.();

    // 500 server error
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ code: 'INTERNAL_ERROR' }),
    });
    await getNodeProps(submitBtn).onClick?.();

    // Network error
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    await getNodeProps(submitBtn).onClick?.();
  });

  it('handles interactive reauth form submission and cancellation', async () => {
    mockStateQueue = [
      'html', // format
      'en', // locale
      false, // isSubmitting
      null, // error
      true, // reauthRequired
      'valid-password', // password
      false, // isReauthenticating
    ];

    let tree: React.ReactElement | undefined;
    function Wrapper() {
      const rendered = ExportDataDialogInner({
        contact: mockContact,
        clientDisplayName: 'Jane Doe',
        preferredLocale: 'en',
        onOpenChange: vi.fn(),
      });
      tree = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper />);

    // Cancel reauth
    const reauthCancelBtn = findNodeByTestId(tree, 'export-reauth-cancel-btn');
    getNodeProps(reauthCancelBtn).onClick?.();

    // Password input change
    const passInput = findNodeByTestId(tree, 'export-password-input');
    getNodeProps(passInput).onChange?.({ target: { value: 'mypassword' } });

    // Submit reauth failure
    mockReauthenticateAction.mockResolvedValueOnce({
      success: false,
      error: 'Incorrect password',
    });

    // Find form
    function findFormNode(element: unknown): ComponentProps | undefined {
      if (!element || typeof element !== 'object') return undefined;
      if (React.isValidElement(element)) {
        const props = element.props as Record<string, unknown>;
        if (element.type === 'form' || typeof props.onSubmit === 'function') {
          return props as ComponentProps;
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

    const formNode = findFormNode(tree);
    expect(formNode).toBeDefined();
    const preventDefault = vi.fn();
    await formNode?.onSubmit?.({ preventDefault });
    expect(mockReauthenticateAction).toHaveBeenCalledWith({ password: 'valid-password' });

    // Submit reauth success
    mockReauthenticateAction.mockResolvedValueOnce({
      success: true,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: vi.fn().mockResolvedValue(new Blob(['<html>test</html>'])),
    });
    await formNode?.onSubmit?.({ preventDefault });

    // Submit reauth with exception
    mockReauthenticateAction.mockRejectedValueOnce(new Error('Auth exception'));
    await formNode?.onSubmit?.({ preventDefault });
  });
});
