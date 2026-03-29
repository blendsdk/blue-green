#!/usr/bin/env node
// =============================================================================
// resolve-config.js — Deploy Config Manifest Resolver
// =============================================================================
// Reads deploy-config.json and resolves config entries for a given environment.
// Outputs tab-separated lines for bash consumption (no jq dependency).
//
// Usage:
//   node resolve-config.js <environment> [manifest-path]
//
// Arguments:
//   environment   - Environment name (e.g., test, acceptance, production)
//   manifest-path - Path to deploy-config.json (default: auto-detected)
//
// Output format (tab-separated, one line per config entry):
//   <secret_key>\t<deploy_path>\t<name>
//
// Example output:
//   ACC_ENV_FILE\t.env\tDocker Environment
//   ACC_APP_CONFIG\tapp-config.json\tApp Config
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse arguments ─────────────────────────────────────────
const env = process.argv[2];
const manifestPath = process.argv[3] || findManifest();

if (!env) {
  console.error('Usage: node resolve-config.js <environment> [manifest-path]');
  console.error('  environment: test, acceptance, production');
  process.exit(1);
}

/**
 * Find deploy-config.json by walking up from the script's directory.
 * Checks: script dir parent, grandparent, etc.
 * @returns {string} Path to deploy-config.json
 */
function findManifest() {
  let dir = path.resolve(__dirname, '..', '..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'deploy-config.json');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  console.error('Error: deploy-config.json not found');
  process.exit(1);
}

// ── Read and parse manifest ─────────────────────────────────
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
} catch (err) {
  console.error(`Error reading manifest: ${err.message}`);
  process.exit(1);
}

// ── Look up environment prefix (e.g., "acceptance" → "ACC") ─
const envPrefix = manifest.environments[env];
if (!envPrefix) {
  console.error(`Error: Unknown environment "${env}". Valid: ${Object.keys(manifest.environments).join(', ')}`);
  process.exit(1);
}

// ── Resolve each config entry and output tab-separated lines ─
for (const config of manifest.configs) {
  const secretKey = config.secret_key.replace('{ENV}', envPrefix);
  const deployPath = config.deploy_path;
  const name = config.name;

  // Output: secret_key<TAB>deploy_path<TAB>name
  console.log(`${secretKey}\t${deployPath}\t${name}`);
}
