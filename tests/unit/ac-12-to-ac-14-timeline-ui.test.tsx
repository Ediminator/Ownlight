import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

vi.mock('@/server/timeline/actions', () => ({
  addNoteAction: vi.fn(),
  updateNoteAction: vi.fn(),
  deleteNoteAction: vi.fn(),
  listTimelineAction: vi
    .fn()
    .mockResolvedValue({ success: true, data: { items: [], nextCursor: null } }),
}));

import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';
import { ClientTimeline } from '@/components/clients/client-timeline';
import { EditNoteDialog } from '@/components/clients/edit-note-dialog';
import type { ResolvedTimelineItem } from '@/server/timeline/repo';

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
}));

describe('AC-12, AC-13, AC-14, AC-9: Timeline UI rendering, i18n, a11y, and XSS safety', () => {
  const sampleItems: ResolvedTimelineItem[] = [
    {
      id: '018f0000-0000-7000-8000-000000000003',
      clientId: '018f0000-0000-7000-8000-000000000001',
      type: 'note.created',
      occurredAt: new Date('2026-06-15T14:30:00Z'),
      actorType: 'owner',
      actorId: '018f0000-0000-7000-8000-000000000000',
      subjectType: 'note',
      subjectId: '018f0000-0000-7000-8000-000000000010',
      data: {},
      createdAt: new Date('2026-06-15T14:30:00Z'),
      noteBody: 'First consultation meeting notes with client.\nDiscussed package details.',
      edited: false,
    },
    {
      id: '018f0000-0000-7000-8000-000000000002',
      clientId: '018f0000-0000-7000-8000-000000000001',
      type: 'client.contact.added',
      occurredAt: new Date('2026-06-15T12:00:00Z'),
      actorType: 'owner',
      actorId: null,
      subjectType: 'contact',
      subjectId: '018f0000-0000-7000-8000-000000000020',
      data: {},
      createdAt: new Date('2026-06-15T12:00:00Z'),
      contactName: 'Sophie Müller',
    },
    {
      id: '018f0000-0000-7000-8000-000000000001',
      clientId: '018f0000-0000-7000-8000-000000000001',
      type: 'client.created',
      occurredAt: new Date('2026-06-15T10:00:00Z'),
      actorType: 'owner',
      actorId: null,
      subjectType: 'client',
      subjectId: '018f0000-0000-7000-8000-000000000001',
      data: {},
      createdAt: new Date('2026-06-15T10:00:00Z'),
    },
  ];

  it('AC-12: renders timeline in English with localized strings from en.json', () => {
    currentLocale = 'en';

    const html = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        studioTimezone="UTC"
        initialItems={sampleItems}
      />,
    );

    expect(html).toContain('Timeline');
    expect(html).toContain('Client note');
    expect(html).toContain('Add note');
    expect(html).toContain('Please avoid recording sensitive personal data');
    expect(html).toContain('Contact added: Sophie Müller');
    expect(html).toContain('Client created');
  });

  it('AC-12: renders timeline in German with localized strings from de.json', () => {
    currentLocale = 'de';

    const html = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="de"
        studioTimezone="Europe/Berlin"
        initialItems={sampleItems}
      />,
    );

    expect(html).toContain('Verlauf');
    expect(html).toContain('Kundennotiz');
    expect(html).toContain('Notiz hinzufügen');
    expect(html).toContain('Bitte vermeiden Sie es, sensible personenbezogene Daten');
    expect(html).toContain('Kontakt hinzugefügt: Sophie Müller');
    expect(html).toContain('Kund:in angelegt');
  });

  it('AC-13: enforces semantic ordered list <ol> and accessible form association', () => {
    currentLocale = 'en';

    const html = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        studioTimezone="UTC"
        initialItems={sampleItems}
      />,
    );

    // Timeline must use semantic ordered list <ol>
    expect(html).toContain('<ol');
    expect(html).toContain('</ol>');
    expect(html).toContain('<li');

    // Composer label must be explicitly associated with textarea
    expect(html).toContain('for="timeline-note-composer"');
    expect(html).toContain('id="timeline-note-composer"');

    // Hint and counter must have unique IDs and be described on textarea
    expect(html).toContain('id="timeline-note-hint"');
    expect(html).toContain('id="timeline-note-counter"');
    expect(html).toContain('aria-describedby="timeline-note-counter timeline-note-hint"');

    // Counter must have aria-live="polite"
    expect(html).toContain('aria-live="polite"');
  });

  it('AC-9: renders potential XSS payloads literally without executing or parsing HTML', () => {
    currentLocale = 'en';

    const xssItem: ResolvedTimelineItem = {
      id: '018f0000-0000-7000-8000-000000000099',
      clientId: '018f0000-0000-7000-8000-000000000001',
      type: 'note.created',
      occurredAt: new Date('2026-06-15T15:00:00Z'),
      actorType: 'owner',
      actorId: null,
      subjectType: 'note',
      subjectId: '018f0000-0000-7000-8000-000000000099',
      data: {},
      createdAt: new Date('2026-06-15T15:00:00Z'),
      noteBody: '<script>alert(1)</script><img src=x onerror=alert(1)>',
      edited: false,
    };

    const html = renderToStaticMarkup(
      <ClientTimeline
        clientId="018f0000-0000-7000-8000-000000000001"
        locale="en"
        studioTimezone="UTC"
        initialItems={[xssItem]}
      />,
    );

    // Verifies that HTML special characters are properly escaped by React
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('AC-14: renders edit note dialog with accessible inputs and character counter', () => {
    currentLocale = 'en';

    const html = renderToStaticMarkup(
      <EditNoteDialog
        clientId="018f0000-0000-7000-8000-000000000001"
        noteId="018f0000-0000-7000-8000-000000000010"
        initialBody="Initial note text to edit"
        isOpen={true}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(html).toContain('Edit note');
    expect(html).toContain('Edit note content');
    expect(html).toContain('Save changes');
    expect(html).toContain('Cancel');
    expect(html).toContain('for="edit-note-body"');
    expect(html).toContain('id="edit-note-body"');
    expect(html).toContain('id="edit-note-counter"');
  });
});
