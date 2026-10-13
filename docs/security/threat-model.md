# Threat Model: Ownlight

This threat model identifies key assets, trust boundaries, threat actors, and STRIDE mitigations for the single-studio self-hosted CRM system.

---

## 1. System Assets

| Asset ID | Asset Name                      | Description                                                                                      | Sensitivity      |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| **A-1**  | Client Personal Data            | Names, emails, phones, addresses, shoot dates, relationship history                              | High (GDPR/CCPA) |
| **A-2**  | Client Imagery & Videos         | Raw and derivative photos/videos, including family photos and photos of minors                   | Critical         |
| **A-3**  | Legal Contracts & Signatures    | Signed agreements, financial terms, simple electronic signature audit trails                     | High             |
| **A-4**  | Studio Owner Credentials        | Admin password hashes, TOTP secrets, WebAuthn credentials, session tokens                        | Critical         |
| **A-5**  | Third-Party Integration Secrets | SMTP passwords, Google OAuth refresh tokens, CalDAV credentials, S3 API keys, Lexware API tokens | Critical         |
| **A-6**  | Invoices & Accounting Records   | Financial vouchers subject to GoBD / §14 UStG, sealed in Lexware and referenced in CRM           | High             |
| **A-7**  | Scoped Agent API Tokens         | Bearer keys (`ownlight_live_...`) authorizing CLI automation and MCP agent tools                 | Critical         |

---

## 2. Threat Actors & Capabilities

1. **Unauthenticated Internet Attacker:** Accesses public inquiry forms, client portal magic links, or login pages. Attempts credential stuffing, brute force, spamming, and SSRF.
2. **Untrusted/Malicious Client:** Authorized to view their own project portal. Attempts IDOR to access other clients' galleries, contracts, or personal info.
3. **Compromised Dependency / Supply Chain:** Malicious npm package attempting code execution or secret exfiltration.
4. **Network Eavesdropper:** Snoops unencrypted traffic on local or public networks.
5. **Rogue / Misconfigured AI Agent:** Agent running runaway loops, hallucinating arguments, or attempting unauthorized bulk reads/updates over CLI or MCP interfaces.

---

## 3. Trust Boundaries

```text
[ Browser: Public / Internet ]
              │ (HTTPS / TLS 1.3)
      [ Caddy Reverse Proxy ]
              │ (Internal Docker Network)
      [ Next.js App Server ] ◄────── (stdio / HTTP) ────── [ CLI / MCP Agent Server ]
         │               │
  (PostgreSQL)      (S3 Storage / MinIO)
         │
         └──────── (HTTPS) ────────► [ Lexware Office API / Webhooks ]
```

1. **Boundary 1: Internet to Public Endpoints** (Inquiry form, health check, login, portal links)
2. **Boundary 2: Authenticated Client vs. Studio Owner** (Portal routes vs. Studio Admin routes)
3. **Boundary 3: App Server to Database & S3 Storage** (Internal private Docker network)
4. **Boundary 4: App Server to External Third Parties** (SMTP server, Google Calendar, CalDAV)
5. **Boundary 5: App Server / MCP Server to AI Agents & CLI** (stdio local process or token-authenticated SSE/HTTP)
6. **Boundary 6: App Server to Lexware Office REST API & Webhooks** (Encrypted token outbound, signed webhook inbound)

---

## 4. STRIDE Threat Analysis & Mitigations

### Spoofing

- **Threat:** Attacker spoofs studio owner, claims initial instance setup, or forges agent token.
- **Mitigation:** Setup token required for initial instance bootstrap (`SETUP_TOKEN`); argon2id password hashing; mandatory MFA (TOTP RFC 6238 with code replay prevention & WebAuthn/Passkeys with challenge expiration and signature counter verification); constant-time token comparison; SHA-256 hashed API keys with required scopes; re-authentication step-up (≤ 5 min freshness) for sensitive MFA management.

### Tampering

- **Threat:** Client, attacker, or rogue agent modifies signed contract, issued invoice, or audit records.
- **Mitigation:** Append-only audit logs with DB triggers preventing UPDATE/DELETE; SHA-256 document hashing of signed PDFs; parameterized queries via Drizzle ORM; Lexware Office immutable voucher locking; webhook HMAC signature verification.

### Repudiation

- **Threat:** Client disputes contract signature or owner disputes agent-initiated actions.
- **Mitigation:** E-signature audit trail recording document hash, timestamp, signer IP, and user agent; immutable agent audit logging with `actor_type: 'agent'`, `token_id`, `tool_name`, and arguments hash.

### Information Disclosure

- **Threat:** Attacker enumerates accounts, reads other clients' galleries (IDOR), steals credentials from logs, or LLM agent exposes client PII.
- **Mitigation:** Object-level authorization checks; generic error messages; automatic log redaction of PII; private S3 buckets with short-lived pre-signed URLs; EXIF/GPS stripping; PII masking by default in CLI/MCP outputs; strict data minimization when syncing to Lexware Office; AES-256-GCM field encryption at rest for TOTP secrets; scrypt-hashed single-use recovery codes.

### Denial of Service

- **Threat:** Attacker spams inquiry forms, uploads huge files, or an agent enters an infinite loop.
- **Mitigation:** Database-backed rate limiting per IP and per API token; honeypot fields; proof-of-work bot protection; server-side file size and magic-byte checks; streaming uploads; agent token rate limiting.

### Elevation of Privilege

- **Threat:** Client portal user escalates to studio admin privileges, or an agent with read scope executes write actions.
- **Mitigation:** Strict server-side route guards (`requireOwner()`, `requireAuth({ scopes })`); granular API token permission enforcement (e.g. `clients:read` cannot invoke `clients:write` or `lexware:sync`); separate portal token authorization context.

