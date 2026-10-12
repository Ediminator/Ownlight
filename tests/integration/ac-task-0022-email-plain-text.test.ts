import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () =>
    Promise.resolve({
      get: () => '127.0.0.1',
    }),
}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { setupOwnerAction, requestPasswordResetAction } from '@/server/auth/actions';
import { sendEmail } from '@/server/auth/email';
import type { DbClient } from '@/server/db/client';
import type { Transporter, SendMailOptions } from 'nodemailer';

describe('TASK-0022: AC-8 Plain Text Email Delivery Without HTML Part (F4 Fix)', () => {
  let testDb: TestDatabaseInstance;
  const setupToken = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    process.env.SETUP_TOKEN = setupToken;
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-8: sendEmail omits html property when html is not provided (unit level)', async () => {
    const sentMails: SendMailOptions[] = [];
    const mockTransporter = {
      sendMail: (options: SendMailOptions) => {
        sentMails.push(options);
        return Promise.resolve({ messageId: 'msg-plain-1' });
      },
    } as unknown as Transporter;

    // Send plain-text only email
    await sendEmail({
      to: 'client@example.org',
      subject: 'Plain Text Notice',
      text: 'This is plain text only.',
      transporter: mockTransporter,
    });

    expect(sentMails).toHaveLength(1);
    const plainMail = sentMails[0];
    expect(plainMail).toBeDefined();
    if (!plainMail) throw new Error('Expected plainMail to be defined');
    expect(plainMail.text).toBe('This is plain text only.');
    expect(plainMail.html).toBeUndefined();
    expect('html' in plainMail).toBe(false);

    // Verify that when html IS explicitly provided, it is included
    await sendEmail({
      to: 'client@example.org',
      subject: 'Rich Text Notice',
      text: 'Fallback text',
      html: '<p>Fallback text</p>',
      transporter: mockTransporter,
    });

    expect(sentMails).toHaveLength(2);
    const richMail = sentMails[1];
    expect(richMail).toBeDefined();
    if (!richMail) throw new Error('Expected richMail to be defined');
    expect(richMail.text).toBe('Fallback text');
    expect(richMail.html).toBe('<p>Fallback text</p>');
  });

  it('AC-8: requestPasswordResetAction sends email with text part and NO html part', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Set up owner account
    const setupResult = await setupOwnerAction(
      {
        setupToken,
        name: 'Studio Owner',
        email: 'owner@example.org',
        password: 'ValidPassword123!',
      },
      dbClient,
    );
    expect(setupResult.success).toBe(true);

    // 2. Mock transporter to capture outgoing reset email
    const capturedMails: SendMailOptions[] = [];
    const mockTransporter = {
      sendMail: (options: SendMailOptions) => {
        capturedMails.push(options);
        return Promise.resolve({ messageId: 'reset-msg-1' });
      },
    } as unknown as Transporter;

    // 3. Request password reset
    const result = await requestPasswordResetAction(
      { email: 'owner@example.org' },
      {
        client: dbClient,
        transporter: mockTransporter,
        baseUrl: 'http://localhost:3000',
      },
    );

    expect(result.success).toBe(true);
    expect(capturedMails).toHaveLength(1);

    const resetMail = capturedMails[0];
    expect(resetMail).toBeDefined();
    if (!resetMail) throw new Error('Expected resetMail to be defined');
    expect(resetMail.to).toBe('owner@example.org');
    expect(resetMail.subject).toBe('Password Reset Request');

    // Text part must be present and contain reset link
    expect(typeof resetMail.text).toBe('string');
    expect(resetMail.text).toContain('http://localhost:3000/en/reset-password?token=');
    expect(resetMail.text).toContain('Studio Owner');

    // HTML part must be completely absent (not defaulting to text)
    expect(resetMail.html).toBeUndefined();
    expect('html' in resetMail).toBe(false);
  });
});
