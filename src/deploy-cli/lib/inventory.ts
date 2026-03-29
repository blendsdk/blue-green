/**
 * Deploy CLI — Server inventory resolution.
 *
 * Reads and resolves deploy-inventory.json, which defines per-environment
 * server lists with SSH access methods (direct, jump host, deploy server).
 * Supports filtering by scope (all, group, tag, server name).
 *
 * Replaces the old resolve-servers.js script.
 *
 * @module lib/inventory
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

import type {
  DeployInventory,
  EnvironmentInventory,
  ServerEntry,
} from '../types.js';

// ── Inventory Reading ───────────────────────────────────

/**
 * Read and parse deploy-inventory.json from the project root.
 *
 * Looks for the file at the specified path, or defaults to
 * "deploy-inventory.json" in the current working directory.
 *
 * @param inventoryPath - Path to deploy-inventory.json (default: "deploy-inventory.json")
 * @returns Parsed inventory object
 * @throws Error if file not found or contains invalid JSON
 */
export function readInventory(inventoryPath?: string): DeployInventory {
  const filePath = resolve(inventoryPath ?? 'deploy-inventory.json');

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(
      `Inventory file not found: ${filePath}\n` +
      '  Expected deploy-inventory.json in the project root.\n' +
      '  Run the scaffold generator to create one.',
    );
  }

  try {
    return JSON.parse(content) as DeployInventory;
  } catch {
    throw new Error(`Invalid JSON in inventory file: ${filePath}`);
  }
}

// ── Server Resolution ───────────────────────────────────

/**
 * Resolve which servers to target based on environment, scope, and filter.
 *
 * Scope types:
 * - `all`: All servers in the environment (no filter needed)
 * - `group`: Servers matching a specific group name
 * - `tag`: Servers that have a specific tag
 * - `server`: A single server by name
 *
 * @param inventory - Parsed deploy-inventory.json
 * @param environment - Target environment name (e.g., "acceptance")
 * @param scope - Filter scope ("all", "group", "tag", "server")
 * @param filter - Filter value (required for group/tag/server scopes)
 * @returns Filtered list of servers
 * @throws Error if environment not found or filter value missing when required
 *
 * @example
 * ```ts
 * const inventory = readInventory();
 *
 * // All servers in acceptance
 * const all = resolveServers(inventory, 'acceptance', 'all');
 *
 * // Only servers in the "web" group
 * const web = resolveServers(inventory, 'production', 'group', 'web');
 *
 * // Single server by name
 * const one = resolveServers(inventory, 'production', 'server', 'prod-01');
 * ```
 */
export function resolveServers(
  inventory: DeployInventory,
  environment: string,
  scope: string,
  filter?: string,
): ServerEntry[] {
  const envInventory = getEnvironmentInventory(inventory, environment);
  const servers = envInventory.servers;

  switch (scope) {
    case 'all':
      return servers;

    case 'group': {
      if (!filter) {
        throw new Error('--filter is required when scope is "group"');
      }
      const matched = servers.filter(s => s.group === filter);
      if (matched.length === 0) {
        const groups = [...new Set(servers.map(s => s.group))].join(', ');
        throw new Error(
          `No servers found in group "${filter}" for environment "${environment}"\n` +
          `  Available groups: ${groups}`,
        );
      }
      return matched;
    }

    case 'tag': {
      if (!filter) {
        throw new Error('--filter is required when scope is "tag"');
      }
      const matched = servers.filter(s => s.tags?.includes(filter) ?? false);
      if (matched.length === 0) {
        const allTags = [...new Set(servers.flatMap(s => s.tags ?? []))].join(', ');
        throw new Error(
          `No servers found with tag "${filter}" for environment "${environment}"\n` +
          `  Available tags: ${allTags || '(none)'}`,
        );
      }
      return matched;
    }

    case 'server': {
      if (!filter) {
        throw new Error('--filter is required when scope is "server"');
      }
      const matched = servers.filter(s => s.name === filter);
      if (matched.length === 0) {
        const names = servers.map(s => s.name).join(', ');
        throw new Error(
          `Server "${filter}" not found in environment "${environment}"\n` +
          `  Available servers: ${names}`,
        );
      }
      return matched;
    }

    default:
      throw new Error(
        `Invalid scope: "${scope}"\n` +
        '  Valid scopes: all, group, tag, server',
      );
  }
}

// ── SSH Options ─────────────────────────────────────────

/**
 * Get SSH connection options for an environment.
 *
 * Returns the SSH key secret name and optional jump host secret,
 * which are used to look up the actual values from environment variables
 * (set by GitHub Actions from repository secrets).
 *
 * @param inventory - Parsed deploy-inventory.json
 * @param environment - Target environment name
 * @returns SSH key secret name and optional jump host secret name
 * @throws Error if environment not found
 *
 * @example
 * ```ts
 * const sshOpts = getSSHOptions(inventory, 'acceptance');
 * // sshOpts.keySecretName === "DEPLOY_SSH_KEY"
 * // sshOpts.jumpHostSecret === "JUMP_HOST"
 * ```
 */
export function getSSHOptions(
  inventory: DeployInventory,
  environment: string,
): { keySecretName: string; jumpHostSecret?: string } {
  const envInventory = getEnvironmentInventory(inventory, environment);

  return {
    keySecretName: inventory.ssh_key_secret,
    jumpHostSecret: envInventory.jump_host_secret,
  };
}

// ── Internal Helpers ────────────────────────────────────

/**
 * Look up environment inventory, throwing a descriptive error if not found.
 *
 * @param inventory - Parsed deploy-inventory.json
 * @param environment - Environment name to look up
 * @returns The environment inventory entry
 * @throws Error with available environments listed
 */
function getEnvironmentInventory(
  inventory: DeployInventory,
  environment: string,
): EnvironmentInventory {
  const envInventory = inventory.environments[environment];
  if (!envInventory) {
    const available = Object.keys(inventory.environments).join(', ');
    throw new Error(
      `Unknown environment: "${environment}"\n` +
      `  Available environments: ${available}`,
    );
  }
  return envInventory;
}
