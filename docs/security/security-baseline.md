# Security Baseline: Ownlight

This document establishes the mandatory security standards and controls for the application, based on **OWASP ASVS 5.0 (Application Security Verification Standard) Level 2** and modern Next.js/TypeScript architecture.

---

## 1. Authentication & Session Management (ASVS V6, V7)

- **Authentication Engine:** Self-hosted Better-Auth with PostgreSQL/Drizzle adapter (`better-auth@1.7.7`).
- **Owner Bootstrap:** Protected by `SETUP_TOKEN` with entropy verification (≥ 32 random bytes / 64 hex characters), constant-time comparison (`crypto.timingSafeEqual`), PostgreSQL transactional advisory lock (`pg_advisory_xact_lock(746869)`), permanently disabled with 404 once owner user exists.
- **Password Policy:** Minimum 12 characters, up to 1024 characters. Supports spaces and emoji. No composition rules. Checked offline against a bundled dictionary of 7,158 common/breached passwords (`src/server/auth/passwords/common-passwords.json`).
- **Password Hashing:** OWASP-compliant `argon2id` via `@node-rs/argon2`: `memoryCost=65536` (64 MB), `timeCost=3`, `parallelism=4`, key length 32 bytes.
- **Multi-Factor Authentication (MFA):**
  - **TOTP (RFC 6238):** 6-digit codes, 30-second step, SHA-1 HMAC, ±1 window tolerance. Secrets encrypted at rest using AES-256-GCM with keys strictly derived from `AUTH_SECRET`. Replay prevention via monotonic `last_used_step` tracking. QR codes rendered via local vector SVG with accessible manual secret alternative.
  - **WebAuthn / Passkeys:** FIDO2 passkeys for passwordless authentication using `@simplewebauthn/server` helpers and Web Crypto. Validates origin, RP ID, challenge, attestation/assertion signatures, and monotonic signature counter.
  - **Single-Use Recovery Codes:** 10 cryptographically random codes (`xxxx-xxxx`) displayed once, stored securely using scrypt with unique high-entropy salts.
  - **Step-up Re-authentication:** Sensitive operations (TOTP disable, recovery code regeneration, last passkey deletion) enforce master password confirmation within a 5-minute freshness window (`last_reauthenticated_at`).
  - **Studio Enforcement:** Studio-level mandatory MFA policy (`mfa_required`) with grace period postponement (`mfa_postponed_until` up to 7 days).
  - **Rate Limiting:** Dedicated MFA rate limits (5 failures / 15 min per account, 20 failures / 15 min per IP).
- **Session Lifecycle:** Rotated on sign-in and privilege change to prevent session fixation. Configurable idle timeout (default 7 days) and absolute timeout (30 days). Server-side invalidation (`revokeSession`) and global revocation (`signOutEverywhere` invalidates all user sessions).
- **Client Portal Access:** Expiring (≤ 15 min) single-use magic links, or scoped, revocable per-project tokens stored hashed with SHA-256.

---

## 2. Access Control & Authorization (ASVS V8)

- **Default Deny:** All endpoints, server actions, and route handlers require explicit authentication and authorization via `requireOwner()` or `requireAuth({ scopes })` unless explicitly designated in `PUBLIC_AUTH_ACTIONS` allowlist.
- **Server Action Protection & Static AST Verification:** Server actions represent public HTTP endpoints. An automated AST-based scanner (`tests/helpers/server-action-scanner.ts`) inspects every `.ts`/`.tsx` file across `src/` whose first statement is a `'use server'` or `"use server"` directive. Every exported async function or re-export must invoke `requireOwner()` or `requireAuth()` in its function body or be explicitly registered in `PUBLIC_AUTH_ACTIONS` with a documented compensating control. Helper functions (such as `assertFreshReauthentication`) must strictly live in non-`'use server'` modules with `import 'server-only'` to prevent exposing internal verification routines as callable action endpoints. Inline `'use server'` directives inside component or function bodies are prohibited.
- **Programmatic API Keys:** Scoped API tokens formatted as `ownlight_live_<32_bytes_hex>`. Displayed once to user and persisted only as SHA-256 hashes in `api_keys` table. Granular scopes (`clients:read`, `clients:write`, `projects:read`, `projects:write`, `settings:read`, `settings:write`). Route guard validates active session (all scopes) or matching key scope.
- **Object-Level Scoping:** Bare IDs from client requests are never trusted. All database reads and writes must include ownership criteria:
  ```typescript
  // Example pattern in repository layer:
  await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.studioId, studioId)));
  ```
