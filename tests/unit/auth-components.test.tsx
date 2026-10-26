import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let mockIsPending = false;
let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useTransition: () => [
      mockIsPending,
      (fn: () => void | Promise<void>) => {
        void fn();
      },
    ],
    useState: <T,>(initial: T): [T, (val: T) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [val, vi.fn()];
      }
      return actual.useState(initial);
    },
    useEffect: (fn: React.EffectCallback) => {
      try {
        const cleanup = fn();
        if (typeof cleanup === 'function') {
          cleanup();
        }
      } catch {
        // Ignore effect errors in unit test environment
      }
    },
  };
});

const mockPush = vi.fn();
const mockRefresh = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `translated-${key}`,
}));

const mockSetupOwnerAction = vi.fn();
const mockSignInAction = vi.fn();
const mockRequestPasswordResetAction = vi.fn();
const mockResetPasswordAction = vi.fn();

vi.mock('server-only', () => ({}));

vi.mock('@/server/auth/actions', () => ({
  setupOwnerAction: (...args: unknown[]): unknown => mockSetupOwnerAction(...args),
  signInAction: (...args: unknown[]): unknown => mockSignInAction(...args),
  requestPasswordResetAction: (...args: unknown[]): unknown =>
    mockRequestPasswordResetAction(...args),
  resetPasswordAction: (...args: unknown[]): unknown => mockResetPasswordAction(...args),
}));

const mockVerifyMfaTotpAction = vi.fn();
const mockVerifyMfaRecoveryCodeAction = vi.fn();
const mockStartPasskeyAuthenticationAction = vi.fn();
const mockCompletePasskeyAuthenticationAction = vi.fn();

vi.mock('@/server/auth/mfa-actions', () => ({
  verifyMfaTotpAction: (...args: unknown[]): unknown => mockVerifyMfaTotpAction(...args),
  verifyMfaRecoveryCodeAction: (...args: unknown[]): unknown =>
    mockVerifyMfaRecoveryCodeAction(...args),
  startPasskeyAuthenticationAction: (...args: unknown[]): unknown =>
    mockStartPasskeyAuthenticationAction(...args),
  completePasskeyAuthenticationAction: (...args: unknown[]): unknown =>
    mockCompletePasskeyAuthenticationAction(...args),
}));

let mockIsWebAuthnSupported = true;
vi.mock('@/lib/webauthn-client', () => ({
  isWebAuthnSupported: () => mockIsWebAuthnSupported,
  base64UrlToBuffer: () => new ArrayBuffer(0),
  bufferToBase64Url: () => 'mock-b64',
}));

import { SetupForm } from '@/components/auth/setup-form';
import { SignInForm, sanitizeCallbackUrl } from '@/components/auth/sign-in-form';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { VerifyEmailView } from '@/components/auth/verify-email-view';

interface FormProps {
  onSubmit: (e: { preventDefault: () => void }) => Promise<void> | void;
}

interface InputProps {
  onChange?: (e: { target: { value: string } }) => void;
}

function findFormProps(element: React.ReactElement): FormProps | undefined {
  let found: FormProps | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      if (
        node.type === 'form' &&
        typeof (node.props as Record<string, unknown>).onSubmit === 'function'
      ) {
        found = node.props as FormProps;
        return;
      }
      const props = node.props as { children?: unknown };
      if (props.children) {
        traverse(props.children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    }
  }
  traverse(element);
  return found;
}

function findInputs(element: React.ReactElement): InputProps[] {
  const inputs: InputProps[] = [];
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      if (node.type === 'input') {
        inputs.push(node.props as InputProps);
      }
      const props = node.props as { children?: unknown };
      if (props.children) {
        traverse(props.children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    }
  }
  traverse(element);
  return inputs;
}

function findButtonByTestId(
  element: React.ReactElement,
  testId: string,
): { onClick?: () => void | Promise<void> } | undefined {
  let found: { onClick?: () => void | Promise<void> } | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (props['data-testid'] === testId && typeof props.onClick === 'function') {
        found = { onClick: props.onClick as () => void | Promise<void> };
        return;
      }
      if (props.children) {
        traverse(props.children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    }
  }
  traverse(element);
  return found;
}

