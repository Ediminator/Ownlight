import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

vi.mock('server-only', () => ({}));
import { isUseServerDirective, isServerOnlyImport } from '../helpers/server-action-scanner';

describe('AC-15: Erasure service isolation and server action scanner assertions', () => {
  it('AC-15: eraseSubject and planErasure are not exported from any "use server" module', () => {
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
          expect(stmt.name?.text, `File ${relativePath} must not export eraseSubject`).not.toBe(
            'eraseSubject',
          );
          expect(stmt.name?.text, `File ${relativePath} must not export planErasure`).not.toBe(
            'planErasure',
          );
        }

        // Exported variable declaration
        if (
          ts.isVariableStatement(stmt) &&
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              expect(decl.name.text, `File ${relativePath} must not export eraseSubject`).not.toBe(
                'eraseSubject',
              );
              expect(decl.name.text, `File ${relativePath} must not export planErasure`).not.toBe(
                'planErasure',
              );
            }
          }
        }

        // Export declaration (re-export): export { ... }
        if (
          ts.isExportDeclaration(stmt) &&
          stmt.exportClause &&
          ts.isNamedExports(stmt.exportClause)
        ) {
          for (const elem of stmt.exportClause.elements) {
            expect(elem.name.text, `File ${relativePath} must not re-export eraseSubject`).not.toBe(
              'eraseSubject',
            );
            expect(elem.name.text, `File ${relativePath} must not re-export planErasure`).not.toBe(
              'planErasure',
            );
          }
        }
      }
    }
  });

  it('AC-15: service.ts is a server-only module without "use server"', () => {
    const servicePath = path.resolve(process.cwd(), 'src/server/privacy/erasure/service.ts');
    const content = fs.readFileSync(servicePath, 'utf8');

    expect(content).toContain("import 'server-only';");
    expect(content.includes("'use server'")).toBe(false);
    expect(content.includes('"use server"')).toBe(false);
  });

  it('AC-15: actions.ts is a "use server" module with "import \'server-only\';"', () => {
    const actionsPath = path.resolve(process.cwd(), 'src/server/privacy/erasure/actions.ts');
    const content = fs.readFileSync(actionsPath, 'utf8');
    const sf = ts.createSourceFile(actionsPath, content, ts.ScriptTarget.Latest, true);

    expect(isUseServerDirective(sf.statements[0])).toBe(true);
    expect(sf.statements.some((s) => isServerOnlyImport(s))).toBe(true);
  });
});
