import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { createHash } from 'node:crypto';
import { eq, asc, desc } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { routing } from '@/i18n/routing';
import { resolveClientIp } from '@/server/http/client-ip';
import { consumeProposalRateLimit } from '@/server/auth/rate-limiter';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';
import { clientContacts } from '@/server/db/schema/clients';
import { getStudioSettings } from '@/server/settings/repo';
import { PublicProposalView } from '@/components/proposals/public/public-proposal-view';
import { ShieldAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

interface ProposalPageProps {
  params: Promise<{ locale: string; token: string }>;
}

export async function generateMetadata({ params }: ProposalPageProps): Promise<Metadata> {
  const { token } = await params;
  let studioName = 'Ownlight Studio';
  try {
    const settings = await getStudioSettings();
    if (settings.studio_name) {
      studioName = settings.studio_name;
    }
  } catch {
    studioName = 'Ownlight Studio';
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [proposal] = await db
    .select({ title: proposals.title })
    .from(proposals)
    .where(eq(proposals.tokenHash, tokenHash))
    .limit(1);

  const title = proposal ? `${proposal.title} | ${studioName}` : `Proposal | ${studioName}`;

  return {
    title,
    robots: {
      index: false,
      follow: false,
      nocache: true,
    },
  };
}

/**
 * Public Proposal Acceptance Page at /[locale]/p/[token] (TASK-0062 / ADR-0018 §3).
 * Cookieless, rate-limited, mobile-first presentation of commercial deliverables and options.
 */
export default async function PublicProposalPage({ params }: ProposalPageProps) {
  const { locale, token } = await params;

  if (!routing.locales.includes(locale as 'en' | 'de')) {
    notFound();
  }

  // 1. Rate limiting check (30 requests/minute per client IP)
  let clientIp = '127.0.0.1';
  try {
    const h = await headers();
    clientIp = resolveClientIp(h) ?? '127.0.0.1';
  } catch {
    // Outside request context
  }

  let isRateLimited = false;
  let isRateLimitError = false;

  try {
    const rateCheck = await consumeProposalRateLimit(clientIp);
    if (!rateCheck.allowed) {
      isRateLimited = true;
    }
  } catch {
    isRateLimitError = true;
  }

  const t = await getTranslations({ locale, namespace: 'proposals.public' });

  if (isRateLimited) {
    return (
      <div
        className="mx-auto max-w-md px-4 py-16 text-center space-y-4"
        data-testid="rate-limit-exceeded"
      >
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-foreground">{t('rateLimit.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('rateLimit.message')}</p>
      </div>
    );
  }

  if (isRateLimitError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
        <h1 className="text-xl font-bold text-foreground">{t('serviceUnavailable.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('serviceUnavailable.message')}</p>
      </div>
    );
  }

  // 2. Lookup proposal by token_hash
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.tokenHash, tokenHash))
    .limit(1);

  if (!proposal) {
    notFound();
  }

  // 3. Query line items
  const lineItems = await db
    .select()
    .from(proposalLineItems)
    .where(eq(proposalLineItems.proposalId, proposal.id))
    .orderBy(asc(proposalLineItems.position), asc(proposalLineItems.createdAt));

  // 4. Resolve studio name and client contacts
  let studioName = 'Ownlight Studio';
  try {
    const settings = await getStudioSettings();
    if (settings.studio_name) {
      studioName = settings.studio_name;
    }
  } catch {
    studioName = 'Ownlight Studio';
  }

  let clientContactName = proposal.acceptedByName ?? '';
  let clientContactEmail = proposal.acceptedByEmail ?? '';

  if (!clientContactName || !clientContactEmail) {
    const [contact] = await db
      .select({
        givenName: clientContacts.givenName,
        familyName: clientContacts.familyName,
        email: clientContacts.email,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, proposal.clientId))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.createdAt))
      .limit(1);

    if (contact) {
      const contactFullName = [contact.givenName, contact.familyName]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (!clientContactName && contactFullName) clientContactName = contactFullName;
      if (!clientContactEmail && contact.email) clientContactEmail = contact.email;
    }
  }

  return (
    <PublicProposalView
      proposal={{
        id: proposal.id,
        title: proposal.title,
        status: proposal.status,
        currency: proposal.currency,
        subtotalMinor: proposal.subtotalMinor,
        taxMinor: proposal.taxMinor,
        totalMinor: proposal.totalMinor,
        pricesIncludeTax: proposal.pricesIncludeTax,
        isKleinunternehmer: proposal.isKleinunternehmer,
        taxNotice: proposal.taxNotice,
        validUntil: proposal.validUntil ? proposal.validUntil.toISOString() : null,
        tokenRevokedAt: proposal.tokenRevokedAt ? proposal.tokenRevokedAt.toISOString() : null,
        acceptedAt: proposal.acceptedAt ? proposal.acceptedAt.toISOString() : null,
        acceptedByName: proposal.acceptedByName,
        acceptedByEmail: proposal.acceptedByEmail,
        lineItems: lineItems.map((item) => ({
          id: item.id,
          itemType: item.itemType,
          name: item.name,
          description: item.description,
          unitPriceMinor: item.unitPriceMinor,
          quantity: item.quantity,
          minQuantity: item.minQuantity,
          maxQuantity: item.maxQuantity,
          taxRateBasisPoints: item.taxRateBasisPoints,
          isOptional: item.isOptional,
          isSelected: item.isSelected,
          position: item.position,
        })),
      }}
      studioName={studioName}
      token={token}
      locale={locale}
      clientContactName={clientContactName}
      clientContactEmail={clientContactEmail}
    />
  );
}