---

## 5. Inquiry Form (Public) STRIDE Threat Analysis

The public inquiry endpoint (`/{locale}/f/{slug}` and `submitInquiryAction`) represents the studio's first anonymous, internet-facing write path (ADR-0015).

### Spoofing & Automated Spam

- **Threat:** Automated bots submit mass spam, scrape photographer details, or attempt email header injection.
- **Mitigation:**
  - Honeypot field (`name="website"`, visually hidden, `tabindex="-1"`, `aria-hidden="true"`) returning silent success without creating leads or audit entries.
  - Two-tier atomic fail-closed rate limits per anonymized IP bucket (5 per 10 min) and per-form circuit breaker (100 per 1 hour).
  - **First-party Proof-of-Work (ALTCHA protocol, TASK-0029):**
    - Stateless SHA-256 challenges signed with a 32-byte cryptographically secure HMAC secret stored in `studio_settings.forms_pow_hmac_key`.
    - Tuned difficulty (`maxnumber = 50,000`) ensuring median solve time ≤ 1.5 s on mobile CPU while imposing non-trivial computation costs on automated abuse.
    - Native browser WebCrypto solver (`crypto.subtle.digest('SHA-256')`) yielding every 1,000 iterations to the event loop. Zero WebAssembly, zero `eval()`, preserving strict CSP without `'wasm-unsafe-eval'`.
    - Challenge endpoint (`GET /api/public/forms/[slug]/challenge`) rate-limited to 30 requests per 10 minutes per IP bucket (`challenge_ip:{ipBucket}`).
    - Minimum solve duration threshold: rejects submissions where challenge issue timestamp is less than 3 seconds before submission (`now - issued < 3000`).
    - Expiration check: challenges expire after 10 minutes.
    - Replay guard: SHA-256 hash of challenge signature atomically inserted into `inquiry_pow_replays` (`ON CONFLICT DO NOTHING`). Replays mark submission `unverified` and log structured `pow_replay`.
    - Unverified submissions rejected by default on strict forms (`accept_unverified = false`) with `UNVERIFIED_REJECTED`. Forms with `accept_unverified = true` mark lead `unverified` and suppress auto-replies.

### Tampering & Parameter Injection

- **Threat:** Attackers inject crafted parameters, disable field configurations, or attempt email CRLF injection.
- **Mitigation:** Dynamic Zod schema constructed from active form configuration with `.strict()`, rejecting unexpected keys; disabled fields rejected; email strictly prohibits `\r` and `\n` to prevent SMTP header injection; phone matching `^[+0-9 ()\-/]{3,32}$`; event date constrained to [today, today + 5 years] in the studio's configured timezone; message capped at 2,000 characters.

### Repudiation & Legal Compliance

- **Threat:** Prospective client disputes having acknowledged the studio privacy policy or lawful basis.
- **Mitigation:** Mandatory privacy notice acknowledgement checkbox recorded with the immutable `notice_version_id` and timestamp `notice_acknowledged_at`; localized Art. 13 notice explaining processing purpose under Art. 6(1)(b); plain-text versioned notice texts without HTML.

### Information Disclosure & Form Enumeration

- **Threat:** Form slug enumeration reveals unpublished or archived forms; owner session cookies or personal data leak on public pages.
- **Mitigation:** Cryptographically unguessable 10-character base32 slugs; strict 404 response parity (identical body length ±0 bytes) for draft, archived, and unknown slugs; public form routes (`/{locale}/f/**`) set no `Set-Cookie` header and never read owner session cookies; thanks page displays only static confirmation without personal data; structured logging follows ADR-0015 §12 (no names, emails, phones, messages, locations, or IPs in logs).

### Denial of Service

- **Threat:** Flooding inquiry endpoints to exhaust database storage or connection pools.
- **Mitigation:** Two-tier atomic rate limiting: 5 per 10 minutes per IP bucket (/24 IPv4, /48 IPv6), plus a 100-per-hour per-form flood circuit breaker; fail-closed behavior returning `503 UNAVAILABLE` on database errors; rejections bypass audit log persistence to prevent audit table exhaustion.

### Elevation of Privilege & Framing (Clickjacking)

- **Threat:** Framing attacks (clickjacking) embedding studio administration or client forms into malicious parent frames; cross-origin form spoofing; open redirects.
- **Mitigation:**
  - **Per-route framing CSP:** By default, all standard application routes enforce `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
  - **Scoped embed routes:** Embed routes (`/{locale}/f/[slug]/embed` and `.../embed/thanks`) allow framing only from origins explicitly defined in `PUBLIC_FORMS_EMBED_ORIGINS` via `Content-Security-Policy: ... frame-ancestors 'self' <origins>;` and deliberately omit `X-Frame-Options` (which does not support multi-origin allowlists).
  - **Private by default:** When `PUBLIC_FORMS_EMBED_ORIGINS` is unset or empty, embed endpoints return `404 Not Found`, and script-free POST endpoints return `403 Forbidden`.
  - **Cookie-free embed context:** Embed routes set no `Set-Cookie` header and do not read session cookies (ADR-0015 §2).
  - **Open redirect prevention:** `success_redirect_url` is strictly verified against `PUBLIC_FORMS_EMBED_ORIGINS` both when saving form settings and during submission redirects; unlisted origins fall back to the hosted thanks page.
  - **Script-free POST security:** `POST /api/public/forms/[slug]/submissions` enforces `Origin` allowlist matching (403 on missing/mismatched origin), `application/x-www-form-urlencoded` Content-Type check (415), 16 KiB stream body cap (413), and rejection if `accept_unverified = false` (303 to `?error=unverified`). Logging contains zero PII (ADR-0015 §12).
