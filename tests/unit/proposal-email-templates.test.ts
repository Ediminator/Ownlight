import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  renderProposalSentEmail,
  renderProposalAcceptedClientEmail,
  renderProposalAcceptedOwnerEmail,
  getProposalEmailHeaders,
  PROPOSAL_EMAIL_HEADERS,
} from '@/server/email/templates';

describe('TASK-0060: Proposal Email Templates Unit Tests (AC-2, AC-4, AC-6)', () => {
  describe('AC-6: RFC 3834 Anti-Loop Headers', () => {
    it('provides standard RFC 3834 auto-submitted headers for automated notifications', () => {
      const headers = getProposalEmailHeaders();
      expect(headers['Auto-Submitted']).toBe('auto-generated');
      expect(headers.Precedence).toBe('bulk');
      expect(headers['X-Auto-Response-Suppress']).toBe('All');

      expect(PROPOSAL_EMAIL_HEADERS['Auto-Submitted']).toBe('auto-generated');
      expect(PROPOSAL_EMAIL_HEADERS.Precedence).toBe('bulk');
    });
  });

  describe('AC-6: renderProposalSentEmail (Client Dispatch)', () => {
    it('renders English proposal sent email with plain-text and responsive HTML', () => {
      const rendered = renderProposalSentEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000001',
          title: 'Wedding Photography — Emma & Liam',
          totalMinor: 250000,
          currency: 'EUR',
          validUntil: new Date('2026-12-31T12:00:00Z'),
          token: 'tok-123',
        },
        clientName: 'Emma Watson',
        studioName: 'Lumos Photography',
        locale: 'en',
        baseUrl: 'https://studio.example.org',
      });

      // Subject
      expect(rendered.subject).toBe(
        'Proposal: Wedding Photography — Emma & Liam from Lumos Photography',
      );

      // Plain-text
      expect(rendered.text).toContain('Hello Emma Watson,');
      expect(rendered.text).toContain('You have received a new proposal from Lumos Photography.');
      expect(rendered.text).toContain('Proposal: Wedding Photography — Emma & Liam');
      expect(rendered.text).toContain('€2,500.00');
      expect(rendered.text).toContain('December 31, 2026');
      expect(rendered.text).toContain('https://studio.example.org/p/tok-123');
      expect(rendered.text).toContain('This is an automated transactional notification.');

      // HTML
      expect(rendered.html).toBeDefined();
      expect(rendered.html).toContain('<!DOCTYPE html>');
      expect(rendered.html).toContain('lang="en"');
      expect(rendered.html).toContain('Lumos Photography');
      expect(rendered.html).toContain('Hello Emma Watson,');
      expect(rendered.html).toContain('€2,500.00');
      expect(rendered.html).toContain('https://studio.example.org/p/tok-123');
      expect(rendered.html).toContain('View Proposal');
    });

    it('renders German proposal sent email with German currency and localized date', () => {
      const rendered = renderProposalSentEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000002',
          title: 'Hochzeitsfotografie — Anna & Max',
          totalMinor: 320000,
          currency: 'EUR',
          validUntil: new Date('2026-11-15T12:00:00Z'),
          token: 'tok-456',
        },
        clientName: 'Anna Schmidt',
        studioName: 'Lichtwerk Fotostudio',
        locale: 'de',
        baseUrl: 'https://lichtwerk.example.de',
      });

      // Subject
      expect(rendered.subject).toBe(
        'Angebot: Hochzeitsfotografie — Anna & Max von Lichtwerk Fotostudio',
      );

      // Plain-text
      expect(rendered.text).toContain('Hallo Anna Schmidt,');
      expect(rendered.text).toContain(
        'Sie haben ein neues Angebot von Lichtwerk Fotostudio erhalten.',
      );
      expect(rendered.text).toContain('Angebot: Hochzeitsfotografie — Anna & Max');
      expect(rendered.text).toContain('3.200,00');
      expect(rendered.text).toContain('15. November 2026');
      expect(rendered.text).toContain('https://lichtwerk.example.de/p/tok-456');

      // HTML
      expect(rendered.html).toContain('lang="de"');
      expect(rendered.html).toContain('Angebot ansehen');
      expect(rendered.html).toContain('Gesamtbetrag');
    });

    it('sanitizes malicious CRLF characters in title and names to prevent email header injection', () => {
      const rendered = renderProposalSentEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000003',
          title: 'Malicious\r\nBcc: evil@example.com\nTitle',
          totalMinor: 10000,
          currency: 'EUR',
        },
        clientName: 'Injected\r\nName',
        studioName: 'Studio\r\nBcc: hacker@example.com',
        locale: 'en',
      });

      expect(rendered.subject).not.toContain('\r');
      expect(rendered.subject).not.toContain('\n');
      expect(rendered.subject).toBe(
        'Proposal: Malicious Bcc: evil@example.com Title from Studio Bcc: hacker@example.com',
      );
      expect(rendered.text).not.toContain('Injected\r\nName');
    });

    it('handles fallback values, null fields, and invalid dates in client dispatch', () => {
      const rendered = renderProposalSentEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000001',
          title: null as unknown as string,
          totalMinor: 10000,
          currency: 'EUR',
          validUntil: 'not-a-valid-date',
          token: 'token123',
        },
        clientName: null,
        studioName: null,
        locale: null,
        baseUrl: null,
      });

      expect(rendered.subject).toContain('Proposal');
      expect(rendered.text).toContain('/p/token123');
    });

    it('I1-S01: prepends baseUrl to relative tokenUrl (/p/[token]) so rendered link is absolute', () => {
      const rendered = renderProposalSentEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000001',
          title: 'Proposal with relative tokenUrl',
          totalMinor: 150000,
          currency: 'EUR',
          tokenUrl: '/p/tok-relative-456',
        },
        clientName: 'Jane Doe',
        studioName: 'Studio Doe',
        locale: 'en',
        baseUrl: 'https://studio.example.org',
      });

      expect(rendered.text).toContain('https://studio.example.org/p/tok-relative-456');
      expect(rendered.text).not.toMatch(/View proposal:\s+\/p\//);
      expect(rendered.html).toContain('href="https://studio.example.org/p/tok-relative-456"');
    });

    it('I1-S01: preserves already absolute tokenUrl', () => {
      const rendered = renderProposalSentEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000001',
          title: 'Proposal with absolute tokenUrl',
          totalMinor: 150000,
          currency: 'EUR',
          tokenUrl: 'https://custom-domain.example.org/p/tok-abs-789',
        },
        clientName: 'Jane Doe',
        studioName: 'Studio Doe',
        locale: 'en',
        baseUrl: 'https://studio.example.org',
      });

      expect(rendered.text).toContain('https://custom-domain.example.org/p/tok-abs-789');
      expect(rendered.html).toContain('href="https://custom-domain.example.org/p/tok-abs-789"');
    });

    it('I1-S01: falls back to NEXT_PUBLIC_APP_URL when baseUrl is omitted', () => {
      const origUrl = process.env.NEXT_PUBLIC_APP_URL;
      try {
        process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
        const rendered = renderProposalSentEmail({
          proposal: {
            id: '01920000-0000-7000-8000-000000000001',
            title: 'Proposal with env fallback',
            totalMinor: 150000,
            currency: 'EUR',
            tokenUrl: '/p/tok-env-fallback',
          },
          clientName: 'Jane Doe',
          studioName: 'Studio Doe',
          locale: 'en',
        });

        expect(rendered.text).toContain('https://app.example.com/p/tok-env-fallback');
        expect(rendered.html).toContain('href="https://app.example.com/p/tok-env-fallback"');
      } finally {
        process.env.NEXT_PUBLIC_APP_URL = origUrl;
      }
    });
  });

  describe('AC-6: renderProposalAcceptedClientEmail (Client Acceptance Confirmation)', () => {
    it('renders English client acceptance email with package deliverables and add-ons', () => {
      const rendered = renderProposalAcceptedClientEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000010',
          title: 'Full Day Wedding Package',
          packageName: 'Full Day Wedding Coverage',
          includedItems: [
            '8 Hours of Continuous Coverage',
            '400+ High-Resolution Edited Images',
            'Private Online Gallery',
          ],
          selectedAddons: [
            { name: 'Second Photographer', quantity: 1, unitPriceMinor: 50000 },
            { name: 'Fine Art Album 30x30', quantity: 2, unitPriceMinor: 30000 },
          ],
          totalMinor: 360000,
          currency: 'EUR',
        },
        clientName: 'Emma Watson',
        studioName: 'Lumos Photography',
        locale: 'en',
      });

      // Subject
      expect(rendered.subject).toBe('Confirmation: Proposal accepted — Full Day Wedding Package');

      // Plain-text
      expect(rendered.text).toContain('Hello Emma Watson,');
      expect(rendered.text).toContain('Thank you for accepting our proposal.');
      expect(rendered.text).toContain('Accepted Package: Full Day Wedding Coverage');
      expect(rendered.text).toContain('Included Deliverables:');
      expect(rendered.text).toContain('8 Hours of Continuous Coverage');
      expect(rendered.text).toContain('Second Photographer: €500.00');
      expect(rendered.text).toContain('Fine Art Album 30x30 (2x): €600.00');
      expect(rendered.text).toContain('Total Amount: €3,600.00');
      expect(rendered.text).toContain('Next Steps: We are preparing your booking contract.');

      // HTML
      expect(rendered.html).toContain('<!DOCTYPE html>');
      expect(rendered.html).toContain('lang="en"');
      expect(rendered.html).toContain('Accepted Package');
      expect(rendered.html).toContain('8 Hours of Continuous Coverage');
      expect(rendered.html).toContain('Fine Art Album 30x30 (2x)');
      expect(rendered.html).toContain('€3,600.00');
    });

    it('renders German client acceptance email when no add-ons were selected', () => {
      const rendered = renderProposalAcceptedClientEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000011',
          title: 'Portrait-Session',
          packageName: 'Standard Portraitpaket',
          includedItems: ['60 Minuten Shooting', '15 bearbeitete Fotos'],
          selectedAddons: [],
          totalMinor: 25000,
          currency: 'EUR',
        },
        clientName: 'Anna Schmidt',
        studioName: 'Lichtwerk Fotostudio',
        locale: 'de',
      });

      expect(rendered.subject).toBe('Bestätigung: Angebot angenommen — Portrait-Session');
      expect(rendered.text).toContain('Hallo Anna Schmidt,');
      expect(rendered.text).toContain('Vielen Dank für die Annahme unseres Angebots.');
      expect(rendered.text).toContain('Angenommenes Paket: Standard Portraitpaket');
      expect(rendered.text).toContain('Keine');
      expect(rendered.text).toContain('250,00');
      expect(rendered.text).toContain('Nächste Schritte: Wir bereiten Ihren Buchungsvertrag vor.');
    });

    it('handles fallback values and missing fields gracefully in client confirmation', () => {
      const rendered = renderProposalAcceptedClientEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000011',
          title: null as unknown as string,
          packageName: null,
          totalMinor: 10000,
          currency: 'EUR',
        },
        clientName: null,
        studioName: null,
        locale: null,
      });

      expect(rendered.subject).toContain('Proposal');
      expect(rendered.text).toContain('€100.00');
    });
  });

  describe('AC-6: renderProposalAcceptedOwnerEmail (Studio Owner Alert)', () => {
    it('renders English owner alert with direct link to project studio workspace', () => {
      const rendered = renderProposalAcceptedOwnerEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000020',
          projectId: '01920000-0000-7000-8000-000000000099',
          title: 'Emma & Liam Wedding',
          packageName: 'Full Day Coverage',
          totalMinor: 300000,
          currency: 'EUR',
          acceptedByName: 'Emma Watson',
          acceptedByEmail: 'emma@example.com',
        },
        clientName: 'Emma Watson',
        studioName: 'Lumos Studio',
        locale: 'en',
        baseUrl: 'https://app.example.org',
      });

      // Subject
      expect(rendered.subject).toBe('Proposal Accepted: Emma & Liam Wedding');

      // Plain text
      expect(rendered.text).toContain(
        'Great news! The proposal "Emma & Liam Wedding" has been accepted by Emma Watson.',
      );
      expect(rendered.text).toContain('Package: Full Day Coverage');
      expect(rendered.text).toContain('Total Amount: €3,000.00');
      expect(rendered.text).toContain('Accepted by: Emma Watson (emma@example.com)');
      expect(rendered.text).toContain(
        'https://app.example.org/projects/01920000-0000-7000-8000-000000000099',
      );

      // HTML
      expect(rendered.html).toContain('View Project');
      expect(rendered.html).toContain(
        'https://app.example.org/projects/01920000-0000-7000-8000-000000000099',
      );
    });

    it('renders German owner alert with correct German strings and links', () => {
      const rendered = renderProposalAcceptedOwnerEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000021',
          projectId: '01920000-0000-7000-8000-000000000098',
          title: 'Anna & Max Hochzeit',
          packageName: 'Komplettpaket',
          totalMinor: 350000,
          currency: 'EUR',
          acceptedByName: 'Anna Schmidt',
          acceptedByEmail: 'anna@example.de',
        },
        clientName: 'Anna Schmidt',
        studioName: 'Lichtwerk',
        locale: 'de',
        baseUrl: 'https://app.example.de',
      });

      expect(rendered.subject).toBe('Angebot angenommen: Anna & Max Hochzeit');
      expect(rendered.text).toContain(
        'Gute Neuigkeiten! Das Angebot „Anna & Max Hochzeit“ wurde von Anna Schmidt angenommen.',
      );
      expect(rendered.text).toContain('3.500,00');
      expect(rendered.text).toContain('Angenommen von: Anna Schmidt (anna@example.de)');
      expect(rendered.html).toContain('Projekt ansehen');
      expect(rendered.html).toContain(
        'https://app.example.de/projects/01920000-0000-7000-8000-000000000098',
      );
    });

    it('handles fallback values and missing fields gracefully in owner alert', () => {
      const rendered = renderProposalAcceptedOwnerEmail({
        proposal: {
          id: '01920000-0000-7000-8000-000000000021',
          projectId: '01920000-0000-7000-8000-000000000098',
          title: null as unknown as string,
          packageName: null,
          totalMinor: 10000,
          currency: 'EUR',
          acceptedByName: null,
          acceptedByEmail: null,
        },
        clientName: null,
        studioName: null,
        locale: null,
        baseUrl: null,
      });

      expect(rendered.subject).toContain('Proposal');
      expect(rendered.text).toContain('/projects/01920000-0000-7000-8000-000000000098');
    });
  });
});
