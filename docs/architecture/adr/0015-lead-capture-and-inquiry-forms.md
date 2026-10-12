# ADR-0015: Lead capture through public inquiry forms (hosted, iframe, script-free POST) with first-party spam defence

- Status: Proposed (committed into `docs/architecture/adr/` by TASK-0022, its first implementing task; accepted in that PR)
- Date: 2026-10-12
- Deciders: Maintainer and Architect. On 2026-10-12 the maintainer approved every recommendation D1–D11 of the E2 blueprint (`control/ownlight/drafts/e2-blueprint.md`) as written. This ADR records the approved options.

> **Scope deferral (D1, approved 2026-10-12).** mvp-scope E2 says "conversion of a lead into a client **plus project**". E2 delivers **lead → client** only. The "plus project" part is **deferred to E3**: E3 registers a conversion step through `registerLeadConversionStep` (§8) that creates the project in the same transaction, pre-filled from the shoot details kept on the converted lead. E3 is not done until that step exists. The roadmap records the same deferral.

## Context

E2 (mvp-scope.md) asks for configurable inquiry forms. The forms must be embeddable on the studio website (iframe or script-free HTML POST) and hosted at a public URL. Spam defence must work without third parties: honeypot, rate limiting and proof-of-work. E2 also needs a lead inbox, an en/de auto-reply email, conversion of a lead into a client (plus a project), and auto-deletion of unconverted leads.

This is the **first anonymous, internet-facing write path** in Ownlight. Until now, every write has required an owner session (`threat-model.md` boundary 1 lists "Inquiry form" as a public endpoint). Relevant existing constraints:

- ADR-0002 / ADR-0003: Next.js App Router, a single studio per instance, and no third-party calls by default.
- ADR-0011: timeline events go through the registry. They store no copied PII; content is resolved at read time.
- ADR-0012: export and erasure are done by provider registries, with hard delete by default and a schema coverage test. The current `ExportSubject` / `ErasureSubject` types only know clients and contacts.
- ADR-0013: retention policies are registered in `src/server/retention/policy.ts` and run by the esbuild-built worker.
- ADR-0014: the credential vault (`ENCRYPTION_KEY`, optional) and the outbox pattern for asynchronous external I/O.
- `src/middleware.ts` sets `frame-ancestors 'none'`, `X-Frame-Options: DENY` and `form-action 'self'` on all non-API routes. `/api/*` is excluded from the middleware matcher.

The following facts came from reading the code on 2026-10-12. They shape the design and are reported as findings F1–F4 in the blueprint. Under the approved D10 they are fixed by prerequisite tasks before any E2 feature task: F3 and F4 by TASK-0022, F1 and F2 by TASK-0023. Ownlight is not deployed yet, so no out-of-band hotfix is needed.

1. **F1:** `getClientIp()` (`src/server/auth/actions.ts`, `mfa-actions.ts`) trusts a client-supplied `X-Real-IP` / the first `X-Forwarded-For` entry. A public endpoint that rate-limits per IP needs trusted resolution.
2. **F2:** `checkRateLimit()` **fails open** on database errors, and check/increment is not atomic.
3. **F3:** The background worker (`src/server/retention/worker.ts`) only runs the daily retention sweep. `processOutboxBatch()` from TASK-0021 has no production caller.
4. **F4:** `sendEmail()` (`src/server/auth/email.ts`) sends `html: html ?? text`, so plain text is also delivered as an HTML part.

## Decision

### 1. Public surface (three delivery modes, one domain service)

