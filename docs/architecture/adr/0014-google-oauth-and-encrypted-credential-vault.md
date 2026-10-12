# ADR-0014: Google OAuth 2.0 Integration and Encrypted Credential Vault

- Status: Accepted
- Date: 2026-10-11
- Deciders: Maintainer, Architect (incorporating human maintainer decisions approved on 2026-10-11)

## Context

Ownlight is a self-hosted single-studio CRM for independent photographers and videographers (ADR-0003). ADR-0008 approved modular integration with Google Workspace, starting with opt-in Google Contacts sync in Epic E1 (for caller ID on mobile shoot days) and expanding to Google Calendar and Google Meet in Epic E4. Additionally, ADR-0007 planned encrypted credential storage for Lexware Office accounting.

To enable secure, auditable, and privacy-compliant external integrations without multi-tenant security verification overhead, we need a unified architectural pattern covering:

1. **Encrypted Credential Storage:** Protecting sensitive third-party OAuth refresh tokens and API secrets at rest.
2. **OAuth 2.0 Architecture:** Authorization flow, scope boundaries, token lifecycle, and credential revocation for Google Workspace.
3. **Sub-Processor & Data Transfer Compliance:** Adhering to GDPR Art. 28, Art. 44–46, and Art. 6(1)(f) for personal data transferred to Google.
4. **Integration Architecture & UI:** Managing integration state, settings UI, and decoupled downstream workers.

On 2026-10-11, the human maintainer approved seven foundational architectural decisions:

