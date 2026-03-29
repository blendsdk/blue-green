/**
 * Deploy CLI — Config resolution.
 *
 * Reads and resolves deploy-config.json, which maps GitHub secrets to
 * config files deployed on remote servers. Handles environment-specific
 * placeholder resolution (e.g., {ENV} → "ACC", {env} → "acceptance").
 *
 * Replaces the old resolve-config.js script.
 *
 * @module lib/config
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { DeployConfig, ConfigEntry, EnvironmentConfig } from '../types.ts';

/**
 * A config entry with all placeholders resolved for a specific environment.
 * Ready for use in the deploy-config command.
 */
export interface ResolvedConfigEntry {
  /** Human-readable name */
  name: string;
  /** Resolved secret key (e.g., "ACC_ENV_FILE") */
  secretKey: string;
  /** Resolved local file path (e.g., "local_data/acceptance/.env") */
  localFile: string;
  /** Remote deploy path (e.g., ".env") */
  deployPath: string;
}

// ── Config Reading ──────────────────────────────────────

/**
 * Read and parse deploy-config.json from the project root.
 *
 * Looks for the file at the specified path, or defaults to
 * "deploy-config.json" in the current working directory.
 *
 * @param configPath - Path to deploy-config.json (default: "deploy-config.json")
 * @returns Parsed config object
 * @throws Error if file not found or contains invalid JSON
 */
export function readConfig(configPath?: string): DeployConfig {
  const filePath = resolve(configPath ?? 'deploy-config.json');

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(
      `Config file not found: ${filePath}\n` +
      '  Expected deploy-config.json in the project root.\n' +
      '  Run the scaffold generator to create one.',
    );
  }

  try {
    return JSON.parse(content) as DeployConfig;
  } catch {
    throw new Error(`Invalid JSON in config file: ${filePath}`);
  }
}

// ── Config Resolution ───────────────────────────────────

/**
 * Resolve config entries for a specific environment.
 *
 * Replaces placeholders in secret keys and local file paths:
 * - `{ENV}` → uppercase prefix (e.g., "ACC", "PROD")
 * - `{env}` → lowercase environment name (e.g., "acceptance", "production")
 *
 * @param config - Parsed deploy-config.json
 * @param environment - Target environment name (e.g., "acceptance")
 * @returns Resolved config entries with all placeholders expanded
 * @throws Error if environment not found in config
 *
 * @example
 * ```ts
 * const config = readConfig();
 * const entries = resolveConfigEntries(config, 'acceptance');
 * // entries[0].secretKey === "ACC_ENV_FILE"
 * // entries[0].localFile === "local_data/acceptance/.env"
 * ```
 */
export function resolveConfigEntries(
  config: DeployConfig,
  environment: string,
): ResolvedConfigEntry[] {
  const envConfig = getEnvironmentConfig(config, environment);

  return config.configs.map((entry: ConfigEntry) => ({
    name: entry.name,
    // Replace {ENV} with the uppercase prefix (e.g., "ACC")
    secretKey: entry.secret_key.replace('{ENV}', envConfig.prefix),
    // Replace {env} with the lowercase environment name (e.g., "acceptance")
    localFile: entry.local_file.replace('{env}', environment),
    deployPath: entry.deploy_path,
  }));
}

// ── Environment Defaults ────────────────────────────────

/**
 * Get the env_defaults for a specific environment.
 *
 * These are default environment variables set in the remote .env file
 * during upload (e.g., NGINX_HTTP_PORT, DOZZLE_PORT).
 *
 * @param config - Parsed deploy-config.json
 * @param environment - Target environment name
 * @returns Record of default environment variable key-value pairs
 * @throws Error if environment not found in config
 */
export function getEnvDefaults(
  config: DeployConfig,
  environment: string,
): Record<string, string> {
  const envConfig = getEnvironmentConfig(config, environment);
  return envConfig.env_defaults;
}

// ── Internal Helpers ────────────────────────────────────

/**
 * Look up environment configuration, throwing a descriptive error if not found.
 *
 * @param config - Parsed deploy-config.json
 * @param environment - Environment name to look up
 * @returns The environment config entry
 * @throws Error with available environments listed
 */
function getEnvironmentConfig(
  config: DeployConfig,
  environment: string,
): EnvironmentConfig {
  const envConfig = config.environments[environment];
  if (!envConfig) {
    const available = Object.keys(config.environments).join(', ');
    throw new Error(
      `Unknown environment: "${environment}"\n` +
      `  Available environments: ${available}`,
    );
  }
  return envConfig;
}
