import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { resolveClientIp } from '@/server/http/client-ip';
import { consumeProposalRateLimit } from '@/server/auth/rate-limiter';
import { proposals, proposalLineItems } from '@/server/db/schema/proposals';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
  client?: DbClient;
}

/**
 * Public proposal rate-limited inspection endpoint (TASK-0062 / AC-1, AC-6).
 * Protected by fail-closed atomic rate limiting (30 requests/minute per client IP).
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const client = context.client ?? defaultDb;
  const { token } = await context.params;

  // Resolve client IP
  const clientIp = resolveClientIp(request.headers) ?? '127.0.0.1';

  // Atomic rate limiting check (30 req/min fail-closed per AC-6)
  try {
    const rateCheck = await consumeProposalRateLimit(clientIp, client);
    if (!rateCheck.allowed) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    }
  } catch {
    return new NextResponse('Service Unavailable', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  if (!token || typeof token !== 'string') {
    return new NextResponse('Proposal not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');

  const [proposal] = await client
    .select()
    .from(proposals)
    .where(eq(proposals.tokenHash, tokenHash))
    .limit(1);

  if (!proposal) {
    return new NextResponse('Proposal not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (proposal.tokenRevokedAt !== null) {
    return new NextResponse('Proposal not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const lineItems = await client
    .select()
    .from(proposalLineItems)
    .where(eq(proposalLineItems.proposalId, proposal.id))
    .orderBy(asc(proposalLineItems.position), asc(proposalLineItems.createdAt));

  // Strip internal notes and sensitive studio data per GDPR Art. 5
  const sanitizedProposal = {
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
    acceptedAt: proposal.acceptedAt ? proposal.acceptedAt.toISOString() : null,
    acceptedByName: proposal.acceptedByName,
    acceptedByEmail: proposal.acceptedByEmail,
    acceptedOptionsSnapshot: proposal.acceptedOptionsSnapshot,
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
  };

  return NextResponse.json(
    { proposal: sanitizedProposal },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    },
  );
}