- **Insecure Direct Object Reference (IDOR) Testing:** Every resource must have automated negative integration tests verifying that unauthorized actors receive 404/denial.

---

## 3. Input Validation & Encoding (ASVS V1, V2)

- **Validation at Boundaries:** All input to server actions and route handlers must be parsed using `zod` schemas with `.strict()`. Free-text fields have strict maximum length constraints.
- **Mass Assignment Prevention:** Data objects for database insertion must be constructed explicitly from schema-validated fields; never pass spread request bodies directly into ORM mutations.
- **Sanitisation:** Any user-controlled rich text or markdown (contract templates, questionnaires) must be sanitised with DOMPurify on both input and render.
- **Script-Free Public Endpoints (ASVS V4.1, V5.1):** The script-free submission endpoint (`POST /api/public/forms/[slug]/submissions`) enforces strict input constraints:
  - `Content-Type` must be strictly `application/x-www-form-urlencoded` (rejects other media types with `415 Unsupported Media Type`).
  - Body payload size is bounded to ≤ 16 KiB at stream level before parsing, returning `413 Payload Too Large` if exceeded.
  - Origin verification: `Origin` header must be present and exactly match an entry in `PUBLIC_FORMS_EMBED_ORIGINS` (`403 Forbidden`).
  - Open redirect prevention: `success_redirect_url` must be an HTTPS URL matching an allowlisted origin in `PUBLIC_FORMS_EMBED_ORIGINS`; unlisted origins fail validation and fall back to the hosted thanks page.
- **Anti-Automation & Rate Limiting (ASVS V2.4, V6.3, V16.3):** All authentication, credential verification, and public entry endpoints are protected by DB-backed rate limiting surviving application restarts (`rate_limits` table with sliding window).
  - **Atomic Upsert Statements:** Rate limiting operations (`consumeRateLimit`, `recordFailedAttempt`) execute as a single atomic SQL statement (`INSERT ... ON CONFLICT (key) DO UPDATE SET count = CASE WHEN expires_at <= now() THEN 1 ELSE count + 1 END, expires_at = CASE WHEN expires_at <= now() THEN $windowEnd ELSE expires_at END RETURNING count, expires_at`). This eliminates race conditions where concurrent requests could bypass thresholds.
  - **Fail-Closed Enforcement:** Rate limiter operations never fail open. On database disconnection, connection pool exhaustion, or query errors, all rate limiting routines throw `RateLimitUnavailableError`. Callers refuse the request (generic failure message, 503 for public APIs), create no session, and log the incident without leaking identifiers or raw client IP addresses.
  - **Trusted Client IP Resolution:** Client IPs are resolved strictly through trusted reverse proxy hops (`TRUSTED_PROXY_COUNT = N >= 1`) by selecting the N-th entry from the right in `X-Forwarded-For` (`L[len - N]`). `X-Real-IP` is never read by application code. If `TRUSTED_PROXY_COUNT = 0`, the header is missing, or fewer than N entries exist, the resolver returns `null`, mapped to a shared `'unknown'` bucket.
  - **Thresholds:** Sign-in throttles after 10 failed attempts per 15 min per account, and 50 failures per 15 min per IP across accounts. MFA throttles after 5 failed attempts per 15 min per account, and 25 failures per 15 min per IP. Password reset requests throttle after 5 attempts per 15 min per account and 10 per IP (counting every request). Setup bootstrap throttles after 10 attempts per 15 min per IP. Password reset execution throttles after 10 failures per 15 min per account and 15 failures per IP. Public inquiry form submissions throttle after 5 attempts per 10 min per anonymized IP bucket (`inquiry_ip:{formId}:{ipBucket}`), and 100 attempts per 1 hour per form as a flood circuit breaker (`inquiry_form:{formId}`). Proof-of-work challenge requests throttle after 30 requests per 10 min per anonymized IP bucket (`challenge_ip:{ipBucket}`) (ADR-0015 §4, §4.3).
