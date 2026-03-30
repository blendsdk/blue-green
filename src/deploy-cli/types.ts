/**
 * Deploy CLI — Shared type definitions.
 *
 * All interfaces and types used across the CLI commands and library modules.
 * These types model the JSON configuration files (deploy-config.json,
 * deploy-inventory.json) and the runtime options/results of CLI operations.
 *
 * @module types
 */

// ── Configuration Types ─────────────────────────────────
// Models the deploy-config.json file structure used for
// deploying config files (secrets) to remote servers.

/**
 * Root structure of deploy-config.json.
 * Defines which config files to deploy and per-environment settings.
 */
export interface DeployConfig {
  /** List of config file entries to deploy */
  configs: ConfigEntry[];
  /** Per-environment configuration (test, acceptance, production) */
  environments: Record<string, EnvironmentConfig>;
}

/**
 * A single config file entry in deploy-config.json.
 * Maps a GitHub secret to a file on the remote server.
 */
export interface ConfigEntry {
  /** Human-readable name for this config entry */
  name: string;
  /** Secret key pattern — "{ENV}" is replaced with the environment prefix (e.g., "ACC") */
  secret_key: string;
  /** Local file path pattern — "{env}" is replaced with the environment name */
  local_file: string;
  /** Remote path relative to deploy-path where the file is placed */
  deploy_path: string;
}

/**
 * Environment-specific settings in deploy-config.json.
 * Each environment (test, acceptance, production) has its own prefix and defaults.
 */
export interface EnvironmentConfig {
  /** Uppercase prefix used in secret key resolution (e.g., "TEST", "ACC", "PROD") */
  prefix: string;
  /** Default environment variables to set in .env on the remote server */
  env_defaults: Record<string, string>;
}

// ── Inventory Types ─────────────────────────────────────
// Models the deploy-inventory.json file structure used for
// resolving which servers to deploy to and how to connect.

/**
 * Root structure of deploy-inventory.json.
 * Defines SSH key configuration and per-environment server inventories.
 */
export interface DeployInventory {
  /** Name of the GitHub secret containing the SSH private key */
  ssh_key_secret: string;
  /** Per-environment server inventory */
  environments: Record<string, EnvironmentInventory>;
}

/**
 * Inventory for a single environment — defines access method and server list.
 */
export interface EnvironmentInventory {
  /** How to reach servers: direct SSH, via jump host, or via deploy server */
  access: 'direct' | 'jump_host' | 'deploy_server';
  /** GitHub secret name for jump host address (when access is 'jump_host') */
  jump_host_secret?: string;
  /** GitHub secret name for deploy server address (when access is 'deploy_server') */
  deploy_server_secret?: string;
  /** List of servers in this environment */
  servers: ServerEntry[];
}

/**
 * A single server in the inventory.
 * Servers are organized by groups and can have optional tags for filtering.
 */
export interface ServerEntry {
  /** Human-readable server name (e.g., "acc-01") */
  name: string;
  /** SSH connection string (e.g., "deploy@10.0.0.3") */
  host: string;
  /** Logical group for scoping deploys (e.g., "web", "api") */
  group: string;
  /** Optional tags for fine-grained filtering (e.g., ["primary", "eu-west"]) */
  tags?: string[];
}

// ── Deployment Types ────────────────────────────────────
// Runtime options for deployment operations.

/** Deployment strategy — how the Docker image reaches the server */
export type DeployStrategy = 'in-place' | 'registry';

/**
 * Options for deploy operations (prepare, switch, deploy, upload, operate).
 * Populated from CLI arguments and environment variables.
 */
export interface DeployOptions {
  /** Target environment name (e.g., "test", "acceptance", "production") */
  environment: string;
  /** Server scope — which servers to target */
  scope: 'all' | 'group' | 'tag' | 'server';
  /** Filter value when scope is group/tag/server (e.g., group name or server name) */
  filter?: string;
  /** Deployment strategy (in-place build or registry pull) */
  strategy: DeployStrategy;
  /** Maximum number of servers to operate on simultaneously */
  maxParallel: number;
  /** If true, show what would happen without executing */
  dryRun: boolean;
  /** Remote base path for the deployment (e.g., "/opt/scaffoldapp") */
  deployPath: string;
  /** Project name used for COMPOSE_PROJECT_NAME */
  projectName: string;
}

/**
 * Options for the registry command (build + push Docker image on CI).
 */
export interface RegistryOptions {
  /** Target platform for Docker build (e.g., "linux/amd64", "linux/arm64") */
  platform?: string;
  /** Docker registry URL (e.g., "registry.internal:5000") */
  registryUrl: string;
  /** Docker image name (e.g., "scaffoldapp") */
  imageName: string;
  /** Image tag — typically a timestamp (e.g., "20260329220000") */
  imageTag: string;
}

// ── SSH Types ───────────────────────────────────────────
// Configuration for SSH connections to remote servers.

/**
 * Paths to SSH configuration files created during setup.
 * These are temporary files cleaned up after the operation.
 */
export interface SSHConfig {
  /** Path to the generated SSH config file (used with ssh -F) */
  configPath: string;
  /** Path to the written SSH private key file (if created from env var) */
  keyPath?: string;
}

/**
 * SSH connection options — typically populated from environment variables
 * set by GitHub Actions secrets.
 */
export interface SSHOptions {
  /** SSH private key content (from SSH_PRIVATE_KEY env var) */
  privateKey?: string;
  /** Jump host address for proxied connections (from JUMP_HOST env var) */
  jumpHost?: string;
}

// ── Result Types ────────────────────────────────────────
// Operation outcomes for reporting and exit code determination.

/**
 * Result of an operation on a single server.
 * Used to track success/failure per server in multi-server deployments.
 */
export interface ServerResult {
  /** The server this result is for */
  server: ServerEntry;
  /** Whether the operation succeeded */
  success: boolean;
  /** Duration of the operation in milliseconds */
  duration: number;
  /** Error message if the operation failed */
  error?: string;
  /** Captured stdout/stderr output */
  output?: string;
}

/**
 * Aggregated result of an operation across all targeted servers.
 * Used by the logger to print a summary and determine exit code.
 */
export interface OperationResult {
  /** Name of the operation (e.g., "prepare", "switch", "health-check") */
  operation: string;
  /** Per-server results */
  results: ServerResult[];
  /** Total wall-clock duration in milliseconds */
  totalDuration: number;
  /** Number of servers that succeeded */
  successCount: number;
  /** Number of servers that failed */
  failCount: number;
}

// ── CLI Types ───────────────────────────────────────────
// Types for argument parsing and command dispatch.

/**
 * Parsed CLI arguments — the output of the argument parser.
 * Maps flag names (without "--" prefix) to their string values.
 * Boolean flags (like --dry-run) are stored with value "true".
 */
export interface ParsedArgs {
  /** The command name (first positional argument) */
  command: string;
  /** Named options (--flag value pairs) */
  options: Record<string, string>;
  /** Extra positional arguments after "--" separator */
  extraArgs: string[];
}

/**
 * A CLI command handler function.
 * Each command module exports a function matching this signature.
 */
export type CommandHandler = (args: ParsedArgs) => Promise<void>;

/**
 * Command definition for the dispatcher registry.
 */
export interface CommandDefinition {
  /** Command name as used on the CLI */
  name: string;
  /** Short description shown in --help output */
  description: string;
  /** The handler function to execute */
  handler: CommandHandler;
}
