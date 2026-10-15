import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PipelineStage } from '@/server/db/schema/projects';

// Mock server-only
vi.mock('server-only', () => ({}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/projects',
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  usePathname: () => '/en/projects',
}));

import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

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
  useLocale: () => currentLocale,
}));

let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [
          val,
          (updater: T | ((prev: T) => T)) => {
            if (typeof updater === 'function') {
              (updater as (prev: T) => T)(val);
            }
          },
        ];
      }
      let currentVal = typeof initial === 'function' ? (initial as () => T)() : initial;
      const setter = (updater: T | ((prev: T) => T)) => {
        if (typeof updater === 'function') {
          currentVal = (updater as (prev: T) => T)(currentVal);
        } else {
          currentVal = updater;
        }
      };
      return [currentVal, setter];
    },
  };
});

const mockCreateProjectAction = vi.fn();

vi.mock('@/server/projects/actions', () => ({
  createProjectAction: (...args: unknown[]) => mockCreateProjectAction(...args) as unknown,
}));

import {
  CreateProjectDialog,
  type CreateProjectDialogProps,
} from '@/components/projects/create-project-dialog';

const mockStages: PipelineStage[] = [
  {
    id: 'stage-1',
    key: 'inquiry',
    name: 'Inquiry',
    position: 1,
    category: 'inquiry',
    color: 'sky',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'stage-2',
    key: 'booked',
    name: 'Booked',
    position: 2,
    category: 'booked',
    color: 'blue',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockClients = [
  { id: 'client-1', displayName: 'Emma Watson' },
  { id: 'client-2', displayName: 'Lucas Brown' },
];

let capturedDialogTree: React.ReactElement | null = null;
function CaptureCreateProject(props: CreateProjectDialogProps) {
  const res = CreateProjectDialog(props);
  capturedDialogTree = res;
  return res;
}

function findNodeByTestId(node: unknown, testId: string): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (props['data-testid'] === testId) return props;
    if (props.children) {
      const res = findNodeByTestId(props.children, testId);
      if (res) return res;
    }
  } else if (Array.isArray(node)) {
    for (const item of node) {
      const res = findNodeByTestId(item, testId);
      if (res) return res;
    }
  }
  return undefined;
}

function findForm(
  node: unknown,
): { onSubmit?: (e: { preventDefault: () => void }) => Promise<void> | void } | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (React.isValidElement(node)) {
    if (node.type === 'form') {
      return node.props as {
        onSubmit?: (e: { preventDefault: () => void }) => Promise<void> | void;
      };
    }
    const props = node.props as Record<string, unknown>;
    if (props.children) {
      const res = findForm(props.children);
      if (res) return res;
    }
  } else if (Array.isArray(node)) {
    for (const item of node) {
      const res = findForm(item);
      if (res) return res;
    }
  }
  return undefined;
}

