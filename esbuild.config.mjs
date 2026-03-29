/**
 * esbuild configuration for Deploy CLI.
 *
 * Bundles the TypeScript source into a single JavaScript file with zero
 * runtime dependencies. The output is placed directly into the scaffold
 * templates directory so it's included in generated projects.
 *
 * Output: scaffold/templates/deployment/scripts/deploy-cli.js
 *
 * Design decisions:
 * - Platform: node — uses Node.js built-in modules only
 * - Format: esm — matches package.json "type": "module"
 * - Bundle: true — all imports resolved into a single file
 * - Minify: false — keep readable for debugging in CI logs
 * - Sourcemap: false — single file deployment, no source maps needed
 * - Banner: shebang — makes the file directly executable with node
 */

import { build } from 'esbuild';

/** Output path — directly in scaffold templates for inclusion in generated projects */
const OUTPUT_PATH = 'scaffold/templates/deployment/scripts/deploy-cli.js';

try {
  const result = await build({
    // Entry point — the CLI main module
    entryPoints: ['src/deploy-cli/index.ts'],

    // Output configuration
    outfile: OUTPUT_PATH,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',

    // Add shebang for direct execution
    banner: {
      js: '#!/usr/bin/env node',
    },

    // Keep readable — no minification for CI log debugging
    minify: false,

    // No source maps needed — single file deployment
    sourcemap: false,

    // Mark Node.js built-in modules as external (they're available at runtime)
    // esbuild handles this automatically for platform: 'node', but being explicit
    external: [
      'child_process',
      'fs',
      'path',
      'os',
      'crypto',
      'util',
      'events',
      'stream',
      'net',
    ],

    // Log level for build output
    logLevel: 'info',
  });

  // Report success with any warnings
  if (result.warnings.length > 0) {
    console.warn(`⚠️  Build completed with ${result.warnings.length} warning(s)`);
  } else {
    console.log(`✅ Deploy CLI built → ${OUTPUT_PATH}`);
  }
} catch (error) {
  console.error('❌ Build failed:', error);
  process.exit(1);
}
