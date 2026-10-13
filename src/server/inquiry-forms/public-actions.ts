'use server';

import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveClientIp } from '@/server/http/client-ip';
import { submitInquiry } from './submit';
import type { LeadLocale, LeadDeliveryMode } from '@/server/db/schema/leads';
import { db as defaultDb, type DbClient } from '@/server/db/client';

export interface InquiryFormActionState {
  success: boolean;
  outcome?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  redirectUrl?: string;
}

/**
 * Public server action for inquiry form submissions (AC-1, AC-2, AC-16).
 * Never reads owner session or cookies.
 * Resolves client IP via trusted proxy hops.
 * Submits with deliveryMode 'hosted' and verification 'unverified'.
 */
export async function submitInquiryAction(
  prevState: InquiryFormActionState | null,
  formData: FormData,
  client: DbClient = defaultDb,
): Promise<InquiryFormActionState> {
  let clientIp: string | null = null;
  try {
    const reqHeaders = await headers();
    clientIp = resolveClientIp(reqHeaders);
  } catch {
    // In tests or outside Next request context
    clientIp = null;
  }

  const rawInput: Record<string, unknown> = {};
  const values: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    // Ignore internal React / Next.js Server Action fields ($ACTION_REF_*, etc.)
    if (key.startsWith('$') || key.startsWith('_$')) {
      continue;
    }
    if (typeof value === 'string') {
      rawInput[key] = value;
      values[key] = value;
    }
  }

  const slug = (formData.get('slug') as string) || '';
  const rawLocale = (formData.get('locale') as string) || 'en';
  const locale: LeadLocale = rawLocale === 'de' ? 'de' : 'en';

  // Handle notice_acknowledged checkbox (HTML checkboxes don't send anything when unchecked)
  if (formData.has('notice_acknowledged')) {
    const val = formData.get('notice_acknowledged');
    rawInput.notice_acknowledged = val === 'on' || val === 'true' || val === '1';
  } else {
    rawInput.notice_acknowledged = false;
  }

  const rawDeliveryMode = formData.get('delivery_mode') ?? formData.get('deliveryMode');
  const deliveryMode: LeadDeliveryMode = rawDeliveryMode === 'embed' ? 'embed' : 'hosted';

  // Remove internal routing fields from validation input
  delete rawInput.slug;
  delete rawInput.locale;
  delete rawInput.delivery_mode;
  delete rawInput.deliveryMode;
  delete values.altcha_payload;

  const result = await submitInquiry(
    rawInput,
    {
      slug,
      locale,
      deliveryMode,
      verification: 'unverified',
      clientIp,
    },
    client,
  );

  if (result.success) {
    const defaultThanks =
      deliveryMode === 'embed'
        ? `/${locale}/f/${slug}/embed/thanks`
        : `/${locale}/f/${slug}/thanks`;
    const redirectUrl = result.redirectUrl ?? defaultThanks;
    redirect(redirectUrl);
    return {
      success: true,
      redirectUrl,
    };
  }

  return {
    success: false,
    outcome: result.outcome,
    error: result.error,
    fieldErrors: result.fieldErrors,
    values,
  };
}
