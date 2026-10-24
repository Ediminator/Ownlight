import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    `translated-${key}${values ? JSON.stringify(values) : ''}`,
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
}));

const mockRedirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string): void => {
    mockRedirect(url);
  },
}));

const mockRequireOwner = vi.fn<() => Promise<unknown>>();
vi.mock('@/server/auth/guards', () => ({
  requireOwner: (): Promise<unknown> => mockRequireOwner(),
}));

const mockGetCaldavAccountStatus = vi.fn<() => Promise<unknown>>();
vi.mock('@/server/integrations/caldav/repo', () => ({
  getCaldavAccountStatus: (): Promise<unknown> => mockGetCaldavAccountStatus(),
}));

const { mockTestAction, mockSaveAction, mockDisconnectAction, mockSyncAction } = vi.hoisted(() => ({
  mockTestAction: vi.fn(),
  mockSaveAction: vi.fn(),
  mockDisconnectAction: vi.fn(),
  mockSyncAction: vi.fn(),
}));

vi.mock('@/server/integrations/caldav/actions', () => ({
  testCaldavConnectionAction: mockTestAction,
  saveCaldavAccountAction: mockSaveAction,
  disconnectCaldavAccountAction: mockDisconnectAction,
  triggerManualCaldavSyncAction: mockSyncAction,
}));

import {
  CaldavIntegrationView,
  createCaldavViewController,
} from '@/components/settings/caldav-integration-view';
import CaldavIntegrationPage from '@/app/[locale]/settings/integrations/caldav/page';
import type { CaldavAccountStatus } from '@/server/integrations/caldav/repo';

