import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/env';

let globalTransporter: Transporter | null = null;

export function getMailTransporter(): Transporter {
  if (globalTransporter) return globalTransporter;

  let host = '127.0.0.1';
  let port = 1025;
  let user: string | undefined;
  let pass: string | undefined;
  let isProd = false;

  try {
    host = env.SMTP_HOST;
    port = env.SMTP_PORT;
    user = env.SMTP_USER;
    pass = env.SMTP_PASSWORD;
    isProd = env.NODE_ENV === 'production';
  } catch {
    host = process.env.SMTP_HOST ?? '127.0.0.1';
    port = Number(process.env.SMTP_PORT) || 1025;
    user = process.env.SMTP_USER;
    pass = process.env.SMTP_PASSWORD;
    isProd = process.env.NODE_ENV === 'production';
  }

  const auth = user && pass ? { user, pass } : undefined;

  globalTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth,
    tls: {
      rejectUnauthorized: isProd,
    },
  });

  return globalTransporter;
}

export function setTestTransporter(transporter: Transporter | null): void {
  globalTransporter = transporter;
}

export interface RecipientAddress {
  address: string;
  name?: string;
}

export interface SendEmailOptions {
  from?: string;
  to: string | RecipientAddress;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  transporter?: Transporter;
}

/**
 * Validates a recipient address, rejecting header delimiters and newlines (AC-13).
 */
export function validateRecipientAddress(recipient: string | RecipientAddress): string {
  const raw = typeof recipient === 'string' ? recipient : recipient.address;
  if (!raw || typeof raw !== 'string') {
    throw new Error('Invalid recipient email address: missing or not a string');
  }

  const address = raw.trim();

  // Reject header injection delimiters and line breaks (AC-13)
  if (/[\r\n,;\x00<>]/.test(address)) {
    throw new Error(
      'Invalid recipient email address: contains prohibited header delimiters or line breaks',
    );
  }

  // Length check (RFC 5321)
  if (address.length > 254) {
    throw new Error('Invalid recipient email address: exceeds maximum 254 characters');
  }

  // Basic email structure validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error('Invalid recipient email address format');
  }

  return address;
}

export async function sendEmail({
  from,
  to,
  subject,
  text,
  html,
  headers,
  transporter,
}: SendEmailOptions): Promise<void> {
  const validatedAddress = validateRecipientAddress(to);

  let defaultFrom = 'noreply@example.com';
  try {
    defaultFrom = env.SMTP_FROM;
  } catch {
    defaultFrom = process.env.SMTP_FROM ?? 'noreply@example.com';
  }

  const mailer = transporter ?? getMailTransporter();
  const mailOptions: {
    from: string;
    to: string | { address: string; name?: string };
    subject: string;
    text: string;
    html?: string;
    headers?: Record<string, string>;
  } = {
    from: from ?? defaultFrom,
    to: typeof to === 'string' ? validatedAddress : { address: validatedAddress },
    subject,
    text,
  };

  if (html !== undefined) {
    mailOptions.html = html;
  }

  if (headers !== undefined) {
    mailOptions.headers = headers;
  }

  await mailer.sendMail(mailOptions);
}
