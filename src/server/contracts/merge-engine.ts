import { createHash } from 'node:crypto';

/**
 * All officially supported and allowlisted merge tokens across 6 namespaces (ADR-0019 §2.1).
 */
export const ALLOWLISTED_MERGE_TOKENS = [
  // client namespace
  'client.name',
  'client.company',
  'client.email',
  'client.phone',
  'client.address',
  'client.city',
  'client.postal_code',
  'client.country',

  // project namespace
  'project.title',
  'project.type',
  'project.price',
  'project.currency',
  'project.notes',

  // shoot namespace
  'shoot.date',
  'shoot.time',
  'shoot.timezone',
  'shoot.location',
  'shoot.address',

  // package namespace
  'package.name',
  'package.deliverables',
  'package.total',
  'package.subtotal',
  'package.tax',
  'package.addons',

  // studio namespace
  'studio.name',
  'studio.owner_name',
  'studio.email',
  'studio.phone',
  'studio.address',
  'studio.tax_number',
  'studio.vat_id',

  // contract namespace
  'contract.number',
  'contract.issue_date',
  'contract.valid_until',
] as const;

export type AllowlistedMergeToken = (typeof ALLOWLISTED_MERGE_TOKENS)[number];
export const ALLOWLISTED_TOKENS_SET = new Set<string>(ALLOWLISTED_MERGE_TOKENS);

/**
 * Structured input for contract merge resolution.
 */
export interface ContractMergeData {
  client?: {
    name?: string | null;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    postal_code?: string | null;
    country?: string | null;
  };
  project?: {
    title?: string | null;
    type?: string | null;
    price?: string | null;
    currency?: string | null;
    notes?: string | null;
  };
  shoot?: {
    date?: string | null;
    time?: string | null;
    timezone?: string | null;
    location?: string | null;
    address?: string | null;
  };
  package?: {
    name?: string | null;
    deliverables?: string | null;
    total?: string | null;
    subtotal?: string | null;
    tax?: string | null;
    addons?: string | null;
  };
  studio?: {
    name?: string | null;
    owner_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    tax_number?: string | null;
    vat_id?: string | null;
  };
  contract?: {
    number?: string | null;
    issue_date?: string | null;
    valid_until?: string | null;
  };
  [key: string]: unknown;
}

export interface ResolveMergeFieldsOptions {
  /** If true, unmapped tokens are left in place as {{token}} rather than safely cleared. Default: false */
  keepUnmappedTokens?: boolean;
}

export interface ResolveMergeFieldsResult {
  renderedText: string;
  evaluatedValues: Record<string, string>;
  unmappedTokens: string[];
}

/**
 * Strict HTML special character escaping (prevents XSS when interpolating client data).
 */
export function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Strips ASCII control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F)
 * preserving standard whitespace: \t (0x09), \n (0x0A), and \r (0x0D).
 */
export function stripControlChars(str: string): string {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitizes an interpolated merge field: removes control chars and HTML-escapes.
 */
export function sanitizeMergeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return escapeHtml(stripControlChars(value));
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return escapeHtml(stripControlChars(String(value)));
  }
  return '';
}

/**
 * Flattens nested ContractMergeData or flat key-value pairs into a normalized Map.
 */
function extractFlatValues(
  data?: ContractMergeData | Record<string, unknown> | null,
): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!data || typeof data !== 'object') {
    return map;
  }

  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
        map.set(`${key}.${subKey}`, subVal);
      }
    } else {
      map.set(key, val);
    }
  }

  return map;
}

/**
 * Regex matching any merge token formatted as {{ ... }}.
 */
const TOKEN_MATCH_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Deterministically resolves allowlisted merge tokens on template text (AC-3).
 * Dynamic values are strictly sanitized and HTML-escaped.
 * Unmapped tokens are cleanly reported and safely cleared (unless keepUnmappedTokens is true).
 */
export function resolveContractMergeFields(
  templateText: string,
  mergeData?: ContractMergeData | Record<string, unknown> | null,
  options?: ResolveMergeFieldsOptions,
): ResolveMergeFieldsResult {
  const flatData = extractFlatValues(mergeData);
  const evaluatedValues: Record<string, string> = {};
  const unmappedSet = new Set<string>();

  const keepUnmapped = options?.keepUnmappedTokens ?? false;

  const renderedText = templateText.replace(TOKEN_MATCH_REGEX, (fullMatch, rawToken: string) => {
    const token = rawToken.trim();

    if (!ALLOWLISTED_TOKENS_SET.has(token)) {
      unmappedSet.add(token);
      return keepUnmapped ? fullMatch : '';
    }

    if (flatData.has(token)) {
      const rawVal = flatData.get(token);
      if (rawVal === null || rawVal === undefined || rawVal === '') {
        evaluatedValues[token] = '';
        return '';
      }
      const sanitized = sanitizeMergeValue(rawVal);
      evaluatedValues[token] = sanitized;
      return sanitized;
    }

    // Allowlisted token is present in template but no value was provided
    unmappedSet.add(token);
    evaluatedValues[token] = '';
    return keepUnmapped ? fullMatch : '';
  });

  return {
    renderedText,
    evaluatedValues,
    unmappedTokens: Array.from(unmappedSet),
  };
}

/**
 * Normalizes rendered contract body into canonical UTF-8:
 * Unicode NFC normalization and LF line-ending normalization.
 */
export function normalizeRenderedBody(body: string): string {
  return body.normalize('NFC').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Computes deterministic SHA-256 seal from canonical UTF-8 body.
 */
export function computeCanonicalSha256(body: string): string {
  const normalized = normalizeRenderedBody(body);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export interface ContractSnapshot {
  rendered_body: string;
  renderedBody: string;
  merge_values_snapshot: Record<string, unknown>;
  mergeValuesSnapshot: Record<string, unknown>;
  canonical_body_sha256: string;
  canonicalBodySha256: string;
}

/**
 * Freezes a contract snapshot into an immutable record with canonical SHA-256 hash (AC-4).
 */
export function freezeContractSnapshot(
  renderedBodyOrOptions:
    | string
    | {
        renderedBody?: string;
        rendered_body?: string;
        mergeValuesSnapshot?: Record<string, unknown>;
        merge_values_snapshot?: Record<string, unknown>;
      },
  mergeValuesSnapshotArg?: Record<string, unknown>,
): ContractSnapshot {
  let body: string;
  let values: Record<string, unknown>;

  if (typeof renderedBodyOrOptions === 'string') {
    body = renderedBodyOrOptions;
    values = mergeValuesSnapshotArg ?? {};
  } else {
    body = renderedBodyOrOptions.renderedBody ?? renderedBodyOrOptions.rendered_body ?? '';
    values =
      renderedBodyOrOptions.mergeValuesSnapshot ??
      renderedBodyOrOptions.merge_values_snapshot ??
      mergeValuesSnapshotArg ??
      {};
  }

  const hash = computeCanonicalSha256(body);

  return {
    rendered_body: body,
    renderedBody: body,
    merge_values_snapshot: values,
    mergeValuesSnapshot: values,
    canonical_body_sha256: hash,
    canonicalBodySha256: hash,
  };
}
