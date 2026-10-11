# ADR-0013: Production retention runner builds and executes TypeScript entry points via esbuild

- Status: Proposed
- Date: 2026-10-10
- Deciders: Architect, Maintainer (decided 2026-10-10; ADR approved in the TASK-0020 PR that commits it)

## Context

TASK-0007 introduced the declarative retention framework (`src/server/retention/policy.ts` and `src/server/retention/sweep.ts`), which registers and executes policies via TypeScript.
However, the production CLI and worker entry points (`scripts/retention-sweep.mjs` and `scripts/worker.mjs`) were implemented as standalone `.mjs` scripts with an isolated, duplicate schema and hardcoded policy queries (audit events, session, rate limits).

As a result:

1. Policies defined in TypeScript (e.g. `withdrawn-consent-proof` in TASK-0014 and `inactive-clients` in TASK-0019) never execute when `pnpm retention:sweep` or `pnpm worker` runs in production.
2. The schema definitions in `scripts/retention-sweep.mjs` are duplicated and drift from `src/server/db/schema/*`.
3. Standalone Node.js scripts cannot directly import `src/` modules due to TypeScript syntax, `@/*` path aliases, and the `'server-only'` guard module.

## Decision

1. Use **`esbuild`** (already present in the workspace lockfile via Vite/Vitest) pinned as a devDependency to build Node-executable bundles for `retention:sweep` and `worker` entry points:
   - Source entry points: `src/server/retention/cli.ts` and `src/server/retention/worker.ts`.
   - Bundle target: `node24`, format `esm`, platform `node`, externalizing native packages (`postgres`, `@node-rs/argon2`).
   - Mock/stub `'server-only'` during the CLI build step so server-only internal utilities can be used safely by the standalone Node CLI.
2. Replace the legacy `scripts/retention-sweep.mjs` and `scripts/worker.mjs` duplicates with scripts that invoke the compiled entry point (or build & run via a `pnpm run retention:build` step).
3. The unified runner imports and executes the canonical `runRetentionSweep()` engine from `src/server/retention/sweep.ts`, automatically running all policies registered in the central `getPolicies()` registry.
4. Acceptance tests verify that any policy registered via `defineRetentionPolicy` is invoked during `retention:sweep --dry-run` and live sweeps.

## Alternatives considered

- **tsx / ts-node / jiti at runtime**: Introduces runtime JIT TypeScript transpilation in production containers and workers; increases attack surface and memory overhead.
- **Maintain manual SQL scripts in `.mjs`**: High risk of schema drift and silently skipped retention policies as new features land.

## Consequences

- Direct dev dependency on `esbuild` added to `package.json` with exact pinning.
- `scripts/retention-sweep.mjs` duplicate schema removed.
- All new retention policies automatically take effect in production without modifying the CLI script.
