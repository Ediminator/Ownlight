import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-7: Synology Staging and Operations Documentation', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const docsPath = path.resolve(rootDir, 'docs/operations/synology-deployment.md');
  const deployScriptPath = path.resolve(rootDir, 'scripts/deploy-synology.sh');

  it('AC-7: synology-deployment.md exists and documents staging target /volume1/agent_scratch/staging/ownlight/', () => {
    expect(fs.existsSync(docsPath)).toBe(true);
    const content = fs.readFileSync(docsPath, 'utf8');

    expect(content).toContain('/volume1/agent_scratch/staging/ownlight/');
    expect(content).toContain('3030');
  });

  it('AC-7: documents initial setup token redemption, container updates, and backup/restore', () => {
    const content = fs.readFileSync(docsPath, 'utf8');

    expect(content).toMatch(/\/en\/setup/);
    expect(content).toMatch(/SETUP_TOKEN/);
    expect(content).toMatch(/docker compose.*pull/);
    expect(content).toMatch(/backup/i);
    expect(content).toMatch(/restore/i);
  });

  it('AC-7: deploy-synology.sh exists with shell execution and automated compose operations', () => {
    expect(fs.existsSync(deployScriptPath)).toBe(true);
    const content = fs.readFileSync(deployScriptPath, 'utf8');

    expect(content.startsWith('#!/bin/sh') || content.startsWith('#!/bin/bash')).toBe(true);
    expect(content).toMatch(/COMPOSE_FILE=.*compose\.synology\.yml/);
    expect(content).toMatch(/docker compose.*\$COMPOSE_FILE/);
  });
});