| Route                                             | Purpose                                                    | Notes                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /{locale}/f/{slug}`                          | Hosted form page                                           | Full page with studio name, `frame-ancestors 'none'`                                                                |
| `GET /{locale}/f/{slug}/embed`                    | Iframe variant (no app chrome)                             | CSP `frame-ancestors` = embed allowlist (§3)                                                                        |
| `GET /{locale}/f/{slug}/thanks`, `…/embed/thanks` | Confirmation pages                                         | Static, no lead data shown                                                                                          |
| Server action `submitInquiryAction`               | Submission from hosted and embed pages                     | Same-origin. Works without JavaScript (progressive enhancement) and re-renders field errors with the entered values |
| `POST /api/public/forms/{slug}/submissions`       | Script-free cross-origin HTML POST from the studio website | Route handler. Only `application/x-www-form-urlencoded`, body ≤ 16 KiB. Responds with `303` only (§2)               |
| `GET /api/public/forms/{slug}/challenge`          | Proof-of-work challenge                                    | JSON, `Cache-Control: no-store`, rate-limited (§4)                                                                  |

- `slug` is a random 10-character base32 identifier generated by the server, so unpublished forms cannot be enumerated. Unknown, draft and archived forms all return the same `404`.
- Both entry points call one service, `submitInquiry(input, ctx)`. `ctx` holds the delivery mode, the verification result and the anonymised IP bucket. All validation, anti-automation and persistence logic lives in the service, so both entry points behave identically.
- `submitInquiryAction` is added to the public-action allowlist (`src/server/auth/public-actions.ts`, TASK-0018 scanner) with its compensating controls (rate limit, honeypot, PoW, schema validation).
- `f` is added to the middleware's public path segments. Public form routes **never read the owner session** and **set no cookies**, including no next-intl locale cookie on these paths (the locale comes from the path). This keeps the TDDDG §25 "no cookie banner" property.
- Input is validated with a zod schema built from the form's field configuration (§5). Unknown keys are rejected (no mass assignment).

### 2. Cross-origin and CSRF model

- The public endpoints carry **no ambient authority**: no session, no cookies, and no action is performed for an authenticated user. Classic CSRF (riding a victim's session) therefore does not apply. The remaining risk is forged or automated submissions, which §4 handles.
- **Server action path (hosted and embed):** Next.js's built-in server-action origin check (`Origin` must equal the host) stays in force. `serverActions.allowedOrigins` is **not** widened. Inside the iframe, the document origin is the Ownlight origin, so the check passes.
- **Script-free route handler:**
  - The `Origin` header must exactly match an entry in `PUBLIC_FORMS_EMBED_ORIGINS` (§3). A missing or `null` Origin gets `403`. This is defence in depth only, because non-browser clients can forge `Origin`.
  - The form must have `accept_unverified = true`, because script-free submissions cannot carry a proof-of-work solution (§4).
  - On success (and on honeypot hits, see §4) the handler answers `303 See Other` to the form's `success_redirect_url`, or to the hosted thanks page if none is set. `success_redirect_url` must be an `https` URL whose origin is in the embed allowlist. This is validated on save and again on redirect, so there is no open redirect.
  - On validation failure it answers `303` to `/{locale}/f/{slug}?error=invalid`. That page shows an accessible error summary, and the visitor re-enters the data there. Entered values are not carried in the URL. The snippet generated by the settings UI includes `required`, `maxlength` and `type` attributes, so browser-side validation catches most errors first.
  - The route handler returns no HTML. Its responses set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, because the middleware does not cover `/api/*`.

### 3. Framing, CSP and headers

- **Embed allowlist:** an instance-level environment variable `PUBLIC_FORMS_EMBED_ORIGINS` (blueprint D8). It is a comma-separated list of at most 10 origins.
  - Scheme must be `https`. `http://localhost:<port>` is allowed only when `NODE_ENV !== 'production'`.
  - No wildcards and no paths. The list is validated at boot in `src/env.ts`.
  - When the list is empty, the embed routes return `404` and the script-free endpoint returns `403`. Only the hosted page works, which is the private-by-default setting.
- **Embed routes only:** the middleware sets `frame-ancestors 'self' <allowlist>` and omits `X-Frame-Options`, which cannot express an allowlist. Every other route keeps `frame-ancestors 'none'` and `X-Frame-Options: DENY`. A regression test asserts both.
- The rest of the CSP is unchanged (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `form-action 'self'`, `connect-src` through `default-src 'self'`). In particular, there is no `'wasm-unsafe-eval'` and no external hosts (§4.3).
- No auto-resize script is shipped for the parent page in MVP. The embed page is responsive, and the settings UI recommends an iframe height plus `title` and `loading="lazy"` attributes in the generated snippet.

### 4. Spam defence without third parties

Layers, in the order they are evaluated:

1. **Body and shape limits:** size ≤ 16 KiB, form published, schema-valid input, string length caps (§6), and `event_date` within [today, today + 5 years].
2. **Honeypot:** a visually hidden text field (`website`) with `tabindex="-1"`, `autocomplete="off"` and an `aria-hidden` container. If it is filled, the server returns the normal success response (`303` / thanks page) but **stores nothing and sends nothing**. Only a log line is written (§12).
3. **Rate limits** (constants in code, documented in `docs/security/security-baseline.md`). Bucket keys use `anonymizeIp()` (/24 for IPv4, /48 for IPv6):

   | Bucket                                       | Limit                    |
   | -------------------------------------------- | ------------------------ |
   | Submissions per IP bucket per form           | 5 per 10 min             |
   | Challenges per IP bucket                     | 30 per 10 min            |
   | Submissions per form (flood circuit breaker) | 100 per hour, then `429` |

   The limiter uses an **atomic** upsert (`INSERT … ON CONFLICT DO UPDATE … RETURNING count`) and **fails closed**, answering `503` on database errors. The client IP comes from a shared trusted-proxy resolver (`TRUSTED_PROXY_COUNT` hops of `X-Forwarded-For`, never `X-Real-IP`). TASK-0023 delivers both the resolver and the atomic, fail-closed limiter, and moves the existing sign-in, MFA, setup and password-reset limiters onto them. The public form buckets above are added by TASK-0027 and TASK-0029.

4. **Proof-of-work (ALTCHA protocol):**
   - The server issues an HMAC-signed, stateless challenge: SHA-256, expiry 10 minutes. Difficulty (`maxNumber`) is tuned so the median solve time is ≤ 1.5 s on the Playwright "Moto G4" CPU-throttled profile.
   - The server verifies the solution signature, expiry and solution. It also requires at least 3 s between challenge issue and submission.
   - Replay protection: the SHA-256 of the challenge signature goes into `inquiry_pow_replays (signature_hash char(64) PK, expires_at)` with `ON CONFLICT DO NOTHING`. Zero affected rows means a replay.
   - **Result → `verification` field:** `verified` if all checks pass. A missing, invalid, expired, too-fast or replayed solution gives `unverified`.
   - **Unverified handling:** if the form has `accept_unverified = false` (the default), unverified submissions are rejected with a localised message asking the visitor to enable JavaScript or retry. If `accept_unverified = true`, the lead is stored with an "unverified" badge, and **no auto-reply is ever sent** for it. This prevents use of the studio's mail server for backscatter (§7).

#### 4.3 Proof-of-work dependency (blueprint D5, approved option)

- **Server:** `altcha-lib`, exact-pinned. Assessment on 2026-10-12, npm `latest` = 2.6.0:
  - MIT licence (compatible with AGPL-3.0).
  - Published from GitHub Actions with npm provenance attestations.
  - Zero runtime dependencies. Framework adapters (express, fastify, hono, …) are declared as peer dependencies only.
  - Unpacked size about 320 KB.
  - Maintenance: actively released, but essentially one maintainer (bus-factor risk, accepted because it is small and replaceable).
  - The implementing task must verify three things and record them in the builder report:
    - (a) the peer dependencies are optional and the lockfile diff adds **no** framework packages;
    - (b) `pnpm audit` and the OSV scan are clean;
    - (c) the exact version is current.
  - Only challenge creation and verification are used. The library's HTTP adapters and any hosted "spam filter / Sentinel" API are **not** used. No outbound calls.
- **Client:** a first-party solver of about 100 lines (`src/app/[locale]/f/_components/pow-solver.ts`).
  - It uses WebCrypto (`crypto.subtle.digest('SHA-256')`) in an asynchronous main-thread loop that yields every 1,000 iterations. It supports **only** the algorithm the server is configured for. The builder must explicitly configure altcha-lib for a WebCrypto-available algorithm.
  - It is loaded with the existing CSP nonce. It needs no Web Worker, no WASM and no CSP change.
  - Status is announced through an `aria-live="polite"` region ("Verifying… / Verified"), and nothing needs to be clicked. The submit button stays enabled. If the solution is not ready at submit time, the solver finishes before posting, with a visible progress message.
- **Not used:** the `altcha` widget package (3.3.0, MIT). It depends on `hash-wasm` (WebAssembly would require `'wasm-unsafe-eval'`), its package is about 3.9 MB unpacked, and it brings its own UI strings and styles.
- **Key:** the HMAC key is generated on first use (`crypto.randomBytes(32)`), stored in `studio_settings.forms_pow_hmac_key` (base64url), and is never logged, exported or shown (D8). Rotation is an operator procedure: clearing the value makes the server regenerate it. This only invalidates challenges issued in the last 10 minutes.

### 5. Form configuration model

- **`inquiry_forms`:**
  - `id` (UUIDv7), `slug` (unique), `name` (≤ 100, internal), `status` (`draft|published|archived`), `default_locale` (`en|de`)
  - `fields` (jsonb, validated by zod): array of `{ key, enabled, required, order }` with `key` taken from the fixed catalogue below
  - `event_types` (jsonb): ≤ 20 entries of `{ key: slug ≤ 40, label_en ≤ 60, label_de ≤ 60 }`
  - `current_notice_version_id` (FK)
  - `auto_reply_enabled` (bool, default `true`), `accept_unverified` (bool, default `false`)
  - `success_redirect_url` (nullable, ≤ 2048), `created_at`, `updated_at`
- **Fixed field catalogue (D9):**

  | Key              | Constraints                          |
  | ---------------- | ------------------------------------ |
  | `given_name`     | Always on, required                  |
  | `email`          | Always on, required                  |
  | `family_name`    |                                      |
  | `phone`          |                                      |
  | `event_type`     | Required if the form has event types |
  | `event_date`     |                                      |
  | `event_location` | ≤ 200                                |
  | `message`        | ≤ 2,000 (D7)                         |

  Arbitrary custom fields are **not** supported, because a precise data inventory requires known fields. They are deferred to E7.

- **Notice versioning:**
  - `inquiry_form_notice_versions`: `id`, `form_id` (FK, `ON DELETE RESTRICT`), `version` (int, unique per form), `acknowledgement_text_en` and `acknowledgement_text_de` (≤ 500 each, plain text), `privacy_policy_url` (https, required), `created_at`, `created_by_actor_id`.
  - Rows are **immutable**: there is no update path, and a test asserts it. Editing the text creates a new version and moves `current_notice_version_id`.
  - Publishing requires a notice version with both languages and a privacy policy URL.
- The required checkbox is worded as an **acknowledgement of the privacy notice**, not as consent to processing (D3), because the lawful basis is Art. 6(1)(b). The default texts ship in the en/de catalogues and are editable per form.
- Forms that have leads cannot be hard-deleted. They are archived, so notice versions referenced by leads remain resolvable.
- Owner-only server actions (web session; API keys need a future `forms:*` scope and are rejected in E2) create, update, publish, unpublish and archive forms and create notice versions.

### 6. Lead data model and states

**`leads` columns:**

| Column                     | Type / constraint                                              | Notes             |
| -------------------------- | -------------------------------------------------------------- | ----------------- |
| `id`                       | UUIDv7                                                         |                   |
| `form_id`                  | FK, restrict                                                   |                   |
| `notice_version_id`        | FK, restrict                                                   |                   |
| `status`                   | `new` / `contacted` / `converted` / `archived` / `spam`        |                   |
| `verification`             | `verified` / `unverified`                                      |                   |
| `delivery_mode`            | `hosted` / `embed` / `script_free`                             |                   |
| `locale`                   | `en` / `de`                                                    |                   |
| `given_name`               | ≤ 100                                                          |                   |
| `family_name`              | ≤ 100                                                          |                   |
| `email`                    | ≤ 254                                                          |                   |
| `email_normalized`         |                                                                |                   |
| `phone`                    | ≤ 32                                                           |                   |
| `event_type_key`           | ≤ 40                                                           |                   |
| `event_date`               | date                                                           |                   |
| `event_location`           | ≤ 200                                                          |                   |
| `message`                  | text, `CHECK length ≤ 2000`                                    |                   |
| `notice_acknowledged_at`   | timestamptz                                                    |                   |
| `auto_reply_status`        | `not_applicable` / `queued` / `sent` / `failed` / `suppressed` |                   |
| `client_id`                | FK → `clients.id`, `ON DELETE CASCADE`, nullable               | Set on conversion |
| `converted_at`             | timestamptz                                                    |                   |
| `received_at`              | timestamptz                                                    |                   |
| `last_activity_at`         | timestamptz                                                    |                   |
| `created_at`, `updated_at` | timestamptz                                                    |                   |

Constraints:

- `CHECK (status = 'converted') = (client_id IS NOT NULL)`.
- `CHECK status = 'converted' OR (given_name IS NOT NULL AND email IS NOT NULL)`.
- Indexes on `(status, received_at DESC)`, `email_normalized`, `client_id` and `last_activity_at`.

**Transitions** (owner only; enforced in the service, invalid ones return `INVALID_TRANSITION`):

| From        | Allowed targets                              |
| ----------- | -------------------------------------------- |
| `new`       | `contacted`, `archived`, `spam`, `converted` |
| `contacted` | `archived`, `spam`, `converted`              |
| `archived`  | `new`                                        |
| `spam`      | `new`                                        |
| `converted` | None (terminal)                              |

- `last_activity_at` is set on creation and on every owner status change. Viewing a lead is not activity.
- **Deletion:** an owner can hard-delete any non-converted lead, one at a time or in bulk (for example "delete all spam"). This needs a web session and a confirmation dialog, but **no step-up re-authentication**: it is routine inbox hygiene on pre-relationship data with no holds, and it is audited (§11). A converted lead is only deleted together with its client (FK cascade and erasure provider).
- Lead content cannot be edited in E2.

### 7. Auto-reply email

- **Path:** a generic transactional **email outbox** (`email_outbox`).
  - Columns: `id`, `kind` (`lead_auto_reply`), `lead_id` (FK `ON DELETE CASCADE`), `status` (`PENDING|PROCESSING|FAILED`), `attempts`, `next_attempt_at`, `last_error` (sanitised, ≤ 500, no addresses), `created_at`, `updated_at`.
  - The row is written **in the same transaction** as the lead.
  - It stores **no copied PII**: the message is rendered at send time from the lead row. If the lead was deleted (cascade) or converted before sending, nothing is sent and the status becomes `suppressed`.
  - Direct SMTP inside the request is rejected (see Alternatives).
- **Worker:** the worker gains a job loop that polls registered outbox processors every 15 s, alongside the daily retention sweep.
  - TASK-0022 delivers the loop and registers the existing Google Contacts outbox processor, which fixes F3.
  - TASK-0030 adds the `email_outbox` table and registers its processor.
  - The loop keeps the existing advisory-lock leader election and graceful shutdown.
  - Backoff reuses `src/server/integrations/google/backoff.ts`, moved to a shared module by TASK-0022: 5 attempts, then `FAILED`. `FAILED` rows are purged after 30 days (§9). A successful send deletes the row.
- **When an auto-reply is sent:** only for `verified` leads on forms with `auto_reply_enabled`, and only while both caps allow it:
  - per recipient (key = SHA-256 of `email_normalized`): 1 per 24 h;
  - instance-wide: 30 per hour.

  Otherwise `auto_reply_status = suppressed`.

- **Content (D6):**
  - A fixed en/de template from the i18n catalogues, in the lead's `locale`.
  - Subject: "Your inquiry to {studioName}" / "Ihre Anfrage an {studioName}".
  - The body confirms receipt, says the studio will reply personally, and links the studio privacy policy (from the lead's notice version).
  - It contains **no lead-supplied content** (no name, no echo of the message), so an attacker cannot make the studio send attacker-chosen text to a third party.
  - No advertising content (BGH VI ZR 134/15), no tracking, **plain text only** (no HTML part).
- **Header-injection defence:**
  - The recipient is validated (zod email, ≤ 254, no CR/LF, `,` `;` `<` `>` or whitespace) and passed to nodemailer as `{ address }` without a display name.
  - The subject contains only the owner-controlled studio name, with CR/LF stripped and truncated to 100 characters.
  - `From = SMTP_FROM`. The message sets `Auto-Submitted: auto-replied` (RFC 3834) and `X-Auto-Response-Suppress: All`.
  - `sendEmail()` no longer converts `text` into an HTML part (finding 4).
- No owner notification email is sent for new leads (not in mvp-scope; see blueprint "Out of scope").

### 8. Lead → client conversion

- This is an owner web-session server action and runs in **one transaction**. It is allowed only from `new` or `contacted`.
- **Duplicate check:** the E1 duplicate detection runs on `email_normalized`. The owner then picks a mode:
  - `new_client`: creates a person client. `display_name` comes from the names, `preferred_locale = lead.locale`, and there is one primary contact with given name, family name, email and phone. Google sync stays OFF (existing default).
  - `existing_client`: links the lead to the selected client without changing its contacts.
- **Message:** if present, the message becomes a client note "Inquiry message ({form name}, {date})" containing the text verbatim. The owner can edit or delete it like any other note.
- **Timeline (ADR-0011 registry):**
  - `inquiry.received`: actor `system`, `occurred_at = received_at`, subject `lead`, **no data keys**. Event type labels can reveal special categories (for example "maternity"), so they are resolved at read time and not copied.
  - `lead.converted`: actor `owner`, subject `lead`, data keys `["mode"]`.
- **After conversion:** the lead row keeps only `form_id`, `notice_version_id`, `event_type_key`, `event_date`, `event_location`, `locale`, `received_at`, `client_id` and `converted_at`. `given_name`, `family_name`, `email`, `email_normalized`, `phone` and `message` are set to `NULL`, because that data now lives in the client, contact and note (no duplication). The retained shoot details pre-fill the E3 project.
- **Extension point (D1):** `registerLeadConversionStep({ id, run(lead, clientId, tx) })`. The registry is empty in E2. E3 registers "create project from lead", which runs in the same transaction.
- **Consent carry-over (D3, approved option):** forms collect **no marketing opt-in** in MVP, so no `consent_records` are created. The privacy-notice acknowledgement is not consent. It is kept as `notice_version_id` + `received_at` on the converted lead and shown when the `lead.converted` event is resolved.
- Audit: `lead.converted`.

### 9. Retention (ADR-0013 registry)

| Policy ID             | Target                | Rule                                                                                                                       | Action                            |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `unconverted-leads`   | `leads`               | `status IN ('new','contacted','archived') AND last_activity_at < now − LEAD_RETENTION_MONTHS` (default 12, range 1–36, D2) | Hard delete (outbox rows cascade) |
| `spam-leads`          | `leads`               | `status = 'spam' AND last_activity_at < now − 30 days`                                                                     | Hard delete                       |
| `expired-pow-replays` | `inquiry_pow_replays` | `expires_at < now`                                                                                                         | Delete                            |
| `failed-email-outbox` | `email_outbox`        | `status = 'FAILED' AND updated_at < now − 30 days`                                                                         | Delete                            |

Converted leads follow their client's lifecycle (`inactive-clients` policy and erasure). Leads have no hold provider.

### 10. Data-subject rights (ADR-0012 registries)

- `ExportSubject` and `ErasureSubject` gain a third kind, `{ kind: 'lead', leadId }`. Providers declare the subject kinds they support. Existing providers keep supporting `client` and `contact` only.
- **Lead subject:**
  - The export (JSON category `leads` plus HTML) contains:
    - the lead fields;
    - the form name and the exact notice version text the person acknowledged;
    - verification, delivery mode, auto-reply status and timestamps;
    - Art. 15 information: purpose, Art. 6(1)(b), retention per D2, recipients "the studio's email provider (auto-reply)", and source "inquiry form".
  - Access follows ADR-0012: owner web session plus step-up re-authentication within 5 minutes, and the `privacy.export.generated` audit event with `subject_kind: 'lead'`.
  - Erasure of a lead is the hard delete in §6.
- **Contact and client subjects:** a `leads` provider exports and counts the converted lead rows with `client_id` = the subject's client. Erasure deletes them through the client cascade, and the provider reports counts.
- The schema coverage test covers `leads` (it has a `client_id` column). `email_outbox` and `inquiry_pow_replays` are justified allowlist entries: the outbox cascades with the lead and stores no copied PII, and the replay table holds no personal data.
- DSAR lookups by email: the lead inbox offers a search on `email_normalized`. Leads and clients are **separate subjects**. The system never merges them automatically for export, to avoid disclosing data to the wrong person.

### 11. Audit events (allowlisted metadata, pseudonymous IDs only)

| Action                                                                        | Actor                                | Metadata keys                              |
| ----------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| `inquiry_form.created`, `.updated`, `.published`, `.unpublished`, `.archived` | owner                                | `form_id`, `changed_fields`                |
| `inquiry_form.notice_versioned`                                               | owner                                | `form_id`, `version`                       |
| `lead.received`                                                               | `system` / `public-inquiry-endpoint` | `form_id`, `verification`, `delivery_mode` |
| `lead.status_changed`                                                         | owner                                | `from`, `to`                               |
| `lead.deleted`                                                                | owner                                | `count`, `bulk`                            |
| `lead.converted`                                                              | owner                                | `client_id`, `mode`                        |
| `lead.auto_reply.sent`, `.failed`, `.suppressed`                              | `system` / `email-outbox-worker`     | `reason` (enum)                            |
| `privacy.export.generated`                                                    | owner                                | Existing keys + `subject_kind`             |

Rejected submissions (honeypot, rate limit, origin, validation, unverified on a strict form) are **not** written to the audit log, so a flood cannot exhaust the audit table. They go to structured logs only (§12). Rate-limit trips appear in logs with the bucket name.

### 12. Logging constraints

- **Allowed fields:** `request_id`, `form_id`, `lead_id`, `outcome`, `reason` (enum: `honeypot|rate_limited|origin_denied|invalid|unverified_rejected|pow_replay|body_too_large`), `verification`, `delivery_mode`, `duration_ms`, and validation error **field keys** (never values).
- **Forbidden:** names, email (raw or hashed), phone, message, event location, raw or anonymised IP, User-Agent, request body, ALTCHA payload, HMAC key.
- SMTP errors are logged as an error code or class only, because nodemailer errors can embed recipient addresses. `email_outbox.last_error` gets the same sanitisation.

### 13. Implementation map and reachability

Every worker job, route handler, server action and exported entry point introduced by these tasks is proven reachable from a production entry point (a page, API route, worker process or scheduler). The proof is a test that goes through that entry point, not a direct function call (process rule R-A, 2026-10-12).

| Task      | Delivers (ADR §)                                                                                                                        | Production entry point proving reachability                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| TASK-0022 | Worker job loop, Google outbox processor wired in, shared backoff, plain-text mail (§7; F3, F4). Commits this ADR                       | `BackgroundWorker` run cycle and the `dist/retention/worker.mjs` bundle; `requestPasswordResetAction`            |
| TASK-0023 | Trusted client-IP resolver, atomic fail-closed limiter (§4 layer 3; F1, F2)                                                             | `signInAction`, MFA, setup and password-reset actions                                                            |
| TASK-0024 | Form configuration domain and notice versions (§5)                                                                                      | None: a domain module consumed by TASK-0025, with no entry point of its own                                      |
| TASK-0025 | Owner form actions + settings UI (§5)                                                                                                   | `/{locale}/settings/inquiry-forms` pages                                                                         |
| TASK-0026 | Leads schema and domain, `lead` DSAR subject, retention policies (§6, §9, §10)                                                          | Retention sweep (CLI and worker); `POST /api/privacy/exports`                                                    |
| TASK-0027 | Public hosted form page, submission service, server action, honeypot, rate limits and no cookies (§1, §4 layers 1–3)                    | `/{locale}/f/{slug}`                                                                                             |
| TASK-0028 | Iframe embed page, per-route framing CSP allowlist, script-free cross-origin POST handler and Share & embed settings panel (§1, §2, §3) | `/{locale}/f/{slug}/embed`, `POST /api/public/forms/{slug}/submissions`, `/{locale}/settings/inquiry-forms/{id}` |
| TASK-0029 | Proof-of-work challenge, verification, replay guard, solver (§4 layer 4, §4.3)                                                          | `GET /api/public/forms/{slug}/challenge` and the hosted page                                                     |
| TASK-0030 | Email outbox + auto-reply (§7)                                                                                                          | Hosted-page submission → `BackgroundWorker` job loop → SMTP (Mailpit / test transport)                           |
| TASK-0031 | Lead inbox actions + UI (§6, §10)                                                                                                       | `/{locale}/leads` pages                                                                                          |
| TASK-0032 | Lead → client conversion, conversion-step registry, epic end-to-end journey (§8)                                                        | `/{locale}/leads/{id}`; journey from the hosted form to the client profile                                       |

## Alternatives considered

- **One cross-origin route handler for all modes (no server action):** a single code path, but no-JS and hosted validation errors could only be shown by redirecting, which loses the entered values (WCAG 3.3.1/3.3.7 UX). Rejected for the hosted and embed pages, kept for script-free POST.
- **Allowing cross-origin server actions (`serverActions.allowedOrigins`):** widens the attack surface of _every_ server action, including owner actions. Rejected.
- **Per-form embed origins stored in the database:** this would need a database lookup in middleware (edge/runtime coupling) for little benefit in a single-studio instance. Rejected in favour of the env allowlist (D8).
- **ALTCHA widget, or a fully self-implemented PoW:** see §4.3 and D5. The widget brings WASM and size; a fully self-built server verifier would mean owning security-critical verification code.
- **Third-party CAPTCHA, Akismet or ALTCHA Sentinel:** violates "no third-party calls by default". Rejected.
- **Direct SMTP in the request:** couples submission latency and success to the SMTP server, gives no retry, and creates a timing side channel. Rejected in favour of the outbox.
- **Keeping the full lead row after conversion:** duplicates PII across lead and client and complicates erasure. Rejected; the lead row is nulled.
- **A minimal project stub in E2:** would preempt the E3 design. Rejected in favour of the conversion-step hook (D1).
- **Encrypting `leads.message` with the vault:** would make `ENCRYPTION_KEY` mandatory for forms and break inbox search. At-rest protection is left to the operator's disk and database encryption (D7).
- **A marketing opt-in checkbox on forms:** German practice requires double opt-in for email marketing, and no marketing sending exists before E8. Deferred to E8 (D3).

## Consequences

- E2 introduces the first anonymous write path. The security baseline and threat model gain an "Inquiry form" section (STRIDE), updated by the E2 tasks.
- New tables: `inquiry_forms`, `inquiry_form_notice_versions`, `leads`, `email_outbox`, `inquiry_pow_replays`, plus the column `studio_settings.forms_pow_hmac_key`. Data inventory, retention and DSAR docs are updated in the same tasks.
- New dependency: `altcha-lib` (exact-pinned).
- New env vars: `PUBLIC_FORMS_EMBED_ORIGINS` (TASK-0028), `LEAD_RETENTION_MONTHS` (TASK-0026) and `TRUSTED_PROXY_COUNT` (TASK-0023).
- The worker becomes a general job runner (retention sweep plus outbox processors). This also makes the TASK-0021 Google Contacts outbox run in production.
- The conversion-step registry is the contract E3 must implement to deliver "lead → client **plus project**".
- `ExportSubject` / `ErasureSubject` widen to a union. Existing providers must declare their supported kinds (a mechanical change).

## Security & privacy impact

- **ASVS 5.0 L2:** V1 (output encoding of the re-rendered form and of the inbox), V2.1/V2.2 (schema validation), V2.4 (anti-automation: rate limits, PoW, honeypot), V3.4 (CSP `frame-ancestors`, `X-Frame-Options`), V4 (API: content-type and size limits), V8 (deny by default: owner-only inbox and forms), V12 (TLS for SMTP via existing config), V16 (logging without PII).
- **OWASP Top 10:** A01 (form slugs unguessable, no IDOR on leads), A03 (header injection, XSS through `message` in the inbox), A04 (insecure design: backscatter prevented by verified-only auto-replies with no lead content), A05 (framing restricted to embed routes), A07 (no session on public routes).
- **GDPR:**
  - Art. 5(1)(c): fixed field catalogue, lead PII nulled on conversion.
  - Art. 5(1)(e): 12-month default deletion of unconverted leads, 30 days for spam.
  - Art. 6(1)(b) for leads and the auto-reply.
  - Art. 9: incidental special-category data in `message` and in event types is mitigated by a hint text, no logging and no timeline copies (D7).
  - Art. 13: notice link and versioned acknowledgement text.
  - Art. 15/17/20: lead subject kind in the registries.
  - Art. 25: embed and unverified modes are off by default.
  - Art. 30: data inventory rows.
- **TDDDG §25:** public form routes set no cookies.
- **CCPA/CPRA:** right to know and delete via the same registries. No sale or sharing.
- No new sub-processor: the studio's own SMTP server is already the operator's processor.
