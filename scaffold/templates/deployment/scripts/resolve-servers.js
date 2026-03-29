#!/usr/bin/env node
// =============================================================================
// resolve-servers.js — Deploy Inventory Resolver
// =============================================================================
// Reads deploy-inventory.json and resolves server list for a given environment.
// Supports multiple output formats for direct consumption by shell scripts
// and GitHub Actions workflows (no inline JS or jq dependency needed).
//
// Usage:
//   node resolve-servers.js --env production [--scope all|group|tag|server] [--filter value] [--format json|count|matrix|access-mode|tsv]
//
// Output formats:
//   json (default)  — Full JSON: {"servers":[...],"count":N,"access_mode":"..."}
//   count           — Just the server count (e.g., "2")
//   matrix          — JSON array of servers for GitHub Actions matrix
//   access-mode     — Just the access mode string (e.g., "direct")
//   tsv             — Tab-separated name\thost lines for shell consumption
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse CLI arguments ─────────────────────────────────────
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, '');
  flags[key] = args[i + 1] || '';
}

const env = flags.env;
const scope = flags.scope || 'all';
const filter = flags.filter || '';
const format = flags.format || 'json';

if (!env) {
  console.error('Usage: node resolve-servers.js --env <environment> [--scope all|group|tag|server] [--filter value] [--format json|count|matrix|access-mode|tsv]');
  process.exit(1);
}

// ── Validate format flag ────────────────────────────────────
const validFormats = ['json', 'count', 'matrix', 'access-mode', 'tsv'];
if (!validFormats.includes(format)) {
  console.error(`Error: Unknown format "${format}". Valid: ${validFormats.join(', ')}`);
  process.exit(1);
}

// ── Find inventory file ─────────────────────────────────────
// Walks up from the script's directory to find deploy-inventory.json
function findInventory() {
  let dir = path.resolve(__dirname, '..', '..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'deploy-inventory.json');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  console.error('Error: deploy-inventory.json not found');
  process.exit(1);
}

// ── Read inventory ──────────────────────────────────────────
let inventory;
try {
  inventory = JSON.parse(fs.readFileSync(findInventory(), 'utf-8'));
} catch (err) {
  console.error(`Error reading inventory: ${err.message}`);
  process.exit(1);
}

// ── Look up environment ─────────────────────────────────────
const envConfig = inventory.environments[env];
if (!envConfig) {
  console.error(`Error: Unknown environment "${env}". Valid: ${Object.keys(inventory.environments).join(', ')}`);
  process.exit(1);
}

// ── Filter servers by scope ─────────────────────────────────
let servers = envConfig.servers || [];

switch (scope) {
  case 'all':
    // No filtering — use all servers in the environment
    break;
  case 'group':
    if (!filter) { console.error('Error: --filter required for scope "group"'); process.exit(1); }
    servers = servers.filter(s => s.group === filter);
    break;
  case 'tag':
    if (!filter) { console.error('Error: --filter required for scope "tag"'); process.exit(1); }
    servers = servers.filter(s => (s.tags || []).includes(filter));
    break;
  case 'server':
    if (!filter) { console.error('Error: --filter required for scope "server"'); process.exit(1); }
    servers = servers.filter(s => s.name === filter);
    break;
  default:
    console.error(`Error: Unknown scope "${scope}". Valid: all, group, tag, server`);
    process.exit(1);
}

if (servers.length === 0) {
  console.error(`Error: No servers matched env="${env}" scope="${scope}" filter="${filter}"`);
  process.exit(1);
}

// ── Output in the requested format ──────────────────────────
const serverList = servers.map(s => ({ name: s.name, host: s.host }));
const accessMode = envConfig.access || 'direct';

switch (format) {
  case 'json':
    // Full JSON output (backward compatible default)
    console.log(JSON.stringify({ servers: serverList, count: servers.length, access_mode: accessMode }));
    break;
  case 'count':
    // Just the count — for shell variable assignment
    console.log(servers.length);
    break;
  case 'matrix':
    // JSON array of servers — for GitHub Actions matrix
    console.log(JSON.stringify(serverList));
    break;
  case 'access-mode':
    // Just the access mode string
    console.log(accessMode);
    break;
  case 'tsv':
    // Tab-separated name\thost — for shell while-read loops
    serverList.forEach(s => console.log(`${s.name}\t${s.host}`));
    break;
}