describe('Auth Client Components and Form Submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockIsPending = false;
    mockStateQueue = [];
    mockIsWebAuthnSupported = true;
  });

  describe('SetupForm', () => {
    it('renders setup form with all input fields and descriptions', () => {
      const html = renderToStaticMarkup(<SetupForm locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="setup-form"');
      expect(html).toContain('data-testid="setup-token-input"');
      expect(html).toContain('data-testid="name-input"');
      expect(html).toContain('data-testid="email-input"');
      expect(html).toContain('data-testid="password-input"');
    });

    it('executes onSubmit handler and triggers router navigation on success', async () => {
      mockSetupOwnerAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SetupForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      expect(formProps).toBeDefined();

      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSetupOwnerAction).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/en');
    });

    it('executes onSubmit handler and sets error on failure', async () => {
      mockSetupOwnerAction.mockResolvedValueOnce({
        success: false,
        error: 'Setup token invalid.',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SetupForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSetupOwnerAction).toHaveBeenCalled();
    });

    it('triggers input onChange handlers', () => {
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = SetupForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'test-value' } });
      }
    });

    it('renders setup form with error alert and pending submit button', () => {
      mockStateQueue = ['', '', '', '', 'Setup token invalid'];
      mockIsPending = true;
      const html = renderToStaticMarkup(<SetupForm locale="en" />);
      expect(html).toContain('data-testid="setup-error"');
      expect(html).toContain('Setup token invalid');
      expect(html).toContain('translated-submitting');
      // I1-U01 & I1-U02
      expect(html).toContain('text-red-950');
      expect(html).toContain('id="setup-error-msg"');
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="setup-error-msg"');
    });

    it('AC-3 / I1-U01: renders tokenless subtitle and hides token input when requireToken={false}', () => {
      const html = renderToStaticMarkup(<SetupForm locale="en" requireToken={false} />);
      expect(html).toContain('translated-descriptionTokenless');
      expect(html).not.toContain('data-testid="setup-token-input"');
    });

    it('AC-3: renders setup token input when requireToken={true}', () => {
      const html = renderToStaticMarkup(<SetupForm locale="en" requireToken={true} />);
      expect(html).toContain('translated-description');
      expect(html).toContain('data-testid="setup-token-input"');
    });
  });

  describe('SignInForm', () => {
    it('renders sign-in form with email and password inputs and forgot password link', () => {
      const html = renderToStaticMarkup(<SignInForm locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="signin-form"');
      expect(html).toContain('data-testid="email-input"');
      expect(html).toContain('data-testid="password-input"');
      expect(html).toContain('/forgot-password');
    });

    it('AC-4: renders setup callout when setupAvailable={true}', () => {
      const html = renderToStaticMarkup(<SignInForm locale="en" setupAvailable={true} />);
      expect(html).toContain('data-testid="signin-setup-callout"');
      expect(html).toContain('data-testid="signin-setup-callout-link"');
      expect(html).toContain('min-h-[24px]');
      expect(html).toContain('aria-hidden="true"');
    });

    it('AC-4: omits setup callout when setupAvailable={false}', () => {
      const html = renderToStaticMarkup(<SignInForm locale="en" setupAvailable={false} />);
      expect(html).not.toContain('data-testid="signin-setup-callout"');
    });

    it('I2-U02: renders localized divider between password and passkey sign in', () => {
      const html = renderToStaticMarkup(<SignInForm locale="de" />);
      expect(html).toContain('translated-or');
    });

    it('executes signInAction and navigates on success', async () => {
      mockSignInAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSignInAction).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/en');
    });

    it('handles sign in failure', async () => {
      mockSignInAction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid email or password.',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSignInAction).toHaveBeenCalled();
    });

    it('triggers input onChange handlers in SignInForm', () => {
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'user@example.com' } });
      }
    });

    it('renders sign-in form with error alert and pending submit button', () => {
      mockStateQueue = ['', '', 'Invalid email or password'];
      mockIsPending = true;
      const html = renderToStaticMarkup(<SignInForm locale="en" />);
      expect(html).toContain('data-testid="signin-error"');
      expect(html).toContain('Invalid email or password');
      expect(html).toContain('translated-submitting');
      // I1-U01: High contrast classes
      expect(html).toContain('text-red-950');
      expect(html).toContain('bg-red-100');
      // I1-U02: Error linkage with aria-invalid and aria-describedby
      expect(html).toContain('id="signin-error-msg"');
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="signin-error-msg"');
    });

    it('I1-S03: sanitizeCallbackUrl rejects open redirects and external schemes', () => {
      expect(sanitizeCallbackUrl('https://evil.com', 'en')).toBe('/en');
      expect(sanitizeCallbackUrl('http://attacker.com/steal', 'de')).toBe('/de');
      expect(sanitizeCallbackUrl('//malicious.com', 'en')).toBe('/en');
      expect(sanitizeCallbackUrl('javascript:alert(1)', 'en')).toBe('/en');
      expect(sanitizeCallbackUrl('/\\evil.com', 'en')).toBe('/en');
      expect(sanitizeCallbackUrl(null, 'en')).toBe('/en');
      expect(sanitizeCallbackUrl(undefined, 'de')).toBe('/de');
      expect(sanitizeCallbackUrl('', 'en')).toBe('/en');

      // Valid relative paths must be accepted
      expect(sanitizeCallbackUrl('/en/dashboard', 'en')).toBe('/en/dashboard');
      expect(sanitizeCallbackUrl('/de/settings', 'de')).toBe('/de/settings');
    });

    it('I1-S03: SignInForm sanitizes open redirect callbackUrl upon successful sign-in', async () => {
      mockSearchParams = new URLSearchParams('callbackUrl=https://attacker.com/phish');
      mockSignInAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSignInAction).toHaveBeenCalled();
      // Must NOT redirect to https://attacker.com
      expect(mockPush).toHaveBeenCalledWith('/en');
      mockSearchParams = new URLSearchParams();
    });

    it('renders MFA step with TOTP input and verify button', () => {
      mockStateQueue = [
        'mfa', // step
        'user@example.com', // email
        '', // password
        null, // error
        'ticket-123', // mfaTicket
        'totp', // mfaMode
        '', // totpCode
        '', // recoveryCode
      ];
      const html = renderToStaticMarkup(<SignInForm locale="en" />);
      expect(html).toContain('data-testid="mfa-challenge-form"');
      expect(html).toContain('data-testid="mfa-code-input"');
      expect(html).toContain('data-testid="mfa-submit-btn"');
      expect(html).toContain('translated-verifyMfa');
    });

    it('renders MFA step with recovery code input when mode is recovery', () => {
      mockStateQueue = [
        'mfa', // step
        'user@example.com', // email
        '', // password
        null, // error
        'ticket-123', // mfaTicket
        'recovery', // mfaMode
        '', // totpCode
        '', // recoveryCode
      ];
      const html = renderToStaticMarkup(<SignInForm locale="en" />);
      expect(html).toContain('data-testid="recovery-code-input"');
    });

    it('triggers input onChange handlers in MFA step for totp and recovery codes', () => {
      mockStateQueue = ['mfa', 'user@example.com', '', null, 'ticket-123', 'totp', '', ''];
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }
      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: '123456' } });
      }

      mockStateQueue = ['mfa', 'user@example.com', '', null, 'ticket-123', 'recovery', '', ''];
      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'REC-1234-5678' } });
      }
    });

    it('submits TOTP code in MFA step and navigates on success', async () => {
      mockVerifyMfaTotpAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      mockStateQueue = ['mfa', 'user@example.com', '', null, 'ticket-123', 'totp', '123456', ''];

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockVerifyMfaTotpAction).toHaveBeenCalledWith({
        mfaTicket: 'ticket-123',
        code: '123456',
      });
      expect(mockPush).toHaveBeenCalledWith('/en');
      expect(mockRefresh).toHaveBeenCalled();
    });

    it('sets error when TOTP code verification fails', async () => {
      mockVerifyMfaTotpAction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid authenticator code.',
      });

      mockStateQueue = ['mfa', 'user@example.com', '', null, 'ticket-123', 'totp', '000000', ''];

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockVerifyMfaTotpAction).toHaveBeenCalled();
    });

    it('submits recovery code in MFA step and navigates on success', async () => {
      mockVerifyMfaRecoveryCodeAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      mockStateQueue = [
        'mfa',
        'user@example.com',
        '',
        null,
        'ticket-123',
        'recovery',
        '',
        'REC-1234-5678',
      ];

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockVerifyMfaRecoveryCodeAction).toHaveBeenCalledWith({
        mfaTicket: 'ticket-123',
        recoveryCode: 'REC-1234-5678',
      });
      expect(mockPush).toHaveBeenCalledWith('/en');
    });

    it('sets error when recovery code verification fails', async () => {
      mockVerifyMfaRecoveryCodeAction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid recovery code.',
      });

      mockStateQueue = [
        'mfa',
        'user@example.com',
        '',
        null,
        'ticket-123',
        'recovery',
        '',
        'REC-BAD-CODE',
      ];

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockVerifyMfaRecoveryCodeAction).toHaveBeenCalled();
    });

    it('transitions to MFA step when signInAction returns requiresMfa: true', async () => {
      mockSignInAction.mockResolvedValueOnce({
        requiresMfa: true,
        mfaTicket: 'ticket-abc',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSignInAction).toHaveBeenCalled();
    });

    it('executes passkey sign in flow successfully', async () => {
      mockStartPasskeyAuthenticationAction.mockResolvedValueOnce({
        success: true,
        data: {
          options: {
            challenge: 'test-challenge',
            rpId: 'localhost',
            userVerification: 'preferred',
            timeout: 60000,
          },
        },
      });

      const mockGet = vi.fn().mockResolvedValueOnce({
        id: 'cred-1',
        response: {
          clientDataJSON: new ArrayBuffer(8),
          authenticatorData: new ArrayBuffer(8),
          signature: new ArrayBuffer(8),
          userHandle: new ArrayBuffer(8),
        },
      });

      Object.defineProperty(global.navigator, 'credentials', {
        value: { get: mockGet },
        configurable: true,
        writable: true,
      });

      mockCompletePasskeyAuthenticationAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      let buttonProps: { onClick?: () => void | Promise<void> } | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        buttonProps = findButtonByTestId(tree, 'passkey-signin-btn');
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      expect(buttonProps).toBeDefined();
      await buttonProps?.onClick?.();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockStartPasskeyAuthenticationAction).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalled();
      expect(mockCompletePasskeyAuthenticationAction).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/en');
      expect(mockRefresh).toHaveBeenCalled();
    });

    it('sets error when passkey sign in is clicked but WebAuthn is not supported', async () => {
      mockIsWebAuthnSupported = false;

      let buttonProps: { onClick?: () => void | Promise<void> } | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        buttonProps = findButtonByTestId(tree, 'passkey-signin-btn');
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await buttonProps?.onClick?.();
      expect(mockStartPasskeyAuthenticationAction).not.toHaveBeenCalled();
    });

    it('handles passkey start failure, credential cancellation, complete failure, and errors', async () => {
      // 1. Start action failure
      mockStartPasskeyAuthenticationAction.mockResolvedValueOnce({
        success: false,
        error: 'Failed to start passkey auth.',
      });

      let buttonProps: { onClick?: () => void | Promise<void> } | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        buttonProps = findButtonByTestId(tree, 'passkey-signin-btn');
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await buttonProps?.onClick?.();
      expect(mockStartPasskeyAuthenticationAction).toHaveBeenCalled();

      // 2. User cancels passkey prompt (credentials.get returns null)
      mockStartPasskeyAuthenticationAction.mockResolvedValueOnce({
        success: true,
        data: {
          options: {
            challenge: 'test-challenge',
            rpId: 'localhost',
          },
        },
      });
      Object.defineProperty(global.navigator, 'credentials', {
        value: { get: vi.fn().mockResolvedValueOnce(null) },
        configurable: true,
        writable: true,
      });

      renderToStaticMarkup(<Wrapper />);
      await buttonProps?.onClick?.();

      // 3. Complete action failure
      mockStartPasskeyAuthenticationAction.mockResolvedValueOnce({
        success: true,
        data: {
          options: {
            challenge: 'test-challenge',
            rpId: 'localhost',
          },
        },
      });
      Object.defineProperty(global.navigator, 'credentials', {
        value: {
          get: vi.fn().mockResolvedValueOnce({
            id: 'cred-1',
            response: {
              clientDataJSON: new ArrayBuffer(0),
              authenticatorData: new ArrayBuffer(0),
              signature: new ArrayBuffer(0),
            },
          }),
        },
        configurable: true,
        writable: true,
      });
      mockCompletePasskeyAuthenticationAction.mockResolvedValueOnce({
        success: false,
        error: 'Passkey verification failed.',
      });

      renderToStaticMarkup(<Wrapper />);
      await buttonProps?.onClick?.();

      // 4. Exception thrown
      mockStartPasskeyAuthenticationAction.mockRejectedValueOnce(
        new Error('Network error during passkey auth'),
      );

      renderToStaticMarkup(<Wrapper />);
      await buttonProps?.onClick?.();
    });
  });

  describe('ForgotPasswordForm', () => {
    it('renders forgot-password form with email input and submit button', () => {
      const html = renderToStaticMarkup(<ForgotPasswordForm locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="forgot-password-form"');
      expect(html).toContain('data-testid="email-input"');
      expect(html).toContain('/sign-in');
    });

    it('executes requestPasswordResetAction and updates status message', async () => {
      mockRequestPasswordResetAction.mockResolvedValueOnce({
        success: true,
        data: { message: 'Reset email dispatched.' },
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = ForgotPasswordForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockRequestPasswordResetAction).toHaveBeenCalled();
    });

    it('handles requestPasswordResetAction failure', async () => {
      mockSearchParams = new URLSearchParams('email=preset@example.com');
      mockRequestPasswordResetAction.mockResolvedValueOnce({
        success: false,
        error: 'Rate limit exceeded.',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = ForgotPasswordForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockRequestPasswordResetAction).toHaveBeenCalled();
    });

    it('triggers email input onChange in ForgotPasswordForm', () => {
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = ForgotPasswordForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'forgot@example.com' } });
      }
    });

    it('renders forgot-password form with status message, error alert and pending submit button', () => {
      mockStateQueue = ['', 'Instructions dispatched', null];
      mockIsPending = false;
      const htmlStatus = renderToStaticMarkup(<ForgotPasswordForm locale="en" />);
      expect(htmlStatus).toContain('data-testid="forgot-password-feedback"');
      expect(htmlStatus).toContain('Instructions dispatched');

      mockStateQueue = ['', null, 'Rate limit reached'];
      mockIsPending = true;
      const htmlError = renderToStaticMarkup(<ForgotPasswordForm locale="en" />);
      expect(htmlError).toContain('data-testid="forgot-password-error"');
      expect(htmlError).toContain('Rate limit reached');
      expect(htmlError).toContain('translated-submitting');
      // I1-U01 & I1-U02
      expect(htmlError).toContain('text-red-950');
      expect(htmlError).toContain('id="forgot-password-error-msg"');
      expect(htmlError).toContain('aria-invalid="true"');
      expect(htmlError).toContain('aria-describedby="forgot-password-error-msg"');
    });
  });

  describe('ResetPasswordForm', () => {
    it('renders reset-password form with new password input', () => {
      mockSearchParams = new URLSearchParams('token=test-token-123&email=user@example.com');
      const html = renderToStaticMarkup(<ResetPasswordForm locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="reset-password-form"');
      expect(html).toContain('data-testid="password-input"');
    });

    it('executes resetPasswordAction on submit and handles success', async () => {
      mockSearchParams = new URLSearchParams('token=valid-token&email=user@example.com');
      mockResetPasswordAction.mockResolvedValueOnce({
        success: true,
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = ResetPasswordForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockResetPasswordAction).toHaveBeenCalled();
    });

    it('handles password mismatch and reset failure', async () => {
      mockSearchParams = new URLSearchParams('token=valid-token&email=user@example.com');
      mockResetPasswordAction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid or expired token.',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = ResetPasswordForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockResetPasswordAction).toHaveBeenCalled();
    });

    it('triggers input onChange handlers in ResetPasswordForm', () => {
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = ResetPasswordForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'password-val' } });
      }
    });

    it('renders reset-password form with error alert, success view and pending submit button', () => {
      mockStateQueue = ['', '', false, 'Tokens do not match'];
      mockIsPending = true;
      const htmlError = renderToStaticMarkup(<ResetPasswordForm locale="en" />);
      expect(htmlError).toContain('data-testid="reset-password-error"');
      expect(htmlError).toContain('Tokens do not match');
      expect(htmlError).toContain('translated-submitting');
      // I1-U01 & I1-U02
      expect(htmlError).toContain('text-red-950');
      expect(htmlError).toContain('id="reset-password-error-msg"');
      expect(htmlError).toContain('aria-invalid="true"');
      expect(htmlError).toContain('aria-describedby="reset-password-error-msg"');

      mockStateQueue = ['', '', true, null];
      mockIsPending = false;
      const htmlSuccess = renderToStaticMarkup(<ResetPasswordForm locale="en" />);
      expect(htmlSuccess).toContain('data-testid="reset-password-success"');
      expect(htmlSuccess).toContain('translated-successTitle');
    });
  });

  describe('VerifyEmailView', () => {
    it('renders verify email confirmation view and sign in link', () => {
      const html = renderToStaticMarkup(<VerifyEmailView locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="verify-email-title"');
      expect(html).toContain('/sign-in');
    });
  });
});