describe('CaldavIntegrationView Component & Page (AC-1, AC-2, AC-5, AC-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-1: renders disconnected setup form with input fields, labels, password toggle, and action button', () => {
    const disconnectedStatus: CaldavAccountStatus = {
      connected: false,
      serverUrl: null,
      username: null,
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };

    const html = renderToStaticMarkup(
      <CaldavIntegrationView initialStatus={disconnectedStatus} locale="en" />,
    );

    // Header and navigation
    expect(html).toContain('translated-title');
    expect(html).toContain('translated-wizardTitle');
    expect(html).toContain('translated-wizardDescription');
    expect(html).toContain('translated-backToSettings');
    expect(html).toContain('translated-badgeDisconnected');

    // Input fields and test connection button
    expect(html).toContain('translated-serverUrlLabel');
    expect(html).toContain('translated-usernameLabel');
    expect(html).toContain('translated-passwordLabel');
    expect(html).toContain('translated-testAndDiscoverButton');
    expect(html).toContain('data-testid="caldav-server-url-input"');
    expect(html).toContain('data-testid="caldav-username-input"');
    expect(html).toContain('data-testid="caldav-password-input"');
    expect(html).toContain('data-testid="caldav-password-toggle"');
    expect(html).toContain('data-testid="caldav-test-connect-button"');
  });

  it('AC-1: renders password toggle in visible state when initialShowPassword is true', () => {
    const disconnectedStatus: CaldavAccountStatus = {
      connected: false,
      serverUrl: null,
      username: null,
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };

    const html = renderToStaticMarkup(
      <CaldavIntegrationView
        initialStatus={disconnectedStatus}
        locale="en"
        initialShowPassword={true}
      />,
    );

    expect(html).toContain('aria-label="translated-hidePassword"');
    expect(html).toContain('type="text"');
  });

  it('AC-1: renders validation errors on input fields when initialErrors are present', () => {
    const disconnectedStatus: CaldavAccountStatus = {
      connected: false,
      serverUrl: null,
      username: null,
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };

    const html = renderToStaticMarkup(
      <CaldavIntegrationView
        initialStatus={disconnectedStatus}
        locale="en"
        initialErrors={{
          serverUrl: 'Invalid Server URL',
          username: 'Username is required',
          password: 'Password is required',
        }}
      />,
    );

    expect(html).toContain('Invalid Server URL');
    expect(html).toContain('Username is required');
    expect(html).toContain('Password is required');
    expect(html).toContain('aria-invalid="true"');
  });

  it('AC-1: renders calendar selection wizard step with discovered calendars and error state', () => {
    const disconnectedStatus: CaldavAccountStatus = {
      connected: false,
      serverUrl: 'https://caldav.example.org',
      username: 'studio@example.org',
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };

    const discovered = [
      { url: '/cal/1/', displayName: 'Work Shoots', color: '#ff5500' },
      { url: '/cal/2/', displayName: 'Personal Calendar' },
    ];

    const html = renderToStaticMarkup(
      <CaldavIntegrationView
        initialStatus={disconnectedStatus}
        locale="en"
        initialStep="select_calendar"
        initialDiscoveredCalendars={discovered}
        initialSelectedCalendarUrl="/cal/1/"
        initialErrors={{ calendar: 'Please select a calendar to continue' }}
      />,
    );

    expect(html).toContain('translated-selectCalendarTitle');
    expect(html).toContain('Work Shoots');
    expect(html).toContain('Personal Calendar');
    expect(html).toContain('Please select a calendar to continue');
    expect(html).toContain('translated-saveAndConnectButton');
    expect(html).toContain('translated-backToCredentialsButton');
    expect(html).toContain('data-testid="caldav-save-connect-button"');
    expect(html).toContain('data-testid="caldav-back-button"');
  });

  it('AC-2: renders notifications banner for success and error types', () => {
    const disconnectedStatus: CaldavAccountStatus = {
      connected: false,
      serverUrl: null,
      username: null,
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };

    const successHtml = renderToStaticMarkup(
      <CaldavIntegrationView
        initialStatus={disconnectedStatus}
        locale="en"
        initialNotification={{ type: 'success', message: 'CalDAV Connected Successfully' }}
      />,
    );
    expect(successHtml).toContain('CalDAV Connected Successfully');
    expect(successHtml).toContain('data-testid="caldav-success-alert"');

    const errorHtml = renderToStaticMarkup(
      <CaldavIntegrationView
        initialStatus={disconnectedStatus}
        locale="en"
        initialNotification={{ type: 'error', message: 'Connection timed out' }}
      />,
    );
    expect(errorHtml).toContain('Connection timed out');
    expect(errorHtml).toContain('data-testid="caldav-error-alert"');
  });

  it('AC-2: renders connected integration card with active status, server details, and sync buttons', () => {
    const connectedStatus: CaldavAccountStatus = {
      connected: true,
      serverUrl: 'https://caldav.example.org',
      username: 'studio@example.org',
      selectedCalendarUrl: '/calendars/user/shoots/',
      selectedCalendarName: 'Client Shoots',
      lastSyncedAt: new Date('2026-10-24T01:30:00.000Z'),
      lastSyncError: 'CalDAV service temporarily unavailable (503)',
    };

    const html = renderToStaticMarkup(
      <CaldavIntegrationView initialStatus={connectedStatus} locale="en" />,
    );

    // Active status card
    expect(html).toContain('translated-activeCardTitle');
    expect(html).toContain('translated-activeCardDescription');
    expect(html).toContain('translated-badgeConnected');
    expect(html).toContain('https://caldav.example.org');
    expect(html).toContain('studio@example.org');
    expect(html).toContain('Client Shoots');

    // Sync error notice
    expect(html).toContain('CalDAV service temporarily unavailable (503)');
    expect(html).toContain('data-testid="caldav-sync-error-notice"');

    // Action buttons
    expect(html).toContain('translated-syncNowButton');
    expect(html).toContain('translated-disconnectButton');
    expect(html).toContain('data-testid="caldav-sync-now-button"');
    expect(html).toContain('data-testid="caldav-disconnect-button"');
  });

  it('AC-2: falls back to selectedCalendarUrl when selectedCalendarName is null in connected view', () => {
    const connectedStatus: CaldavAccountStatus = {
      connected: true,
      serverUrl: 'https://caldav.example.org',
      username: 'studio@example.org',
      selectedCalendarUrl: '/calendars/user/fallback-cal/',
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };

    const html = renderToStaticMarkup(
      <CaldavIntegrationView initialStatus={connectedStatus} locale="en" />,
    );

    expect(html).toContain('/calendars/user/fallback-cal/');
    expect(html).toContain('translated-neverSynced');
  });

  it('AC-8: CaldavIntegrationPage renders view when authenticated as owner', async () => {
    mockRequireOwner.mockResolvedValueOnce({ user: { id: 'owner-1', role: 'owner' } });
    mockGetCaldavAccountStatus.mockResolvedValueOnce({
      connected: false,
      serverUrl: null,
      username: null,
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    });

    const pageElement = await CaldavIntegrationPage({
      params: Promise.resolve({ locale: 'en' }),
    });

    const html = renderToStaticMarkup(pageElement);
    expect(html).toContain('translated-wizardTitle');
  });

  it('AC-8: CaldavIntegrationPage redirects unauthenticated caller to sign-in', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('Unauthenticated'));

    await CaldavIntegrationPage({
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(mockRedirect).toHaveBeenCalledWith(
      '/en/sign-in?callbackUrl=/en/settings/integrations/caldav',
    );
  });
});

