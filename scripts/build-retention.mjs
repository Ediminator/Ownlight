#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'src');

/**
 * esbuild plugin to stub 'server-only' package with a no-op export.
 * Allows server-side internal modules to be bundled into standalone CLI / worker without Next.js runtime checks.
 */
const serverOnlyStubPlugin = {
  name: 'server-only-stub',
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => {
      return { path: 'server-only', namespace: 'server-only-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'server-only-stub' }, () => {
      return {
        contents: 'export default {};',
        loader: 'js',
      };
    });
  },
};

/**
 * esbuild plugin to resolve @/* path aliases to ./src/*
 */
const pathAliasPlugin = {
  name: 'path-alias',
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => {
      const relPath = args.path.slice(2);
      const target = path.resolve(srcDir, relPath);
      return build.resolve(target, {
        resolveDir: srcDir,
        kind: args.kind,
      });
    });
  },
};

export async function buildRetention() {
  const result = await esbuild.build({
    entryPoints: [
      { out: 'cli', in: path.resolve(srcDir, 'server/retention/cli.ts') },
      { out: 'worker', in: path.resolve(srcDir, 'server/retention/worker.ts') },
    ],
    outdir: path.resolve(rootDir, 'dist/retention'),
    outExtension: { '.js': '.mjs' },
    target: 'node24',
    format: 'esm',
    platform: 'node',
    bundle: true,
    packages: 'external',
    sourcemap: true,
    plugins: [serverOnlyStubPlugin, pathAliasPlugin],
  });

  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  buildRetention()
    .then(() => {
      console.log('✅ Retention runner bundled successfully to dist/retention/{cli,worker}.mjs');
    })
    .catch((err) => {
      console.error('❌ Retention build failed:', err);
      process.exit(1);
    });
}