1. **OAuth Client Model:** Studio-owned Google Cloud project via `.env` (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`).
2. **Dev & Test Strategy:** Local fake HTTP servers for CI/tests; optional manual production testing uses a maintainer-owned Google Cloud client.
3. **Sync Scope:** Strict per-client opt-in toggle on client profile (default OFF).
4. **Data Minimization:** Given name, family name, phone number(s) only.
5. **Lawful Basis & Transfer Documentation:** Art. 6(1)(f) legitimate interest + EU-US Data Privacy Framework / SCCs; add `docs/privacy/sub-processors.md`.
6. **Credential Encryption:** Dedicated `ENCRYPTION_KEY` env var (32-byte hex/base64) with HKDF per-purpose subkeys (`aes-256-gcm`).
7. **Disconnect Behavior:** Prompt owner whether to delete synced Google contacts (default: delete).

## Decision

We establish the following architectural standards across Ownlight:

### 1. Encrypted Credential Vault (`src/server/crypto/vault.ts`)

1. **Master Key (`ENCRYPTION_KEY`):**
   - Integrations storing secrets at rest require a dedicated environment variable `ENCRYPTION_KEY`.
   - Must be 32 bytes (256 bits), encoded as 64 hex characters or 44 base64 characters.
   - Validated at application boot (`src/server/env.ts`) if any integration is enabled or configured.
   - Decoupled from `AUTH_SECRET`: `AUTH_SECRET` is reserved for Better-Auth sessions and cookie signing; TOTP secrets maintain their existing derivation for stability.
2. **Subkey Derivation via HKDF (RFC 5869):**
   - Secrets are never encrypted directly with the master `ENCRYPTION_KEY`.
   - Each domain/integration derives a dedicated 256-bit encryption key using HKDF-SHA256:
     - `salt`: fixed domain string `ownlight:vault:v1`
     - `info`: purpose-specific identifier (e.g. `ownlight:vault:google_oauth`, `ownlight:vault:lexware_api`)
     - `length`: 32 bytes (256 bits)
   - Cross-purpose key reuse is cryptographically prevented.
3. **Authenticated Encryption (AES-256-GCM):**
   - Cipher: `aes-256-gcm`.
   - Initialization Vector (IV): 12 bytes (96 bits) generated with `crypto.randomBytes(12)` per operation. IV reuse is forbidden.
   - Authentication Tag: 16 bytes (128 bits) produced and verified by GCM mode.
   - Serialized Ciphertext Format: `v1:{iv_b64url}:{tag_b64url}:{ciphertext_b64url}`.
   - Tamper Detection: Any modification to ciphertext, IV, tag, or derivation purpose throws an authentication error; decryption fails closed.

### 2. Studio-Owned Google OAuth 2.0 PKCE Flow

1. **OAuth Client Topology:**
   - The studio owner registers an OAuth 2.0 Client in their own Google Cloud project (type "Web application").
   - Configured via environment variables: `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
   - Avoids multi-tenant OAuth app verification, Google CASA Tier-2/3 audits, and third-party SaaS proxy infrastructure.
2. **Authorization Code Grant with PKCE (RFC 7636):**
   - Uses `code_challenge_method: S256`.
   - A high-entropy code verifier is generated and stored in a short-lived, encrypted, session-bound server state.
   - State parameter: 32 bytes cryptographically secure random token, single-use, bound to the owner's session with a 10-minute expiration.
3. **Per-Feature Least-Privilege Scopes:**
   - Scopes are requested per feature, not globally.
   - Google Contacts requests only: `https://www.googleapis.com/auth/contacts`.
   - Calendar and Meet scopes (Epic E4) will be requested separately if and when configured.
4. **Token Storage (`google_oauth_tokens` table):**
   - Schema: `id` (UUIDv7), `provider` (`'google'`), `encrypted_refresh_token` (text), `access_token` (text, encrypted or short-lived memory cache), `access_token_expires_at` (timestamptz), `scope` (text), `created_at`, `updated_at`.
   - Refresh token is stored encrypted via the credential vault using purpose `ownlight:vault:google_oauth`. Plaintext tokens never hit the database, disk, or logs.
5. **Disconnect & Revocation:**
   - Disconnecting calls Google's revocation endpoint (`https://oauth2.googleapis.com/revoke?token=...`).
   - The token record in `google_oauth_tokens` is deleted.
   - Disconnect dialog prompts the owner whether to delete synced Google contacts (default: delete).
   - Audit event `integration.google.disconnected` is recorded.

### 3. Sub-Processor & GDPR Data Transfer Compliance

1. **Sub-Processor Status:**
   - Google LLC acts as a processor/sub-processor under GDPR Art. 28 when processing contacts or calendar events on behalf of the studio.
   - Studio owners are instructed to execute Google's Data Processing Amendment (DPA) and Standard Contractual Clauses (SCCs) via their Google Workspace / Cloud console.
   - Ownlight documents this relationship in `projects/ownlight/docs/privacy/sub-processors.md`.
2. **Lawful Basis:**
   - Art. 6(1)(f) legitimate interest: identifying incoming client phone calls on the photographer's mobile device during shoot days.
   - Balancing test: mitigated by strict per-client opt-in (default OFF) and data minimization.
3. **Data Minimization (GDPR Art. 5(1)(c)):**
   - Fields transmitted to Google People API: Given name, family name, and phone number(s) only.
   - Emails, postal addresses, private shoot notes, questionnaires, contracts, and financial records are strictly excluded from Google Contacts sync.
4. **Third-Country Transfers (GDPR Art. 44–46):**
   - Covered by Google's certification under the EU-US Data Privacy Framework (DPF) and the accepted SCCs.
5. **Data Subject Rights Integration:**
   - DSAR Export (TASK-0015): The export provider lists Google LLC as an external recipient when contact sync is enabled for the subject.
   - Erasure (TASK-0016): Erasing a contact or client deletes the corresponding Google contact via the People API and removes the link table entry.

### 4. Integration Registry and Settings Pattern

1. **Integration State Machine:**
   - `unconfigured`: Required environment variables (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `ENCRYPTION_KEY`) are missing. The settings UI displays step-by-step setup documentation.
   - `disconnected`: Environment variables present, but no OAuth connection exists. Displays "Connect" button.
   - `connected`: Active OAuth token stored. Displays connection date, authorized scopes, and "Disconnect" action.
   - `error`: Token refresh failure or API permission error. Displays clear, localized status without leaking raw HTTP payloads.
2. **Settings UI:**
   - Located at `/settings/integrations/google` within the studio settings shell.
   - WCAG 2.2 AA compliant, accessible keyboard dialog for disconnect confirmation, full en/de i18n catalogues.
3. **Network Boundary:**
   - Outbound HTTPS traffic is restricted to Google's official endpoints (`accounts.google.com`, `oauth2.googleapis.com`, `people.googleapis.com`).
   - Zero Google client-side scripts, tracking pixels, or iframe embeds in the web application.

## Alternatives considered

- **Unified Single Secret (`AUTH_SECRET` for all encryption):**
  - _Rejected:_ Blurring session signing secrets with long-term data/credential encryption keys violates least privilege and complicates rotation. A dedicated `ENCRYPTION_KEY` isolates credential risks.
- **Multi-Tenant Google OAuth App (Hosted by Ownlight project):**
  - _Rejected:_ Conflicts with ADR-0003 (self-hosted single-studio). Would require annual CASA security audits, Google brand verification, and a centralized proxy service that sees all studios' OAuth tokens.
- **Global Automatic Sync for All Contacts:**
  - _Rejected:_ Violates GDPR privacy by default (Art. 25). Photographers often have personal or business contacts who should not be sent to Google. Per-client opt-in protects client privacy.
- **Full Contact Profile Sync (including emails, addresses, notes):**
  - _Rejected:_ Unnecessary for caller ID during shoots; creates an oversized third-party privacy footprint.

## Consequences

- The credential vault (`src/server/crypto/vault.ts`) becomes the foundation for all future external service integrations (Google Calendar in E4, Lexware Office in E12).
- Operators wishing to use external integrations must supply `ENCRYPTION_KEY` in addition to provider credentials.
- Test suites must use local mock/fake OAuth and People API HTTP servers to guarantee deterministic CI without real Google accounts or outbound internet access.

## Security & privacy impact

- **OWASP ASVS 5.0 V10 (OAuth & OIDC):** Implements PKCE (`S256`), high-entropy session-bound state, strict redirect URI validation, and token revocation.
- **OWASP ASVS 5.0 V11 (Cryptography):** AES-256-GCM authenticated encryption, unique random IVs per message, and HKDF subkey derivation.
- **GDPR Art. 5, 25, 28, 44–46:** Privacy by default (opt-in sync), data minimization (names + phones only), sub-processor DPA documentation, and erasure synchronization.
- **Audit Trails:** Secure audit events (`integration.google.connected`, `integration.google.disconnected`) without leaking secrets, tokens, or personal phone numbers.
