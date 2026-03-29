#!/usr/bin/env node
// =============================================================================
// resolve-config.js — Deploy Config Manifest Resolver
// =============================================================================
// Reads deploy-config.json and resolves config entries for a given environment.
//
// Usage:
//   node resolve-config.js <environment> [--format <format>] [manifest-path]
//
// Arguments:
//   environment   - Environment name (e.g., test, acceptance, production)
//   --format      - Output format (default: configs)
//                   configs      - Tab-separated config entries (secret_key, deploy_path, name)
//                   env-defaults - KEY=VALUE lines for environment defaults
//                   prefix       - Just the environment prefix (e.g., TEST, ACC, PROD)
//   manifest-path - Path to deploy-config.json (default: auto-detected)
//
// Output examples:
//   --format configs (default):
//     ACC_ENV_FILE\t.env\tDocker Environment
//     ACC_APP_CONFIG\tapp-config.json\tApp Config
//
//   --format env-defaults:
//     NGINX_HTTP_PORT=8081
//     DOZZLE_PORT=9981
//
//   --format prefix:
//     ACC
//
// Supports both old format ("test": "TEST") and new format
// ("test": { "prefix": "TEST", "env_defaults": { ... } }).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse arguments ─────────────────────────────────────────
const args = process.argv.slice(2);
let env = null;
let format = 'configs';
let manifestPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--format' && args[i + 1]) {
    format = args[++i];
  } else if (!env) {
    env = args[i];
  } else {
    manifestPath = args[i];
  }
}

if (!env) {
  console.error('Usage: node resolve-config.js <environment> [--format configs|env-defaults|prefix] [manifest-path]');
  process.exit(1);
}

if (!manifestPath) {
  manifestPath = findManifest();
}

/**
 * Find deploy-config.json by walking up from the script's directory.
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

/**
 * Resolve environment entry — supports both old and new formats.
 * Old: "test": "TEST"
 * New: "test": { "prefix": "TEST", "env_defaults": { ... } }
 * @returns {{ prefix: string, env_defaults: object }}
 */
function resolveEnvironment(envEntry) {
  if (typeof envEntry === 'string') {
    return { prefix: envEntry, env_defaults: {} };
  }
  return {
    prefix: envEntry.prefix,
    env_defaults: envEntry.env_defaults || {}
  };
}

// ── Read and parse manifest ─────────────────────────────────
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
} catch (err) {
  console.error(`Error reading manifest: ${err.message}`);
  process.exit(1);
}

// ── Look up environment ─────────────────────────────────────
const envEntry = manifest.environments[env];
if (!envEntry) {
  console.error(`Error: Unknown environment "${env}". Valid: ${Object.keys(manifest.environments).join(', ')}`);
  process.exit(1);
}

const { prefix: envPrefix, env_defaults: envDefaults } = resolveEnvironment(envEntry);

// ── Output based on format ──────────────────────────────────
switch (format) {
  case 'configs':
    for (const config of manifest.configs) {
      const secretKey = config.secret_key.replace('{ENV}', envPrefix);
      const deployPath = config.deploy_path;
      const name = config.name;
      console.log(`${secretKey}\t${deployPath}\t${name}`);
    }
    break;

  case 'env-defaults':
    for (const [key, value] of Object.entries(envDefaults)) {
      console.log(`${key}=${value}`);
    }
    break;

  case 'prefix':
    console.log(envPrefix);
    break;

  default:
    console.error(`Error: Unknown format "${format}". Valid: configs, env-defaults, prefix`);
    process.exit(1);
}
