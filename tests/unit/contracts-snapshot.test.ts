import { describe, it, expect } from 'vitest';
import {
  freezeContractSnapshot,
  computeCanonicalSha256,
  normalizeRenderedBody,
} from '@/server/contracts/merge-engine';

describe('Contracts Snapshot Freezing & Cryptographic Seal Unit Tests (AC-4)', () => {
  const sampleText = `# Wedding Photography Contract
This Agreement is between Lichtwerk Fotografie and Emma Watson.
1. Total Investment: €2.500,00
2. Date: 15. August 2026
3. German Umlauts: Übergrößen, Märchenhaft, Schöne Grüße!
`;

  const sampleMergeValues = {
    'client.name': 'Emma Watson',
    'package.total': '€2.500,00',
    'shoot.date': '15. August 2026',
    'studio.name': 'Lichtwerk Fotografie',
  };

  it('AC-4: freezeContractSnapshot generates rendered_body, merge_values_snapshot, and canonical SHA-256 hash', () => {
    const snapshot = freezeContractSnapshot(sampleText, sampleMergeValues);

    expect(snapshot.rendered_body).toBe(sampleText);
    expect(snapshot.renderedBody).toBe(sampleText);
    expect(snapshot.merge_values_snapshot).toEqual(sampleMergeValues);
    expect(snapshot.mergeValuesSnapshot).toEqual(sampleMergeValues);

    expect(typeof snapshot.canonical_body_sha256).toBe('string');
    expect(snapshot.canonical_body_sha256).toHaveLength(64);
    expect(snapshot.canonical_body_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.canonicalBodySha256).toBe(snapshot.canonical_body_sha256);
  });

  it('AC-4: ensures deterministic hash parity across Windows CRLF and Linux LF line endings', () => {
    const crlfText = sampleText.replace(/\n/g, '\r\n');
    const lfText = sampleText.replace(/\r\n/g, '\n');

    expect(crlfText).not.toBe(lfText); // Text representations differ in bytes

    const hashCrlf = computeCanonicalSha256(crlfText);
    const hashLf = computeCanonicalSha256(lfText);

    expect(hashCrlf).toBe(hashLf); // Canonical SHA-256 must match exactly
  });

  it('AC-4: ensures deterministic hash parity across Unicode NFC and NFD representations', () => {
    const textNfc = 'Schöne Grüße in München'.normalize('NFC');
    const textNfd = 'Schöne Grüße in München'.normalize('NFD');

    expect(textNfc).not.toBe(textNfd); // Code points differ in raw form

    const hashNfc = computeCanonicalSha256(textNfc);
    const hashNfd = computeCanonicalSha256(textNfd);

    expect(hashNfc).toBe(hashNfd); // Normalized canonical SHA-256 must match
  });

  it('AC-4: tamper detection: any single character modification produces a distinct SHA-256 hash', () => {
    const originalHash = computeCanonicalSha256(sampleText);

    const tamperedPrice = sampleText.replace('€2.500,00', '€2.499,00');
    const tamperedHash = computeCanonicalSha256(tamperedPrice);

    expect(tamperedHash).not.toBe(originalHash);

    const whitespaceTampered = sampleText + ' ';
    const whitespaceHash = computeCanonicalSha256(whitespaceTampered);
    expect(whitespaceHash).not.toBe(originalHash);
  });

  it('AC-4: supports calling freezeContractSnapshot with an options object', () => {
    const snapshot = freezeContractSnapshot({
      renderedBody: 'Short contract text',
      mergeValuesSnapshot: { 'client.name': 'Alice' },
    });

    expect(snapshot.rendered_body).toBe('Short contract text');
    expect(snapshot.canonical_body_sha256).toBe(computeCanonicalSha256('Short contract text'));
    expect(snapshot.merge_values_snapshot).toEqual({ 'client.name': 'Alice' });

    // With snake_case properties
    const snakeSnapshot = freezeContractSnapshot({
      rendered_body: 'Snake contract text',
      merge_values_snapshot: { 'client.city': 'Berlin' },
    });
    expect(snakeSnapshot.rendered_body).toBe('Snake contract text');
    expect(snakeSnapshot.merge_values_snapshot).toEqual({ 'client.city': 'Berlin' });

    // With empty options
    const emptySnapshot = freezeContractSnapshot({});
    expect(emptySnapshot.rendered_body).toBe('');
    expect(emptySnapshot.merge_values_snapshot).toEqual({});
  });

  it('AC-4: normalizeRenderedBody normalizes standalone carriage returns', () => {
    const crText = 'Line 1\rLine 2\r\nLine 3\n';
    const normalized = normalizeRenderedBody(crText);
    expect(normalized).toBe('Line 1\nLine 2\nLine 3\n');
  });
});
