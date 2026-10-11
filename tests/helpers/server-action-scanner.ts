import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type ViolationType =
  | 'INLINE_USE_SERVER'
  | 'MISSING_SERVER_ONLY'
  | 'UNGUARDED_ACTION'
  | 'UNGUARDED_REEXPORT'
  | 'STALE_ALLOWLIST_ENTRY'
  | 'MISSING_ALLOWLIST_JUSTIFICATION';

export interface ScanViolation {
  file: string;
  type: ViolationType;
  actionName?: string;
  message: string;
  line?: number;
}

export interface ScannerOptions {
  rootDir?: string;
  virtualFiles?: Record<string, string>;
  allowlist?: readonly string[] | Set<string>;
  publicActionsFile?: string;
  checkAllowlistComments?: boolean;
  ignorePaths?: string[];
}

export interface ScanResult {
  discoveredFiles: string[];
  exportedActions: string[];
  violations: ScanViolation[];
}

/**
 * Checks if an AST statement is a 'use server' or "use server" directive.
 */
export function isUseServerDirective(stmt: ts.Statement | undefined): boolean {
  if (!stmt || !ts.isExpressionStatement(stmt)) return false;
  if (!ts.isStringLiteral(stmt.expression)) return false;
  return stmt.expression.text === 'use server';
}

/**
 * Checks if an AST statement is an import of 'server-only'.
 */
export function isServerOnlyImport(stmt: ts.Statement): boolean {
  if (!ts.isImportDeclaration(stmt)) return false;
  if (!ts.isStringLiteral(stmt.moduleSpecifier)) return false;
  return stmt.moduleSpecifier.text === 'server-only';
}

/**
 * Inspects a function body node to verify if requireOwner(...) or requireAuth(...) is called.
 * Nested function declarations or expressions are not traversed so that an unused inner
 * function cannot mask an unguarded action.
 */
export function bodyCallsGuard(body: ts.Node): boolean {
  let hasGuard = false;

  function visit(node: ts.Node) {
    if (hasGuard) return;

    // Do not descend into nested function or arrow function scopes
    if (
      node !== body &&
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node))
    ) {
      return;
    }

    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (
        ts.isIdentifier(expr) &&
        (expr.text === 'requireOwner' ||
          expr.text === 'requireAuth' ||
          expr.text === 'requireOwnerSession')
      ) {
        hasGuard = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(expr) &&
        (expr.name.text === 'requireOwner' ||
          expr.name.text === 'requireAuth' ||
          expr.name.text === 'requireOwnerSession')
      ) {
        hasGuard = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(body);
  return hasGuard;
}

/**
 * Traverses a source file AST to find any inline 'use server' directives inside function bodies.
 */