describe('createCaldavViewController Interactive Handlers & Branches (I1-COV01)', () => {
  function createTestControllerSetup(
    overrides?: Partial<Parameters<typeof createCaldavViewController>[0]>,
  ) {
    const setServerUrl = vi.fn();
    const setUsername = vi.fn();
    const setPassword = vi.fn();
    const setShowPassword = vi.fn((updater: unknown) =>
      typeof updater === 'function' ? (updater as (prev: boolean) => boolean)(false) : updater,
    );
    const initialTestErrors = {
      serverUrl: 'Err url',
      username: 'Err user',
      password: 'Err pass',
      calendar: 'Err cal',
    };
    const setErrors = vi.fn((updater: unknown) =>
      typeof updater === 'function'
        ? (updater as (prev: typeof initialTestErrors) => typeof initialTestErrors)(
            initialTestErrors,
          )
        : updater,
    );
    const setDiscoveredCalendars = vi.fn();
    const setSelectedCalendarUrl = vi.fn();
    const initialTestStatus: CaldavAccountStatus = {
      connected: false,
      serverUrl: null,
      username: null,
      selectedCalendarUrl: null,
      selectedCalendarName: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };
    const setStatus = vi.fn((updater: unknown) =>
      typeof updater === 'function'
        ? (updater as (prev: CaldavAccountStatus) => CaldavAccountStatus)(initialTestStatus)
        : updater,
    );
    const setStep = vi.fn();
    const setIsTesting = vi.fn();
    const setIsSaving = vi.fn();
    const setIsSyncing = vi.fn();
    const setIsDisconnecting = vi.fn();
    const setIsDisconnectDialogOpen = vi.fn();
    const setNotification = vi.fn();
    const t = (key: string, values?: Record<string, unknown>) =>
      `t:${key}${values ? JSON.stringify(values) : ''}`;

    const defaultOptions: Parameters<typeof createCaldavViewController>[0] = {
      serverUrl: 'https://cal.example.org',
      setServerUrl,
      username: 'user@example.org',
      setUsername,
      password: 'test_password',
      setPassword,
      showPassword: false,
      setShowPassword,
      errors: initialTestErrors,
      setErrors,
      discoveredCalendars: [
        { url: '/cal/work/', displayName: 'Work' },
        { url: '/cal/personal/', displayName: 'Personal' },
      ],
      setDiscoveredCalendars,
      selectedCalendarUrl: '/cal/work/',
      setSelectedCalendarUrl,
      status: initialTestStatus,
      setStatus,
      setStep,
      setIsTesting,
      setIsSaving,
      setIsSyncing,
      setIsDisconnecting,
      setIsDisconnectDialogOpen,
      setNotification,
      t,
      testAction: mockTestAction,
      saveAction: mockSaveAction,
      syncAction: mockSyncAction,
      disconnectAction: mockDisconnectAction,
      ...overrides,
    };

    const controller = createCaldavViewController(defaultOptions);

    return {
      controller,
      setServerUrl,
      setUsername,
      setPassword,
      setShowPassword,
      setErrors,
      setDiscoveredCalendars,
      setSelectedCalendarUrl,
      setStatus,
      setStep,
      setIsTesting,
      setIsSaving,
      setIsSyncing,
      setIsDisconnecting,
      setIsDisconnectDialogOpen,
      setNotification,
    };
  }

  it('I1-COV01: field typing handlers update values and clear field errors', () => {
    const {
      controller,
      setServerUrl,
      setUsername,
      setPassword,
      setSelectedCalendarUrl,
      setErrors,
    } = createTestControllerSetup();

    controller.handleServerUrlChange({
      target: { value: 'https://new.example.org' },
    } as React.ChangeEvent<HTMLInputElement>);
    expect(setServerUrl).toHaveBeenCalledWith('https://new.example.org');
    expect(setErrors).toHaveBeenCalled();

    controller.handleUsernameChange({
      target: { value: 'new_user' },
    } as React.ChangeEvent<HTMLInputElement>);
    expect(setUsername).toHaveBeenCalledWith('new_user');

    controller.handlePasswordChange({
      target: { value: 'new_pw' },
    } as React.ChangeEvent<HTMLInputElement>);
    expect(setPassword).toHaveBeenCalledWith('new_pw');

    controller.handleCalendarSelectChange({
      target: { value: '/cal/personal/' },
    } as React.ChangeEvent<HTMLSelectElement>);
    expect(setSelectedCalendarUrl).toHaveBeenCalledWith('/cal/personal/');
  });

  it('I1-COV01: field typing does not clear errors when field has no error', () => {
    const { controller, setErrors } = createTestControllerSetup({
      errors: {},
    });

    controller.handleServerUrlChange({
      target: { value: 'https://cal.example.org' },
    } as React.ChangeEvent<HTMLInputElement>);
    controller.handleUsernameChange({
      target: { value: 'user' },
    } as React.ChangeEvent<HTMLInputElement>);
    controller.handlePasswordChange({
      target: { value: 'pw' },
    } as React.ChangeEvent<HTMLInputElement>);
    controller.handleCalendarSelectChange({
      target: { value: '/cal/1/' },
    } as React.ChangeEvent<HTMLSelectElement>);

    expect(setErrors).not.toHaveBeenCalled();
  });

  it('I1-COV01: password reveal toggle calls setShowPassword updater', () => {
    const { controller, setShowPassword } = createTestControllerSetup();

    controller.onTogglePasswordVisibility();
    expect(setShowPassword).toHaveBeenCalledWith(expect.any(Function));
  });

  it('I1-COV01: dialog visibility and navigation step transitions', () => {
    const { controller, setIsDisconnectDialogOpen, setStep } = createTestControllerSetup();

    controller.onOpenDisconnectDialog();
    expect(setIsDisconnectDialogOpen).toHaveBeenCalledWith(true);

    controller.onCloseDisconnectDialog();
    expect(setIsDisconnectDialogOpen).toHaveBeenCalledWith(false);

    controller.onBackToCredentials();
    expect(setStep).toHaveBeenCalledWith('credentials');
  });

  describe('I1-COV01: onTestAndDiscover branches', () => {
    it('handles validation failure when inputs are empty without calling action', async () => {
      const { controller, setErrors, setNotification, setIsTesting } = createTestControllerSetup({
        serverUrl: '',
        username: '',
        password: '',
      });

      const mockPreventDefault = vi.fn();
      await controller.onTestAndDiscover({
        preventDefault: mockPreventDefault,
      } as unknown as React.SyntheticEvent);

      expect(mockPreventDefault).toHaveBeenCalled();
      expect(setNotification).toHaveBeenCalledWith(null);
      expect(setErrors).toHaveBeenCalledWith({
        serverUrl: 't:errorServerUrlRequired',
        username: 't:errorUsernameRequired',
        password: 't:errorPasswordRequired',
      });
      expect(setIsTesting).not.toHaveBeenCalled();
      expect(mockTestAction).not.toHaveBeenCalled();
    });

    it('successfully discovers calendars and transitions to select_calendar step', async () => {
      const {
        controller,
        setDiscoveredCalendars,
        setSelectedCalendarUrl,
        setStep,
        setNotification,
        setIsTesting,
      } = createTestControllerSetup();

      mockTestAction.mockResolvedValueOnce({
        success: true,
        data: {
          calendars: [
            { url: '/remote/cal1/', displayName: 'Shoots' },
            { url: '/remote/cal2/', displayName: 'Personal' },
          ],
        },
      });

      await controller.onTestAndDiscover();

      expect(setIsTesting).toHaveBeenCalledWith(true);
      expect(setIsTesting).toHaveBeenCalledWith(false);
      expect(setDiscoveredCalendars).toHaveBeenCalledWith([
        { url: '/remote/cal1/', displayName: 'Shoots' },
        { url: '/remote/cal2/', displayName: 'Personal' },
      ]);
      expect(setSelectedCalendarUrl).toHaveBeenCalledWith('/remote/cal1/');
      expect(setStep).toHaveBeenCalledWith('select_calendar');
      expect(setNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
        }),
      );
    });

    it('handles empty calendars array from server gracefully', async () => {
      const { controller, setDiscoveredCalendars, setSelectedCalendarUrl, setStep } =
        createTestControllerSetup();

      mockTestAction.mockResolvedValueOnce({
        success: true,
        data: {
          calendars: [],
        },
      });

      await controller.onTestAndDiscover();

      expect(setDiscoveredCalendars).toHaveBeenCalledWith([]);
      expect(setSelectedCalendarUrl).not.toHaveBeenCalled();
      expect(setStep).toHaveBeenCalledWith('select_calendar');
    });

    it('handles server action error message', async () => {
      const { controller, setNotification, setIsTesting } = createTestControllerSetup();

      mockTestAction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid CalDAV credentials (401)',
      });

      await controller.onTestAndDiscover();

      expect(setIsTesting).toHaveBeenCalledWith(false);
      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 'Invalid CalDAV credentials (401)',
      });
    });

    it('handles server action error fallback when error string is absent', async () => {
      const { controller, setNotification } = createTestControllerSetup();

      mockTestAction.mockResolvedValueOnce({
        success: false,
      });

      await controller.onTestAndDiscover();

      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 't:errorGeneric',
      });
    });

    it('catches thrown exceptions during testAction execution', async () => {
      const { controller, setNotification, setIsTesting } = createTestControllerSetup();

      mockTestAction.mockRejectedValueOnce(new Error('Network disconnect'));

      await controller.onTestAndDiscover();

      expect(setIsTesting).toHaveBeenCalledWith(false);
      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 't:errorGeneric',
      });
    });
  });

  describe('I1-COV01: onSaveAndConnect branches', () => {
    it('validates selectedCalendarUrl is present', async () => {
      const { controller, setErrors, setIsSaving } = createTestControllerSetup({
        selectedCalendarUrl: '',
      });

      await controller.onSaveAndConnect();

      expect(setErrors).toHaveBeenCalledWith({ calendar: 't:errorCalendarRequired' });
      expect(setIsSaving).not.toHaveBeenCalled();
      expect(mockSaveAction).not.toHaveBeenCalled();
    });

    it('successfully saves account and connects integration', async () => {
      const { controller, setStatus, setPassword, setNotification, setIsSaving } =
        createTestControllerSetup();

      mockSaveAction.mockResolvedValueOnce({
        success: true,
        data: {
          account: {
            id: 'acc-1',
            serverUrl: 'https://cal.example.org',
            username: 'user@example.org',
            selectedCalendarUrl: '/cal/work/',
            selectedCalendarName: 'Work',
          },
        },
      });

      await controller.onSaveAndConnect();

      expect(setIsSaving).toHaveBeenCalledWith(true);
      expect(setIsSaving).toHaveBeenCalledWith(false);
      expect(setStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          connected: true,
          serverUrl: 'https://cal.example.org',
          username: 'user@example.org',
          selectedCalendarUrl: '/cal/work/',
          selectedCalendarName: 'Work',
        }),
      );
      expect(setPassword).toHaveBeenCalledWith('');
      expect(setNotification).toHaveBeenCalledWith({
        type: 'success',
        message: 't:successConnected',
      });
    });

    it('handles save action error response', async () => {
      const { controller, setNotification, setIsSaving } = createTestControllerSetup();

      mockSaveAction.mockResolvedValueOnce({
        success: false,
        error: 'Database constraint violation',
      });

      await controller.onSaveAndConnect();

      expect(setIsSaving).toHaveBeenCalledWith(false);
      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 'Database constraint violation',
      });
    });

    it('catches thrown exceptions during saveAction execution', async () => {
      const { controller, setNotification, setIsSaving } = createTestControllerSetup();

      mockSaveAction.mockRejectedValueOnce(new Error('Fatal error'));

      await controller.onSaveAndConnect();

      expect(setIsSaving).toHaveBeenCalledWith(false);
      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 't:errorGeneric',
      });
    });
  });

  describe('I1-COV01: onManualSync branches', () => {
    it('successfully triggers sync and updates lastSyncedAt', async () => {
      const { controller, setStatus, setNotification, setIsSyncing } = createTestControllerSetup();

      mockSyncAction.mockResolvedValueOnce({
        success: true,
        data: {
          syncedCount: 3,
          inboundBusyCount: 5,
        },
      });

      await controller.onManualSync();

      expect(setIsSyncing).toHaveBeenCalledWith(true);
      expect(setIsSyncing).toHaveBeenCalledWith(false);
      expect(setStatus).toHaveBeenCalledWith(expect.any(Function));
      expect(setNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
        }),
      );
    });

    it('handles sync action error response and marks FAILED status', async () => {
      const { controller, setStatus, setNotification, setIsSyncing } = createTestControllerSetup();

      mockSyncAction.mockResolvedValueOnce({
        success: false,
        error: 'CalDAV server 504 Gateway Timeout',
      });

      await controller.onManualSync();

      expect(setIsSyncing).toHaveBeenCalledWith(false);
      expect(setStatus).toHaveBeenCalledWith(expect.any(Function));
      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 'CalDAV server 504 Gateway Timeout',
      });
    });

    it('catches thrown exceptions during syncAction execution', async () => {
      const { controller, setNotification, setIsSyncing } = createTestControllerSetup();

      mockSyncAction.mockRejectedValueOnce(new Error('Sync worker crash'));

      await controller.onManualSync();

      expect(setIsSyncing).toHaveBeenCalledWith(false);
      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 't:errorGeneric',
      });
    });
  });

  describe('I1-COV01: onConfirmDisconnect branches', () => {
    it('successfully disconnects integration and resets state', async () => {
      const {
        controller,
        setStatus,
        setStep,
        setPassword,
        setNotification,
        setIsDisconnecting,
        setIsDisconnectDialogOpen,
      } = createTestControllerSetup();

      mockDisconnectAction.mockResolvedValueOnce({
        success: true,
      });

      await controller.onConfirmDisconnect();

      expect(setIsDisconnecting).toHaveBeenCalledWith(true);
      expect(setIsDisconnecting).toHaveBeenCalledWith(false);
      expect(setIsDisconnectDialogOpen).toHaveBeenCalledWith(false);
      expect(setStatus).toHaveBeenCalledWith({ connected: false });
      expect(setStep).toHaveBeenCalledWith('credentials');
      expect(setPassword).toHaveBeenCalledWith('');
      expect(setNotification).toHaveBeenCalledWith({
        type: 'success',
        message: 't:successDisconnected',
      });
    });

    it('handles disconnect action error response', async () => {
      const { controller, setNotification, setIsDisconnecting, setIsDisconnectDialogOpen } =
        createTestControllerSetup();

      mockDisconnectAction.mockResolvedValueOnce({
        success: false,
        error: 'Disconnect forbidden',
      });

      await controller.onConfirmDisconnect();

      expect(setIsDisconnecting).toHaveBeenCalledWith(false);
      expect(setIsDisconnectDialogOpen).toHaveBeenCalledWith(false);
      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 'Disconnect forbidden',
      });
    });

    it('catches thrown exceptions during disconnectAction execution', async () => {
      const { controller, setNotification, setIsDisconnecting, setIsDisconnectDialogOpen } =
        createTestControllerSetup();

      mockDisconnectAction.mockRejectedValueOnce(new Error('Connection reset'));

      await controller.onConfirmDisconnect();

      expect(setIsDisconnecting).toHaveBeenCalledWith(false);
      expect(setIsDisconnectDialogOpen).toHaveBeenCalledWith(false);
      expect(setNotification).toHaveBeenCalledWith({
        type: 'error',
        message: 't:errorGeneric',
      });
    });

    it('invokes void click and submit handlers without throwing', async () => {
      const { controller } = createTestControllerSetup();

      mockSyncAction.mockResolvedValueOnce({
        success: true,
        data: { syncedCount: 1, inboundBusyCount: 1 },
      });
      controller.handleManualSyncClick();

      mockTestAction.mockResolvedValueOnce({
        success: true,
        data: { calendars: [{ url: '/cal/1/', displayName: 'Cal 1' }] },
      });
      controller.handleTestAndDiscoverSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.SyntheticEvent);

      mockSaveAction.mockResolvedValueOnce({
        success: true,
        data: { account: {} },
      });
      controller.handleSaveAndConnectClick();

      mockDisconnectAction.mockResolvedValueOnce({
        success: true,
      });
      controller.handleConfirmDisconnectClick();

      // Test error responses in void handlers
      mockSyncAction.mockResolvedValueOnce({
        success: false,
        error: 'Sync error',
      });
      controller.handleManualSyncClick();

      mockTestAction.mockResolvedValueOnce({
        success: false,
        error: 'Test error',
      });
      controller.handleTestAndDiscoverSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.SyntheticEvent);

      mockSaveAction.mockResolvedValueOnce({
        success: false,
        error: 'Save error',
      });
      controller.handleSaveAndConnectClick();

      mockDisconnectAction.mockResolvedValueOnce({
        success: false,
        error: 'Disconnect error',
      });
      controller.handleConfirmDisconnectClick();

      // Test rejected promises in void handlers
      mockSyncAction.mockRejectedValueOnce(new Error('Sync reject'));
      controller.handleManualSyncClick();

      mockTestAction.mockRejectedValueOnce(new Error('Test reject'));
      controller.handleTestAndDiscoverSubmit({
        preventDefault: vi.fn(),
      } as unknown as React.SyntheticEvent);

      mockSaveAction.mockRejectedValueOnce(new Error('Save reject'));
      controller.handleSaveAndConnectClick();

      mockDisconnectAction.mockRejectedValueOnce(new Error('Disconnect reject'));
      controller.handleConfirmDisconnectClick();

      // Wait 100ms for promises to settle
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });
});
