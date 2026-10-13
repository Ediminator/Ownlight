import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: (section?: string) => (key: string, values?: Record<string, unknown>) => {
    return `${section ? `${section}.` : ''}${key}${values ? JSON.stringify(values) : ''}`;
  },
}));

const mockNotFound = vi.fn();
vi.mock('next/navigation', () => ({
  notFound: () => {
    mockNotFound();
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const mockGetPublishedFormBySlug = vi.fn();
vi.mock('@/server/inquiry-forms/service', () => ({
  getPublishedFormBySlug: async (slug: string) => mockGetPublishedFormBySlug(slug),
}));

const mockGetNoticeVersionById = vi.fn();
vi.mock('@/server/inquiry-forms/repo', () => ({
  getNoticeVersionById: async (id: string) => mockGetNoticeVersionById(id),
}));

const mockGetStudioSettings = vi.fn();
vi.mock('@/server/settings/repo', () => ({
  getStudioSettings: async () => mockGetStudioSettings(),
}));

const mockGetEmbedOrigins = vi.fn();
vi.mock('@/env', () => ({
  getEmbedOrigins: () => mockGetEmbedOrigins(),
}));

import EmbedFormPage from '@/app/[locale]/f/[slug]/embed/page';
import type { InquiryForm, InquiryFormNoticeVersion } from '@/server/db/schema/inquiry-forms';

describe('AC-1, AC-2: EmbedFormPage server component', () => {
  const mockNotice: InquiryFormNoticeVersion = {
    id: '018f0000-0000-7000-8000-000000000011',
    formId: '018f0000-0000-7000-8000-000000000010',
    version: 1,
    acknowledgementTextEn: 'I acknowledge the privacy notice.',
    acknowledgementTextDe: 'Ich nehme die Datenschutzerklärung zur Kenntnis.',
    privacyPolicyUrl: 'https://photographer.example/privacy',
    createdByActorId: 'owner-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  const mockForm: InquiryForm = {
    id: '018f0000-0000-7000-8000-000000000010',
    slug: 'inq-embed01',
    name: 'Wedding Inquiries',
    status: 'published',
    defaultLocale: 'en',
    fields: [
      { key: 'given_name', enabled: true, required: true, order: 0 },
      { key: 'email', enabled: true, required: true, order: 1 },
    ],
    eventTypes: [],
    currentNoticeVersionId: mockNotice.id,
    autoReplyEnabled: true,
    acceptUnverified: true,
    successRedirectUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEmbedOrigins.mockReturnValue(['https://photographer.example']);
    mockGetPublishedFormBySlug.mockResolvedValue(mockForm);
    mockGetNoticeVersionById.mockResolvedValue(mockNotice);
    mockGetStudioSettings.mockResolvedValue({
      studio_name: 'Studio Test Lumière',
      timezone: 'Europe/Berlin',
    });
  });

  it('AC-1: renders chromeless HostedInquiryForm with deliveryMode="embed" for valid published form', async () => {
    const pageJsx = await EmbedFormPage({
      params: Promise.resolve({ locale: 'en', slug: 'inq-embed01' }),
    });

    const html = renderToStaticMarkup(pageJsx);
    expect(html).toContain('name="delivery_mode"');
    expect(html).toContain('value="embed"');
    expect(html).toContain('I acknowledge the privacy notice.');
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('AC-2: triggers notFound() when allowed origins list is empty', async () => {
    mockGetEmbedOrigins.mockReturnValue([]);

    await expect(
      EmbedFormPage({
        params: Promise.resolve({ locale: 'en', slug: 'inq-embed01' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
  });

  it('triggers notFound() when locale is unsupported', async () => {
    await expect(
      EmbedFormPage({
        params: Promise.resolve({ locale: 'fr', slug: 'inq-embed01' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
  });

  it('triggers notFound() when form is not found or not published', async () => {
    mockGetPublishedFormBySlug.mockResolvedValue(null);

    await expect(
      EmbedFormPage({
        params: Promise.resolve({ locale: 'en', slug: 'missing-slug' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
  });

  it('triggers notFound() when notice version is missing', async () => {
    mockGetNoticeVersionById.mockResolvedValue(null);

    await expect(
      EmbedFormPage({
        params: Promise.resolve({ locale: 'en', slug: 'inq-embed01' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
  });

  it('falls back to default studio settings when getStudioSettings fails', async () => {
    mockGetStudioSettings.mockRejectedValue(new Error('DB_DOWN'));

    const pageJsx = await EmbedFormPage({
      params: Promise.resolve({ locale: 'de', slug: 'inq-embed01' }),
    });

    const html = renderToStaticMarkup(pageJsx);
    expect(html).toContain('name="delivery_mode"');
    expect(html).toContain('value="embed"');
    expect(html).toContain('Ich nehme die Datenschutzerklärung zur Kenntnis.');
  });
});