export function findInlineUseServerDirectives(
  sourceFile: ts.SourceFile,
  filePath: string,
): ScanViolation[] {
  const violations: ScanViolation[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      const body = node.body;
      if (body && ts.isBlock(body)) {
        for (const stmt of body.statements) {
          if (isUseServerDirective(stmt)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());
            const lineNum = String(line + 1);
            violations.push({
              file: filePath,
              type: 'INLINE_USE_SERVER',
              line: line + 1,
              message: `Inline 'use server' directive found inside function body in ${filePath}:${lineNum}. Server actions must be module-level in src/server/.`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

/**
 * Finds the PUBLIC_AUTH_ACTIONS array literal expression in an AST.
 */
function findPublicActionsArray(sourceFile: ts.SourceFile): ts.ArrayLiteralExpression | null {
  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === 'PUBLIC_AUTH_ACTIONS' &&
          decl.initializer
        ) {
          if (ts.isArrayLiteralExpression(decl.initializer)) {
            return decl.initializer;
          }
          if (
            ts.isAsExpression(decl.initializer) &&
            ts.isArrayLiteralExpression(decl.initializer.expression)
          ) {
            return decl.initializer.expression;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Checks that every entry in PUBLIC_AUTH_ACTIONS in public-actions.ts has a leading justification comment.
 */
export function checkAllowlistComments(filePath: string, content?: string): ScanViolation[] {
  const fileContent = content ?? fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    fileContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: ScanViolation[] = [];
  const arrayExpr = findPublicActionsArray(sourceFile);

  if (!arrayExpr) {
    violations.push({
      file: filePath,
      type: 'MISSING_ALLOWLIST_JUSTIFICATION',
      message: `Could not find PUBLIC_AUTH_ACTIONS array in ${filePath}.`,
    });
    return violations;
  }

  for (const element of arrayExpr.elements) {
    if (ts.isStringLiteral(element)) {
      const actionName = element.text;
      const fullStart = element.getFullStart();
      const leadingComments = ts.getLeadingCommentRanges(fileContent, fullStart);

      let hasValidJustification = false;
      if (leadingComments && leadingComments.length > 0) {
        for (const commentRange of leadingComments) {
          const commentText = fileContent.slice(commentRange.pos, commentRange.end).trim();
          const cleanText = commentText
            .replace(/^\/\/\s*/, '')
            .replace(/^\/\*\s*/, '')
            .replace(/\*\/$/, '')
            .trim();
          if (cleanText.length >= 10) {
            hasValidJustification = true;
            break;
          }
        }
      }

      if (!hasValidJustification) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(element.getStart());
        const lineNum = String(line + 1);
        violations.push({
          file: filePath,
          type: 'MISSING_ALLOWLIST_JUSTIFICATION',
          actionName,
          line: line + 1,
          message: `Allowlist entry "${actionName}" in ${filePath}:${lineNum} is missing a justification comment naming its compensating control.`,
        });
      }
    }
  }

  return violations;
}

/**
 * Resolves local file imports for re-export checks.
 */
function resolveLocalModule(
  currentFile: string,
  importSpecifier: string,
  allFiles: Record<string, string>,
): { resolvedPath: string; content: string } | null {
  const currentDir = path.dirname(currentFile);
  const candidates: string[] = [
    path.join(currentDir, importSpecifier),
    path.join(currentDir, `${importSpecifier}.ts`),
    path.join(currentDir, `${importSpecifier}.tsx`),
    path.join(currentDir, importSpecifier, 'index.ts'),
    path.join(currentDir, importSpecifier, 'index.tsx'),
  ].map((p) => p.replace(/\\/g, '/'));

  for (const candidate of candidates) {
    const candidateContent = allFiles[candidate];
    if (candidateContent !== undefined) {
      return { resolvedPath: candidate, content: candidateContent };
    }
  }

  return null;
}

/**
 * Checks whether an exported symbol in a target file is guarded.
 */
function isSymbolGuardedInSource(sourceFile: ts.SourceFile, symbolName: string): boolean {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === symbolName) {
      return stmt.body ? bodyCallsGuard(stmt.body) : false;
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === symbolName) {
          const init = decl.initializer;
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            return bodyCallsGuard(init.body);
          }
        }
      }
    }
  }
  return false;
}

/**
 * Main scanner function. Scans files under rootDir or virtualFiles.
 */
export function scanServerActions(options: ScannerOptions): ScanResult {
  const allowlistSet = new Set<string>(options.allowlist ? Array.from(options.allowlist) : []);
  const ignorePaths = options.ignorePaths ?? ['node_modules', '.next', 'dist', 'build', '.git'];

  // 1. Gather all files to inspect
  const fileMap: Record<string, string> = {};

  if (options.virtualFiles) {
    for (const [filePath, content] of Object.entries(options.virtualFiles)) {
      fileMap[filePath.replace(/\\/g, '/')] = content;
    }
  } else if (options.rootDir) {
    const root = options.rootDir;
    function collectFiles(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignorePaths.includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collectFiles(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.d.ts')
        ) {
          const relative = path.relative(root, fullPath).replace(/\\/g, '/');
          fileMap[relative] = fs.readFileSync(fullPath, 'utf8');
        }
      }
    }
    collectFiles(root);
  }

  const discoveredFiles: string[] = [];
  const exportedActions: string[] = [];
  const violations: ScanViolation[] = [];

  // Parse each file
  const parsedFiles: Record<string, ts.SourceFile> = {};
  for (const [filePath, content] of Object.entries(fileMap)) {
    const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    parsedFiles[filePath] = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );
  }

  // 2. Scan every file for inline 'use server' directives
  for (const [filePath, sourceFile] of Object.entries(parsedFiles)) {
    const inlineViolations = findInlineUseServerDirectives(sourceFile, filePath);
    violations.push(...inlineViolations);
  }

  // 3. Discover modules starting with 'use server' / "use server"
  for (const [filePath, sourceFile] of Object.entries(parsedFiles)) {
    const firstStmt = sourceFile.statements[0];
    if (isUseServerDirective(firstStmt)) {
      discoveredFiles.push(filePath);

      // Check for import 'server-only'
      const hasServerOnly = sourceFile.statements.some(isServerOnlyImport);
      if (!hasServerOnly) {
        violations.push({
          file: filePath,
          type: 'MISSING_SERVER_ONLY',
          message: `'use server' module in ${filePath} is missing "import 'server-only';".`,
        });
      }

      // Check all exports in this 'use server' module
      for (const stmt of sourceFile.statements) {
        // a) Function declarations: export async function f(...) / export function f(...)
        if (
          ts.isFunctionDeclaration(stmt) &&
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          const actionName = stmt.name?.text;
          if (!actionName) continue;
          exportedActions.push(actionName);

          if (!allowlistSet.has(actionName)) {
            const hasGuard = stmt.body ? bodyCallsGuard(stmt.body) : false;
            if (!hasGuard) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());
              const lineNum = String(line + 1);
              violations.push({
                file: filePath,
                actionName,
                type: 'UNGUARDED_ACTION',
                line: line + 1,
                message: `Server action "${actionName}" in ${filePath}:${lineNum} must invoke requireOwner() or requireAuth(), or be added to PUBLIC_AUTH_ACTIONS.`,
              });
            }
          }
        }

        // b) Variable declarations: export const f = async (...) => ... / export const f = async function(...)
        if (
          ts.isVariableStatement(stmt) &&
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              const actionName = decl.name.text;
              exportedActions.push(actionName);

              if (!allowlistSet.has(actionName)) {
                let hasGuard = false;
                const init = decl.initializer;
                if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
                  hasGuard = bodyCallsGuard(init.body);
                }
                if (!hasGuard) {
                  const { line } = sourceFile.getLineAndCharacterOfPosition(decl.getStart());
                  const lineNum = String(line + 1);
                  violations.push({
                    file: filePath,
                    actionName,
                    type: 'UNGUARDED_ACTION',
                    line: line + 1,
                    message: `Server action "${actionName}" in ${filePath}:${lineNum} must invoke requireOwner() or requireAuth(), or be added to PUBLIC_AUTH_ACTIONS.`,
                  });
                }
              }
            }
          }
        }

        // c) Export declarations: export { helper } from './x' or export { helper }
        if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
          const exportClause = stmt.exportClause;
          if (exportClause && ts.isNamedExports(exportClause)) {
            for (const specifier of exportClause.elements) {
              if (specifier.isTypeOnly) continue;
              const exportedName = specifier.name.text;
              const localName = specifier.propertyName?.text ?? specifier.name.text;
              exportedActions.push(exportedName);

              if (allowlistSet.has(exportedName)) {
                continue;
              }

              let isGuarded = false;
              if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
                // Re-export from another file
                const resolved = resolveLocalModule(filePath, stmt.moduleSpecifier.text, fileMap);
                if (resolved) {
                  const targetSourceFile =
                    parsedFiles[resolved.resolvedPath] ??
                    ts.createSourceFile(
                      resolved.resolvedPath,
                      resolved.content,
                      ts.ScriptTarget.Latest,
                      true,
                    );
                  isGuarded = isSymbolGuardedInSource(targetSourceFile, localName);
                }
              } else {
                // Re-export from same file
                isGuarded = isSymbolGuardedInSource(sourceFile, localName);
              }

              if (!isGuarded) {
                const { line } = sourceFile.getLineAndCharacterOfPosition(specifier.getStart());
                const lineNum = String(line + 1);
                violations.push({
                  file: filePath,
                  actionName: exportedName,
                  type: 'UNGUARDED_REEXPORT',
                  line: line + 1,
                  message: `Re-exported symbol "${exportedName}" in ${filePath}:${lineNum} is not a guarded action or allowlisted.`,
                });
              }
            }
          }
        }
      }
    }
  }

  // 4. Stale allowlist entries check: allowlist entry not exported by any 'use server' module
  const exportedActionsSet = new Set<string>(exportedActions);
  for (const allowlistedName of allowlistSet) {
    if (!exportedActionsSet.has(allowlistedName)) {
      violations.push({
        file: options.publicActionsFile ?? 'allowlist',
        actionName: allowlistedName,
        type: 'STALE_ALLOWLIST_ENTRY',
        message: `Allowlist entry "${allowlistedName}" is not exported by any 'use server' module.`,
      });
    }
  }

  // 5. Allowlist justification comments check (if requested or publicActionsFile provided)
  if (options.checkAllowlistComments && options.publicActionsFile) {
    const commentViolations = checkAllowlistComments(
      options.publicActionsFile,
      fileMap[options.publicActionsFile.replace(/\\/g, '/')],
    );
    violations.push(...commentViolations);
  }

  return {
    discoveredFiles,
    exportedActions,
    violations,
  };
}