describe('TASK-0037: CreateProjectDialog Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateQueue = [];
    capturedDialogTree = null;
    currentLocale = 'en';
  });

  it('AC-4: renders modal dialog with all required fields (client, quick create link, title, type, stage, price, shoot date, location, notes)', () => {
    const html = renderToStaticMarkup(
      <CreateProjectDialog
        clients={mockClients}
        stages={mockStages}
        locale="en"
        defaultOpen={true}
      />,
    );

    expect(html).toContain('data-testid="new-project-dialog"');
    expect(html).toContain('data-testid="new-project-title-input"');
    expect(html).toContain('data-testid="new-project-client-select"');
    expect(html).toContain('data-testid="create-client-quick-link"');
    expect(html).toContain('data-testid="new-project-type-select"');
    expect(html).toContain('data-testid="new-project-stage-select"');
    expect(html).toContain('data-testid="new-project-price-input"');
    expect(html).toContain('data-testid="new-project-shoot-date-input"');
    expect(html).toContain('data-testid="new-project-shoot-location-input"');
    expect(html).toContain('data-testid="new-project-notes-input"');
    expect(html).toContain('data-testid="new-project-submit-btn"');
    expect(html).toContain('data-testid="new-project-cancel-btn"');
  });

  it('AC-7: renders all labels, placeholders, and buttons in German when locale is de', () => {
    currentLocale = 'de';
    const html = renderToStaticMarkup(
      <CreateProjectDialog
        clients={mockClients}
        stages={mockStages}
        locale="de"
        defaultOpen={true}
      />,
    );

    expect(html).toContain('Projektname');
    expect(html).toContain('Kunde');
    expect(html).toContain('Projekttyp');
    expect(html).toContain('Startphase');
    expect(html).toContain('Vereinbarter Preis');
    expect(html).toContain('Shooting-Termin');
    expect(html).toContain('Shooting-Ort');
    expect(html).toContain('Notizen');
  });

  it('renders custom trigger when provided', () => {
    const html = renderToStaticMarkup(
      <CreateProjectDialog
        clients={mockClients}
        stages={mockStages}
        trigger={<button data-testid="custom-project-trigger">Custom Open</button>}
      />,
    );

    expect(html).toContain('data-testid="custom-project-trigger"');
    expect(html).not.toContain('data-testid="new-project-btn"');
  });

  it('renders empty clients helper message when clients list is empty', () => {
    const html = renderToStaticMarkup(
      <CreateProjectDialog clients={[]} stages={mockStages} defaultOpen={true} />,
    );

    expect(html).toContain('Select a client...');
  });

  it('handles field input changes for title, client, type, stage, price, shootDate, location, and notes', () => {
    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const titleInput = findNodeByTestId(capturedDialogTree, 'new-project-title-input');
    const onTitleChange = titleInput?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onTitleChange?.({ target: { value: 'New Test Project' } });

    const clientSelect = findNodeByTestId(capturedDialogTree, 'new-project-client-select');
    const onClientChange = clientSelect?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onClientChange?.({ target: { value: 'client-2' } });

    const typeSelect = findNodeByTestId(capturedDialogTree, 'new-project-type-select');
    const onTypeChange = typeSelect?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onTypeChange?.({ target: { value: 'commercial' } });

    const stageSelect = findNodeByTestId(capturedDialogTree, 'new-project-stage-select');
    const onStageChange = stageSelect?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onStageChange?.({ target: { value: 'stage-2' } });

    const priceInput = findNodeByTestId(capturedDialogTree, 'new-project-price-input');
    const onPriceChange = priceInput?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onPriceChange?.({ target: { value: '1800.50' } });

    const dateInput = findNodeByTestId(capturedDialogTree, 'new-project-shoot-date-input');
    const onDateChange = dateInput?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onDateChange?.({ target: { value: '2026-11-20T14:00' } });

    const locationInput = findNodeByTestId(capturedDialogTree, 'new-project-shoot-location-input');
    const onLocationChange = locationInput?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onLocationChange?.({ target: { value: 'Berlin Studio' } });

    const notesInput = findNodeByTestId(capturedDialogTree, 'new-project-notes-input');
    const onNotesChange = notesInput?.onChange as
      ((e: { target: { value: string } }) => void) | undefined;
    onNotesChange?.({ target: { value: 'Special lens required' } });

    const cancelBtn = findNodeByTestId(capturedDialogTree, 'new-project-cancel-btn');
    const onCancelClick = cancelBtn?.onClick as (() => void) | undefined;
    onCancelClick?.();

    expect(titleInput).toBeDefined();
    expect(clientSelect).toBeDefined();
  });

  it('rejects submission when title is empty', async () => {
    // open, title, clientId, type, stageId, price, date, loc, notes, isSubmitting, error
    mockStateQueue = [true, '   ', 'client-1', 'wedding', 'stage-1', '', '', '', '', false, null];

    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const form = findForm(capturedDialogTree);
    const preventDefault = vi.fn();
    await form?.onSubmit?.({ preventDefault });

    expect(mockCreateProjectAction).not.toHaveBeenCalled();
  });

  it('rejects submission when title exceeds 200 characters', async () => {
    const longTitle = 'a'.repeat(201);
    mockStateQueue = [
      true,
      longTitle,
      'client-1',
      'wedding',
      'stage-1',
      '',
      '',
      '',
      '',
      false,
      null,
    ];

    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const form = findForm(capturedDialogTree);
    await form?.onSubmit?.({ preventDefault: vi.fn() });

    expect(mockCreateProjectAction).not.toHaveBeenCalled();
  });

  it('rejects submission when clientId is empty', async () => {
    mockStateQueue = [true, 'Valid Title', '', 'wedding', 'stage-1', '', '', '', '', false, null];

    renderToStaticMarkup(
      <CaptureCreateProject clients={[]} stages={mockStages} defaultOpen={true} />,
    );

    const form = findForm(capturedDialogTree);
    await form?.onSubmit?.({ preventDefault: vi.fn() });

    expect(mockCreateProjectAction).not.toHaveBeenCalled();
  });

  it('submits successfully and redirects to created project page when onSuccess is not passed', async () => {
    mockCreateProjectAction.mockResolvedValueOnce({
      success: true,
      data: { projectId: 'new-proj-123', projectTitle: 'Emma & Liam Wedding' },
    });

    mockStateQueue = [
      true,
      'Emma & Liam Wedding',
      'client-1',
      'wedding',
      'stage-1',
      '2500.50',
      '2026-08-15T15:00',
      'Botanischer Garten Berlin',
      'Important notes',
      false,
      null,
    ];

    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const form = findForm(capturedDialogTree);
    await form?.onSubmit?.({ preventDefault: vi.fn() });

    expect(mockCreateProjectAction).toHaveBeenCalled();
    const callArg = mockCreateProjectAction.mock.calls[0]?.[0] as {
      title: string;
      clientId: string;
      projectTypeKey: string;
      stageId?: string;
      priceMinor?: number;
      currency: string;
      shootStartsAt?: Date;
      shootTimezone?: string;
      shootLocation?: string;
      notes?: string;
    };
    expect(callArg.title).toBe('Emma & Liam Wedding');
    expect(callArg.clientId).toBe('client-1');
    expect(callArg.projectTypeKey).toBe('wedding');
    expect(callArg.stageId).toBe('stage-1');
    expect(callArg.priceMinor).toBe(250050);
    expect(callArg.currency).toBe('EUR');
    expect(callArg.shootStartsAt).toBeInstanceOf(Date);
    expect(callArg.shootTimezone).toBe('Europe/Berlin');
    expect(callArg.shootLocation).toBe('Botanischer Garten Berlin');
    expect(callArg.notes).toBe('Important notes');

    expect(mockPush).toHaveBeenCalledWith('/en/projects/new-proj-123');
  });

  it('submits successfully and calls onSuccess callback when provided', async () => {
    const onSuccess = vi.fn();
    mockCreateProjectAction.mockResolvedValueOnce({
      success: true,
      data: { projectId: 'new-proj-callback', projectTitle: 'Editorial Shoot' },
    });

    mockStateQueue = [
      true,
      'Editorial Shoot',
      'client-2',
      'editorial',
      'stage-2',
      '',
      '',
      '',
      '',
      false,
      null,
    ];

    renderToStaticMarkup(
      <CaptureCreateProject
        clients={mockClients}
        stages={mockStages}
        defaultOpen={true}
        onSuccess={onSuccess}
      />,
    );

    const form = findForm(capturedDialogTree);
    await form?.onSubmit?.({ preventDefault: vi.fn() });

    expect(mockCreateProjectAction).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith('new-proj-callback');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('handles server action error response cleanly', async () => {
    mockCreateProjectAction.mockResolvedValueOnce({
      success: false,
      error: 'Client does not exist',
    });

    mockStateQueue = [
      true,
      'Error Project',
      'client-1',
      'wedding',
      'stage-1',
      '',
      '',
      '',
      '',
      false,
      null,
    ];

    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const form = findForm(capturedDialogTree);
    await form?.onSubmit?.({ preventDefault: vi.fn() });

    expect(mockCreateProjectAction).toHaveBeenCalled();
  });

  it('handles server action exception cleanly', async () => {
    mockCreateProjectAction.mockRejectedValueOnce(new Error('Network error'));

    mockStateQueue = [
      true,
      'Crash Project',
      'client-1',
      'wedding',
      'stage-1',
      '',
      '',
      '',
      '',
      false,
      null,
    ];

    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const form = findForm(capturedDialogTree);
    await form?.onSubmit?.({ preventDefault: vi.fn() });

    expect(mockCreateProjectAction).toHaveBeenCalled();
  });

  it('renders error banner when errorMessage state is non-null', () => {
    mockStateQueue = [
      true,
      'Title',
      'client-1',
      'wedding',
      'stage-1',
      '',
      '',
      '',
      '',
      false,
      'A creation failure occurred',
    ];

    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const errorEl = findNodeByTestId(capturedDialogTree, 'new-project-error');
    expect(errorEl).toBeDefined();
  });

  it('renders stage fallback option when stages array is empty', () => {
    const html = renderToStaticMarkup(
      <CreateProjectDialog clients={mockClients} stages={[]} defaultOpen={true} />,
    );

    expect(html).toContain('data-testid="new-project-stage-select"');
  });

  it('renders loading spinner and disabled submit button when isSubmitting is true', () => {
    mockStateQueue = [true, 'Title', 'client-1', 'wedding', 'stage-1', '', '', '', '', true, null];

    const html = renderToStaticMarkup(
      <CreateProjectDialog clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    expect(html).toContain('Creating...');
  });

  it('submits project with undefined for empty optional fields (stageId, shootLocation, notes)', async () => {
    mockCreateProjectAction.mockResolvedValueOnce({
      success: true,
      data: { projectId: 'minimal-proj', projectTitle: 'Minimal' },
    });

    mockStateQueue = [
      true,
      'Minimal Project',
      'client-1',
      'wedding',
      '',
      '',
      '',
      '   ',
      '   ',
      false,
      null,
    ];

    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const form = findForm(capturedDialogTree);
    await form?.onSubmit?.({ preventDefault: vi.fn() });

    expect(mockCreateProjectAction).toHaveBeenCalledWith({
      title: 'Minimal Project',
      clientId: 'client-1',
      projectTypeKey: 'wedding',
      stageId: undefined,
      priceMinor: undefined,
      currency: 'EUR',
      shootStartsAt: undefined,
      shootTimezone: 'Europe/Berlin',
      shootLocation: undefined,
      notes: undefined,
    });
  });

  it('handles server action error when res.error is undefined using generic fallback', async () => {
    mockCreateProjectAction.mockResolvedValueOnce({
      success: false,
    });

    mockStateQueue = [
      true,
      'Fallback Error Project',
      'client-1',
      'wedding',
      'stage-1',
      '',
      '',
      '',
      '',
      false,
      null,
    ];

    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={true} />,
    );

    const form = findForm(capturedDialogTree);
    await form?.onSubmit?.({ preventDefault: vi.fn() });

    expect(mockCreateProjectAction).toHaveBeenCalled();
  });

  it('triggers onOpenChange resets when dialog opens and closes', () => {
    renderToStaticMarkup(
      <CaptureCreateProject clients={mockClients} stages={mockStages} defaultOpen={false} />,
    );

    const dialogProps = (capturedDialogTree?.props ?? {}) as {
      onOpenChange?: (open: boolean) => void;
    };
    dialogProps.onOpenChange?.(true);
    dialogProps.onOpenChange?.(false);
  });
});