- **First-Party Proof-of-Work Verification (ALTCHA Protocol, ASVS V2.4, ADR-0015 §4.3):**
  - **Stateless Challenge Issuance:** `GET /api/public/forms/[slug]/challenge` generates SHA-256 ALTCHA challenges with 10-minute expiry and tuned difficulty (`maxnumber = 50,000`), signed with an HMAC secret stored base64url-encoded in `studio_settings.forms_pow_hmac_key`. The HMAC secret is lazily initialized with 32 cryptographically secure random bytes on first use, never exposed in client payloads, and never logged.
  - **Timing & Expiration Guard:** Challenges embed an HMAC-protected `issued` timestamp parameter in the salt. Submissions must satisfy a minimum elapsed time of ≥ 3.0 seconds (defeating instant automated solvers) and must not exceed the 10-minute validity window.
  - **Atomic Replay Prevention:** Verified challenge signatures are stored in `inquiry_pow_replays` (`signature_hash char(64) PRIMARY KEY`, `expires_at timestamptz`) via `INSERT ... ON CONFLICT DO NOTHING`. Replayed signatures fail verification and trigger structured audit logging (`pow_replay`). Expired entries are automatically pruned by the `expired-pow-replays` retention sweep.
  - **Zero-WASM Native WebCrypto Solver:** Client-side solving uses browser-native `crypto.subtle.digest('SHA-256')`, yielding every 1,000 iterations to keep the UI responsive. No WebAssembly, `eval()`, or third-party CAPTCHA widgets are loaded, preserving strict CSP without `'wasm-unsafe-eval'`. Status is conveyed accessibly via `role="status" aria-live="polite"` (WCAG 2.2 SC 4.1.3).

---

## 4. Cryptography & Secrets (ASVS V11)

- **Secrets at Rest:** Sensitive integration credentials (OAuth tokens, CalDAV passwords, TOTP secrets) must be encrypted using AES-256-GCM with keys managed through environment variables or secure key vaults.
- **Randomness:** Use `crypto.randomBytes` or `crypto.randomUUID`. Never use `Math.random` for security tokens, session identifiers, or database IDs.
- **Document Integrity:** All electronically signed contracts must store the SHA-256 hash of the sealed PDF and the signing evidence trail.

---

## 5. Security Headers & Network Security (ASVS V3, V12)

- **HTTP Headers:** Nonce-based Content Security Policy with `strict-dynamic` (`script-src 'self' 'nonce-...' 'strict-dynamic'`, no `unsafe-inline` scripts), HTTP Strict Transport Security (`max-age=63072000; includeSubDomains; preload` in production), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`.
- **Framing & Clickjacking Protections (ASVS V3.4):**
  - **Standard Routes:** All non-embed routes enforce `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
  - **Embed Routes:** Embed routes (`/{locale}/f/[slug]/embed` and `/{locale}/f/[slug]/embed/thanks`) enforce `frame-ancestors 'self' <origins>` where `<origins>` is dynamically parsed from `PUBLIC_FORMS_EMBED_ORIGINS` (comma-separated, max 10 origins, https only except dev localhost, no wildcards). `X-Frame-Options` is omitted on embed routes to allow multi-origin allowlists.
  - **Private by Default:** If `PUBLIC_FORMS_EMBED_ORIGINS` is unset or empty, embed routes return `404 Not Found`, and script-free POST endpoints return `403 Forbidden`.
  - **Cookie-Free Isolation:** Embed routes strip and set no `Set-Cookie` headers and do not access owner session state.
- **SSRF Protection:** Outbound HTTP requests to user-configured endpoints (CalDAV servers, webhooks) must be validated using an SSRF-safe client that rejects private, link-local, loopback, and cloud metadata IP ranges.

---

## 6. Logging & Error Handling (ASVS V16)

- **PII-Safe Structured Logging:** Pino-based JSON logger with automatic redaction paths for `email`, `name`, `phone`, `address`, `password`, `token`, `authorization`, `cookie`, `ip`.
- **Audit Logging:** Append-only `audit_events` table for security-relevant and privacy-relevant operations (authentication, role changes, exports, deletions, signature events).
- **Error Messages:** User-facing responses must provide generic, localised error descriptions with correlation IDs. Detailed stack traces must never be exposed to clients.

---

## 7. Software Supply Chain & Licence Policy (ASVS V15)

- **Package Pinning:** Exact versions in `package.json` with a committed `pnpm-lock.yaml`.
- **Allowed Licences (AGPL-3.0 Compatible):**
  - MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0
  - AGPL-3.0, GPL-3.0, LGPL-3.0, MPL-2.0 (file-level)
  - Unlicense, CC0-1.0
- **Prohibited Licences:** Proprietary, Commercial, SSPL, BUSL, Commons Clause, GPL-2.0-only (without "or later" exception).
- **Automation:** GitHub Actions workflow pins by full 40-character commit SHA with version comments. Regular dependency updates via Dependabot/Renovate with a ≥ 3-day cooldown for non-security updates.
