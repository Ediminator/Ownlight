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

export interface SendEmailOptions {
  from?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  transporter?: Transporter;
}

export async function sendEmail({
  from,
  to,
  subject,
  text,
  html,
  transporter,
}: SendEmailOptions): Promise<void> {
  let defaultFrom = 'noreply@example.com';
  try {
    defaultFrom = env.SMTP_FROM;
  } catch {
    defaultFrom = process.env.SMTP_FROM ?? 'noreply@example.com';
  }

  const mailer = transporter ?? getMailTransporter();
  const mailOptions: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  } = {
    from: from ?? defaultFrom,
    to,
    subject,
    text,
  };

  if (html !== undefined) {
    mailOptions.html = html;
  }

  await mailer.sendMail(mailOptions);
}
