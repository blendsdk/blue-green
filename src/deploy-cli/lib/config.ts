/**
 * Deploy CLI — Config resolution.
 *
 * Reads and resolves deploy-config.json, which maps GitHub secrets to
 * config files deployed on remote servers. Handles environment-specific
 * placeholder resolution via the uniform ${VAR} resolver
 * (e.g., ${ENV} → "ACC", ${env} → "acceptance").
 *
 * Replaces the old resolve-config.js script.
 *
 * @module lib/config
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { DeployConfig, ConfigEntry, EnvironmentConfig } from '../types.ts';
import { resolvePlaceholders } from './env-resolve.ts';

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
 * Every string value in each entry supports `${VAR}` substitution via the
 * uniform resolver. The resolution context is the real process environment
 * merged with two injected, environment-aware values (AR #2):
 * - `${ENV}` → uppercase prefix (e.g., "ACC", "PROD")
 * - `${env}` → lowercase environment name (e.g., "acceptance", "production")
 *
 * A referenced variable that is missing or empty is a hard error (AR #8).
 *
 * @param config - Parsed deploy-config.json
 * @param environment - Target environment name (e.g., "acceptance")
 * @returns Resolved config entries with all placeholders expanded
 * @throws Error if environment not found, or a referenced variable is unset
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
  // ${ENV} → uppercase prefix; ${env} → environment name; plus all real env vars.
  const context = configContext(envConfig.prefix, environment);

  return config.configs.map((entry: ConfigEntry) => {
    // Resolve the whole entry recursively so every string value supports ${VAR}.
    // deploy_path is now also resolvable — a harmless superset of the previous
    // pass-through behavior (FR-4).
    const resolved = resolvePlaceholders(entry, context);
    return {
      name: resolved.name,
      secretKey: resolved.secret_key,
      localFile: resolved.local_file,
      deployPath: resolved.deploy_path,
    };
  });
}

/**
 * Build the `${VAR}` resolution context for a config environment.
 *
 * The context is the real process environment plus the two injected,
 * environment-aware values used by deploy-config.json (AR #2).
 *
 * @param prefix - Uppercase environment prefix (e.g., "ACC") → `${ENV}`
 * @param environment - Lowercase environment name → `${env}`
 * @returns Map of variable name → value for the resolver
 */
function configContext(
  prefix: string,
  environment: string,
): Record<string, string | undefined> {
  return { ...process.env, ENV: prefix, env: environment };
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
