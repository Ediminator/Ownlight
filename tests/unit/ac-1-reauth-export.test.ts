import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

vi.mock('server-only', () => ({}));
import { isUseServerDirective, isServerOnlyImport } from '../helpers/server-action-scanner';
import * as reauthModule from '@/server/auth/reauth';

describe('AC-1: Re-authentication helper export isolation', () => {
  it('AC-1: assertFreshReauthentication is not exported from any "use server" module and is exported from reauth.ts', () => {
    const srcDir = path.resolve(process.cwd(), 'src');
    const useServerModules: string[] = [];

    function findUseServerModules(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findUseServerModules(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.d.ts')
        ) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const sf = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);
          if (isUseServerDirective(sf.statements[0])) {
            useServerModules.push(fullPath);
          }
        }
      }
    }

    findUseServerModules(srcDir);
    expect(useServerModules.length).toBeGreaterThan(0);

    // Verify that NO 'use server' module exports or re-exports assertFreshReauthentication
    for (const filePath of useServerModules) {
      const content = fs.readFileSync(filePath, 'utf8');
      const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
      const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');

      for (const stmt of sf.statements) {
        // Exported function declaration
        if (
          ts.isFunctionDeclaration(stmt) &&
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          expect(
            stmt.name?.text,
            `File ${relativePath} must not export assertFreshReauthentication`,
          ).not.toBe('assertFreshReauthentication');
        }

        // Exported variable declaration
        if (
          ts.isVariableStatement(stmt) &&
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              expect(
                decl.name.text,
                `File ${relativePath} must not export assertFreshReauthentication`,
              ).not.toBe('assertFreshReauthentication');
            }
          }
        }

        // Export declaration (re-exports)
        if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
          if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
            for (const elem of stmt.exportClause.elements) {
              expect(
                elem.name.text,
                `File ${relativePath} must not re-export assertFreshReauthentication`,
              ).not.toBe('assertFreshReauthentication');
            }
          }
        }
      }
    }

    // Verify reauth.ts exists and its AST properties
    const reauthPath = path.resolve(process.cwd(), 'src/server/auth/reauth.ts');
    expect(fs.existsSync(reauthPath)).toBe(true);

    const reauthContent = fs.readFileSync(reauthPath, 'utf8');
    const reauthSf = ts.createSourceFile(reauthPath, reauthContent, ts.ScriptTarget.Latest, true);

    // reauth.ts has NO 'use server' directive
    const hasUseServer = reauthSf.statements.some(isUseServerDirective);
    expect(hasUseServer, 'reauth.ts must NOT have a "use server" directive').toBe(false);
    expect(reauthContent.includes("'use server'")).toBe(false);
    expect(reauthContent.includes('"use server"')).toBe(false);

    // reauth.ts imports 'server-only'
    const hasServerOnly = reauthSf.statements.some(isServerOnlyImport);
    expect(hasServerOnly, 'reauth.ts must import "server-only"').toBe(true);

    // assertFreshReauthentication is exported from reauth.ts
    expect(typeof reauthModule.assertFreshReauthentication).toBe('function');
  });

  it('assertFreshReauthentication validates session freshness and handles branches', async () => {
    const dummyDb = {} as unknown as import('@/server/db/client').DbClient;
    const baseUser: import('@/server/db/schema/auth').User = {
      id: 'u-123',
      email: 'u123@example.com',
      name: 'User 123',
      emailVerified: true,
      image: null,
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const baseSession: import('@/server/db/schema/auth').Session = {
      id: 's-123',
      userId: 'u-123',
      token: 'valid-token',
      expiresAt: new Date(Date.now() + 86400000),
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastReauthenticatedAt: new Date(Date.now() - 60 * 1000),
    };

    // 1. Session token override succeeds when session is fresh
    vi.spyOn(await import('@/server/auth/session'), 'verifySession').mockResolvedValueOnce({
      user: baseUser,
      session: baseSession,
    });
    await expect(
      reauthModule.assertFreshReauthentication('u-123', dummyDb, 'valid-token'),
    ).resolves.toBeUndefined();

    // 2. Throws when user id does not match
    vi.spyOn(await import('@/server/auth/session'), 'verifySession').mockResolvedValueOnce({
      user: { ...baseUser, id: 'other-user' },
      session: baseSession,
    });
    await expect(
      reauthModule.assertFreshReauthentication('u-123', dummyDb, 'valid-token'),
    ).rejects.toThrow('REAUTH_REQUIRED: Invalid session.');

    // 3. Throws when session is older than 5 minutes
    vi.spyOn(await import('@/server/auth/session'), 'verifySession').mockResolvedValueOnce({
      user: baseUser,
      session: {
        ...baseSession,
        lastReauthenticatedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    await expect(
      reauthModule.assertFreshReauthentication('u-123', dummyDb, 'valid-token'),
    ).rejects.toThrow('REAUTH_REQUIRED: Re-authentication required for sensitive operation.');

    // 4. Throws when no session cookie is found and no override is provided
    await expect(reauthModule.assertFreshReauthentication('u-123', dummyDb)).rejects.toThrow(
      'REAUTH_REQUIRED: No active session cookie found.',
    );
  });
});
