import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
import {
  LegalHoldSection,
  isHoldActiveDate,
  type ClientLegalHoldData,
} from '@/components/clients/legal-hold-section';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

function getNestedValue(obj: unknown, path: string): unknown {
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

function findForm(element: React.ReactElement | undefined): Record<string, unknown> | undefined {
  if (!element) return undefined;
  let found: Record<string, unknown> | undefined;
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

function findNodeByProps(
  element: React.ReactElement | undefined,
  propName: string,
): React.ReactElement | undefined {
  if (!element) return undefined;
  let found: React.ReactElement | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (typeof props[propName] === 'function') {
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

let currentLocale: 'en' | 'de' = 'en';

vi.mock('next-intl', () => ({
  useLocale: () => currentLocale,
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

vi.mock('server-only', () => ({}));

vi.mock('@/server/clients/legal-hold-actions', () => ({
  setLegalHoldAction: vi.fn(),
  releaseLegalHoldAction: vi.fn(),
}));

describe('TASK-0019: LegalHoldSection Component (AC-17, AC-18)', () => {
  beforeEach(() => {
    currentLocale = 'en';
  });

  describe('isHoldActiveDate helper', () => {
    it('returns true when until is null or undefined (indefinite hold)', () => {
      expect(isHoldActiveDate(null)).toBe(true);
      expect(isHoldActiveDate(undefined)).toBe(true);
    });

    it('returns true when until is in the future in studio timezone', () => {
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      expect(isHoldActiveDate(future, 'Europe/Berlin')).toBe(true);
    });

    it('returns false when until is in the past in studio timezone', () => {
      expect(isHoldActiveDate('2020-01-01', 'Europe/Berlin')).toBe(false);
    });
  });

  it('AC-17: renders switch with role="switch" and aria-checked="false" when no hold is active', () => {
    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        studioTimezone="Europe/Berlin"
        locale="en"
      />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('Legal hold');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="legal-hold-status-announcement"');
  });

  it('AC-17: renders active hold with reason, dates, Edit and Release buttons, and switch aria-checked="true"', () => {
    const activeHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000010',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: 'Pending contract dispute',
      until: '2028-12-31',
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={activeHold}
        studioTimezone="Europe/Berlin"
        locale="en"
      />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Dispute resolution');
    expect(html).toContain('Pending contract dispute');
    expect(html).toContain('Edit hold');
    expect(html).toContain('Release hold');
    expect(html).toContain('data-testid="edit-legal-hold-btn"');
    expect(html).toContain('data-testid="release-legal-hold-btn"');
  });

  it('AC-17: renders expired hold status when until date is in the past', () => {
    const expiredHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000011',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'statutory',
      note: null,
      until: '2024-01-01',
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2023-01-01T10:00:00Z',
      updatedAt: '2023-01-01T10:00:00Z',
    };

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={expiredHold}
        studioTimezone="Europe/Berlin"
        locale="en"
      />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('Expired');
    expect(html).toContain('Statutory requirement');
    expect(html).toContain('Release hold');
  });

  it('AC-18: renders strings and German labels when locale is de', () => {
    currentLocale = 'de';
    const activeHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000012',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: 'Rechtsstreit',
      until: '2028-12-31',
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={activeHold}
        studioTimezone="Europe/Berlin"
        locale="de"
      />,
    );

    expect(html).toContain('Löschsperre');
    expect(html).toContain('Rechtsstreit');
    expect(html).toContain('Löschsperre bearbeiten');
    expect(html).toContain('Löschsperre aufheben');
  });

  it('renders edit dialog open with form error, filled fields, and polite announcement', () => {
    mockStateQueue = [
      null, // hold
      true, // isDialogOpen
      false, // isReleaseConfirmOpen
      false, // isSubmitting
      false, // isReleasing
      'Until date must be today or in the future.', // formError
      null, // releaseError
      'Legal hold was activated.', // statusAnnouncement
      'statutory', // reason
      'Auditing ongoing', // note
      '2028-12-31', // until
    ];

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={null}
        studioTimezone="UTC"
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="legal-hold-dialog"');
    expect(html).toContain('data-testid="legal-hold-form-error"');
    expect(html).toContain('Until date must be today or in the future.');
    expect(html).toContain('Auditing ongoing');
    expect(html).toContain('2028-12-31');
    expect(html).toContain('Legal hold was activated.');
  });

  it('renders edit dialog in submitting state with disabled button', () => {
    mockStateQueue = [
      null, // hold
      true, // isDialogOpen
      false, // isReleaseConfirmOpen
      true, // isSubmitting
      false, // isReleasing
      null, // formError
      null, // releaseError
      null, // statusAnnouncement
      'dispute', // reason
      '', // note
      '', // until
    ];

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={null}
        studioTimezone="UTC"
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="save-legal-hold-btn"');
    expect(html).toContain('disabled=""');
  });

  it('renders release confirmation dialog with release error', () => {
    const activeHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000012',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: null,
      until: null,
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    mockStateQueue = [
      activeHold, // hold
      false, // isDialogOpen
      true, // isReleaseConfirmOpen
      false, // isSubmitting
      false, // isReleasing
      null, // formError
      'Failed to release legal hold.', // releaseError
      null, // statusAnnouncement
      'dispute', // reason
      '', // note
      '', // until
    ];

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={activeHold}
        studioTimezone="UTC"
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="confirm-dialog"');
    expect(html).toContain('Failed to release legal hold.');
    expect(html).toContain('data-testid="confirm-dialog-confirm-btn"');
  });

  it('renders release confirmation dialog in releasing state with disabled button', () => {
    const activeHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000012',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: null,
      until: null,
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    mockStateQueue = [
      activeHold, // hold
      false, // isDialogOpen
      true, // isReleaseConfirmOpen
      false, // isSubmitting
      true, // isReleasing
      null, // formError
      null, // releaseError
      null, // statusAnnouncement
      'dispute', // reason
      '', // note
      '', // until
    ];

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={activeHold}
        studioTimezone="UTC"
        locale="en"
      />,
    );

    expect(html).toContain('data-testid="confirm-dialog-confirm-btn"');
    expect(html).toContain('disabled=""');
  });

  it('isHoldActiveDate handles invalid timezone by falling back to ISO string', () => {
    expect(isHoldActiveDate('2028-12-31', 'Invalid/Timezone_Name')).toBe(true);
    expect(isHoldActiveDate('2020-01-01', 'Invalid/Timezone_Name')).toBe(false);
  });

  it('renders correctly with invalid studio timezone falling back to UTC', () => {
    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        studioTimezone="Invalid/Zone_Name"
        locale="en"
      />,
    );
    expect(html).toContain('Legal hold');
  });

  it('renders indefinite hold with "other" reason and null note', () => {
    const otherHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000015',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'other',
      note: null,
      until: null,
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    const html = renderToStaticMarkup(
      <LegalHoldSection
        clientId="018f0000-0000-7000-8000-000000000001"
        initialHold={otherHold}
        studioTimezone="UTC"
        locale="en"
      />,
    );
    expect(html).toContain('Other legal grounds');
    expect(html).toContain('Indefinite / until manual release');
  });

  it('executes handleToggleSwitch when switch is clicked (inactive vs active)', async () => {
    const mockSetIsDialogOpen = vi.fn();
    const mockSetIsReleaseConfirmOpen = vi.fn();

    // 1. Inactive hold: toggle switch opens set dialog
    mockStateQueue = [
      null, // hold
      false, // isDialogOpen
      false, // isReleaseConfirmOpen
      false, // isSubmitting
      false, // isReleasing
      null, // formError
      null, // releaseError
      null, // statusAnnouncement
      'dispute', // reason
      '', // note
      '', // until
    ];

    let treeInactive: React.ReactElement | undefined;
    function WrapperInactive() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        studioTimezone: 'UTC',
        locale: 'en',
      });
      treeInactive = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<WrapperInactive />);

    const switchBtn = findNodeByTestId(treeInactive, 'legal-hold-switch');
    expect(switchBtn).toBeDefined();
    const switchProps = switchBtn?.props as { onClick?: () => void };
    expect(typeof switchProps.onClick).toBe('function');
    switchProps.onClick?.();

    // 2. Active hold: toggle switch opens release confirmation
    const activeHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000016',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: 'Active note',
      until: '2028-12-31',
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    mockStateQueue = [
      activeHold,
      false,
      false,
      false,
      false,
      null,
      null,
      null,
      'dispute',
      'Active note',
      '2028-12-31',
    ];

    let treeActive: React.ReactElement | undefined;
    function WrapperActive() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        initialHold: activeHold,
        studioTimezone: 'UTC',
        locale: 'en',
      });
      treeActive = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<WrapperActive />);

    const activeSwitchBtn = findNodeByTestId(treeActive, 'legal-hold-switch');
    const activeSwitchProps = activeSwitchBtn?.props as { onClick?: () => void };
    activeSwitchProps.onClick?.();

    // Edit button on active hold
    const editBtn = findNodeByTestId(treeActive, 'edit-legal-hold-btn');
    const editBtnProps = editBtn?.props as { onClick?: () => void };
    editBtnProps.onClick?.();

    // Release button on active hold
    const releaseBtn = findNodeByTestId(treeActive, 'release-legal-hold-btn');
    const releaseBtnProps = releaseBtn?.props as { onClick?: () => void };
    releaseBtnProps.onClick?.();
  });

  it('executes handleSaveHold form submissions with validation error, action error, throw error, and success', async () => {
    const { setLegalHoldAction } = await import('@/server/clients/legal-hold-actions');

    // 1. Validation error: until in the past
    mockStateQueue = [
      null, // hold
      true, // isDialogOpen
      false, // isReleaseConfirmOpen
      false, // isSubmitting
      false, // isReleasing
      null, // formError
      null, // releaseError
      null, // statusAnnouncement
      'dispute', // reason
      '', // note
      '2020-01-01', // until
    ];

    let tree1: React.ReactElement | undefined;
    function Wrapper1() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        studioTimezone: 'UTC',
        locale: 'en',
      });
      tree1 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper1 />);

    const form1 = findForm(tree1);
    expect(form1).toBeDefined();
    await (form1?.onSubmit as (e: unknown) => Promise<void>)?.({ preventDefault: vi.fn() });
    expect(setLegalHoldAction).not.toHaveBeenCalled();

    // 2. Action error
    vi.mocked(setLegalHoldAction).mockResolvedValueOnce({
      success: false,
      code: 'VALIDATION_FAILED',
      error: 'Backend validation error',
    });

    mockStateQueue = [
      null,
      true,
      false,
      false,
      false,
      null,
      null,
      null,
      'dispute',
      'Valid note',
      '2028-12-31',
    ];

    let tree2: React.ReactElement | undefined;
    function Wrapper2() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        studioTimezone: 'UTC',
        locale: 'en',
      });
      tree2 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper2 />);

    const form2 = findForm(tree2);
    await (form2?.onSubmit as (e: unknown) => Promise<void>)?.({ preventDefault: vi.fn() });
    expect(setLegalHoldAction).toHaveBeenCalled();

    // 3. Action rejects with Error (catch block)
    vi.mocked(setLegalHoldAction).mockRejectedValueOnce(new Error('Network failure'));

    mockStateQueue = [null, true, false, false, false, null, null, null, 'dispute', '', ''];

    let tree3: React.ReactElement | undefined;
    function Wrapper3() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        studioTimezone: 'UTC',
        locale: 'en',
      });
      tree3 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper3 />);

    const form3 = findForm(tree3);
    await (form3?.onSubmit as (e: unknown) => Promise<void>)?.({ preventDefault: vi.fn() });

    // 4. Action error without error message (falls back to errorGeneric)
    vi.mocked(setLegalHoldAction).mockResolvedValueOnce({
      success: false,
      code: 'INTERNAL_ERROR',
      error: '',
    });

    mockStateQueue = [null, true, false, false, false, null, null, null, 'dispute', '', ''];

    let tree4: React.ReactElement | undefined;
    function Wrapper4() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        studioTimezone: 'UTC',
        locale: 'en',
      });
      tree4 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper4 />);

    const form4 = findForm(tree4);
    await (form4?.onSubmit as (e: unknown) => Promise<void>)?.({ preventDefault: vi.fn() });

    // 5. Success for new hold
    const mockHoldResult = {
      id: '018f0000-0000-7000-8000-000000000017',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute' as const,
      note: 'Saved note',
      until: '2028-12-31',
      setByActorType: 'owner' as const,
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(setLegalHoldAction).mockResolvedValueOnce({
      success: true,
      hold: mockHoldResult,
    });

    const onHoldChangeMock = vi.fn();
    mockStateQueue = [
      null, // hold is null -> new hold
      true,
      false,
      false,
      false,
      null,
      null,
      null,
      'dispute',
      'Saved note',
      '2028-12-31',
    ];

    let tree5: React.ReactElement | undefined;
    function Wrapper5() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        studioTimezone: 'UTC',
        locale: 'en',
        onHoldChange: onHoldChangeMock,
      });
      tree5 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper5 />);

    const form5 = findForm(tree5);
    await (form5?.onSubmit as (e: unknown) => Promise<void>)?.({ preventDefault: vi.fn() });
    expect(onHoldChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: mockHoldResult.id }),
      true,
    );

    // 6. Success for existing hold (updates)
    const existingHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000017',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: 'Existing note',
      until: '2028-12-31',
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };
    vi.mocked(setLegalHoldAction).mockResolvedValueOnce({
      success: true,
      hold: mockHoldResult,
    });

    mockStateQueue = [
      existingHold, // hold is not null -> update
      true,
      false,
      false,
      false,
      null,
      null,
      null,
      'dispute',
      'Updated note',
      '2028-12-31',
    ];

    let tree6: React.ReactElement | undefined;
    function Wrapper6() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        initialHold: existingHold,
        studioTimezone: 'UTC',
        locale: 'en',
      });
      tree6 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper6 />);

    const form6 = findForm(tree6);
    await (form6?.onSubmit as (e: unknown) => Promise<void>)?.({ preventDefault: vi.fn() });
  });

  it('executes handleConfirmRelease with error, fallback error, exception, and success', async () => {
    const { releaseLegalHoldAction } = await import('@/server/clients/legal-hold-actions');

    const activeHold: ClientLegalHoldData = {
      id: '018f0000-0000-7000-8000-000000000018',
      clientId: '018f0000-0000-7000-8000-000000000001',
      reason: 'dispute',
      note: null,
      until: null,
      setByActorType: 'owner',
      setByActorId: '018f0000-0000-7000-8000-000000000099',
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    };

    // 1. Release action error
    vi.mocked(releaseLegalHoldAction).mockResolvedValueOnce({
      success: false,
      code: 'FORBIDDEN',
      error: 'Cannot release',
    });

    mockStateQueue = [activeHold, false, true, false, false, null, null, null, 'dispute', '', ''];

    let tree1: React.ReactElement | undefined;
    function Wrapper1() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        initialHold: activeHold,
        studioTimezone: 'UTC',
        locale: 'en',
      });
      tree1 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper1 />);

    const confirmDialog1 = findNodeByProps(tree1, 'onConfirm');
    expect(confirmDialog1).toBeDefined();
    await (confirmDialog1?.props as { onConfirm?: () => Promise<void> }).onConfirm?.();

    // 2. Release action error without message
    vi.mocked(releaseLegalHoldAction).mockResolvedValueOnce({
      success: false,
      code: 'INTERNAL_ERROR',
      error: '',
    });

    mockStateQueue = [activeHold, false, true, false, false, null, null, null, 'dispute', '', ''];

    let tree2: React.ReactElement | undefined;
    function Wrapper2() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        initialHold: activeHold,
        studioTimezone: 'UTC',
        locale: 'en',
      });
      tree2 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper2 />);

    const confirmDialog2 = findNodeByProps(tree2, 'onConfirm');
    await (confirmDialog2?.props as { onConfirm?: () => Promise<void> }).onConfirm?.();

    // 3. Release action throws exception
    vi.mocked(releaseLegalHoldAction).mockRejectedValueOnce(new Error('Server crash'));

    mockStateQueue = [activeHold, false, true, false, false, null, null, null, 'dispute', '', ''];

    let tree3: React.ReactElement | undefined;
    function Wrapper3() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        initialHold: activeHold,
        studioTimezone: 'UTC',
        locale: 'en',
      });
      tree3 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper3 />);

    const confirmDialog3 = findNodeByProps(tree3, 'onConfirm');
    await (confirmDialog3?.props as { onConfirm?: () => Promise<void> }).onConfirm?.();

    // 4. Release action succeeds
    vi.mocked(releaseLegalHoldAction).mockResolvedValueOnce({
      success: true,
    });

    const onHoldChangeMock = vi.fn();
    mockStateQueue = [activeHold, false, true, false, false, null, null, null, 'dispute', '', ''];

    let tree4: React.ReactElement | undefined;
    function Wrapper4() {
      const rendered = LegalHoldSection({
        clientId: '018f0000-0000-7000-8000-000000000001',
        initialHold: activeHold,
        studioTimezone: 'UTC',
        locale: 'en',
        onHoldChange: onHoldChangeMock,
      });
      tree4 = rendered;
      return <div>{rendered}</div>;
    }
    renderToStaticMarkup(<Wrapper4 />);

    const confirmDialog4 = findNodeByProps(tree4, 'onConfirm');
    await (confirmDialog4?.props as { onConfirm?: () => Promise<void> }).onConfirm?.();
    expect(onHoldChangeMock).toHaveBeenCalledWith(null, false);
  });
});
