# Ownlight

> **your clients, your craft, your data.**  
> Autonomous open-source studio CRM for photographers and videographers.  
> Self-hosted, privacy-first, bilingual (English & German), and designed for visual professionals.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Standards: OWASP ASVS 5.0 L2](https://img.shields.io/badge/Security-ASVS%205.0%20L2-success.svg)](docs/security/security-baseline.md)
[![Privacy: GDPR & CCPA](https://img.shields.io/badge/Privacy-GDPR%20%2F%20CCPA-green.svg)](docs/privacy/privacy-by-design.md)

---

## Highlights

- **Own your data:** One instance per studio. No third-party telemetry, trackers, or external CDNs by default.
- **Privacy by design:** Automated data subject export (Art. 15/20 GDPR), erasure (Art. 17), consent tracking, and declarative retention policies with legal hold support.
- **Calm, mobile-first design:** Built for use in the studio or on location between shoots (WCAG 2.2 AA compliant).
- **Bilingual from day one:** English and German (`en`, `de`) with locale-aware date, time, and currency handling.
- **Client portal:** Seamless proposals, contracts with simple electronic signatures (SES), questionnaires, proofing galleries, and video delivery.

---

## Tech Stack

- **Framework:** Next.js (App Router, React Server Components, TypeScript strict)
- **Database & ORM:** PostgreSQL + Drizzle ORM (type-safe migrations)
- **Authentication:** Better-Auth (argon2id password hashing, TOTP & WebAuthn / Passkeys)
- **Design System:** Tailwind CSS + shadcn/ui (Radix UI primitives)
- **Internationalisation:** next-intl (bilingual English / German)
- **Testing:** Vitest (unit & integration with PostgreSQL test containers) + Playwright with axe-core (E2E & a11y)
- **Licence:** GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)

---

## Development

### Prerequisites

- **Node.js:** 24.x LTS (`node --version`)
- **Package Manager:** pnpm 10.x (`corepack enable && pnpm --version`)
- **Container Runtime:** Docker Desktop or Docker Engine with Docker Compose v2 (`docker compose version`)

### Getting Started

1. Clone the repository and install dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Configure environment:

   ```bash
   cp .env.example .env
   # Edit .env with your local secrets
   ```

3. Start local development services (PostgreSQL, Mailpit, local object storage):

   ```bash
   pnpm services:up
   ```

4. Run database migrations and seed synthetic demo data:

   ```bash
   pnpm db:migrate
   pnpm db:seed:demo
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser. Mailpit UI is available at [http://localhost:8025](http://localhost:8025).

---

## Quality & Security Scripts

All contributions must pass the deterministic quality gate:

| Command                    | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `pnpm run dev`             | Start Next.js development server                                               |
| `pnpm run build`           | Next.js production build                                                       |
| `pnpm run start`           | Start Next.js production server from build                                     |
| `pnpm run format:check`    | Prettier code style check                                                      |
| `pnpm run format:write`    | Automatically format all project files with Prettier                           |
| `pnpm run lint`            | ESLint with strict TypeScript, React Hooks, JSX A11y, and security rules       |
| `pnpm run lint:actions`    | Lint GitHub Actions workflows with actionlint, zizmor, and SHA-pinning checks  |
| `pnpm run typecheck`       | Strict TypeScript compiler check (`tsc --noEmit`)                              |
| `pnpm run check:i18n`      | Check completeness and ICU syntax of `messages/en.json` and `messages/de.json` |
| `pnpm run test:unit`       | Fast unit test execution                                                       |
| `pnpm run test:coverage`   | Unit & integration tests with mandatory ≥ 85% coverage threshold               |
| `pnpm run scan:secrets`    | Secretlint credential and key scan                                             |
| `pnpm run scan:sast`       | Static application security testing (SAST)                                     |
| `pnpm run scan:deps`       | Dependency vulnerability audit (`pnpm audit --audit-level high`)               |
| `pnpm run scan:licenses`   | AGPL-3.0 licence compatibility check                                           |
| `pnpm run test:e2e`        | Playwright E2E and automated accessibility (`@axe-core/playwright`) tests      |
| `pnpm run db:generate`     | Generate SQL migrations from schema changes with Drizzle Kit                   |
| `pnpm run db:migrate`      | Execute pending database migrations with privileged migration role             |
| `pnpm run db:check`        | Verify migration sequence and detect schema-to-migration drift                 |
| `pnpm run db:seed:demo`    | Seed deterministic synthetic demo data (with production safety guard)          |
| `pnpm run retention:build` | Build standalone retention CLI and worker bundles with esbuild                 |
| `pnpm run retention:sweep` | Run declarative retention sweep (`--dry-run` supported)                        |
| `pnpm run worker`          | Run background maintenance worker with graceful shutdown                       |
| `pnpm run services:up`     | Start local development services (PostgreSQL, Mailpit, MinIO)                  |
| `pnpm run services:down`   | Stop local development services                                                |
| `pnpm run services:reset`  | Stop services and destroy dev data volumes (after warning)                     |
| `pnpm run services:logs`   | Follow real-time logs from dev service containers                              |
| `pnpm run prepare`         | Initialize Lefthook Git hooks (pre-commit and commit-msg)                      |

---

## Documentation

- [Product Vision](docs/product/vision.md)
- [MVP Scope](docs/product/mvp-scope.md)
- [Local Development Guide](docs/operations/local-development.md)
- [GitHub Repository Settings & Security Checklist](docs/operations/github-settings.md)
- [Operations & Logging Guide](docs/operations/logging.md)
- [Bilingual Glossary](docs/product/glossary.md)
- [Architecture Decision Records (ADRs)](docs/architecture/adr/)
- [Security Baseline](docs/security/security-baseline.md)
- [Threat Model](docs/security/threat-model.md)
- [Privacy by Design & GDPR](docs/privacy/privacy-by-design.md)
- [Data Inventory](docs/privacy/data-inventory.md)
- [Data Retention Framework](docs/privacy/retention.md)
- [Invoicing & GoBD Compliance (Post-MVP)](docs/compliance/gobd-invoicing.md)

---

## Contributing

We welcome contributions! Please review [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). All commits must follow Conventional Commits and carry a Developer Certificate of Origin (DCO) sign-off (`git commit -s`).

## Security

Please report vulnerabilities confidentially according to [SECURITY.md](SECURITY.md). Do not file public GitHub issues for security vulnerabilities.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)](LICENSE).
