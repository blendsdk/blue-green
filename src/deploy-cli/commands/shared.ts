/**
 * Deploy CLI — Shared command infrastructure.
 *
 * Provides common utilities used across all server-targeting commands:
 * - Option parsing and validation for common CLI flags
 * - Parallel server execution with batching (respects --max-parallel)
 * - SSH lifecycle management (setup → execute → cleanup)
 *
 * This avoids duplicating the same option extraction, validation, and
 * parallel execution logic in every command module.
 *
 * @module commands/shared
 */

import type {
  ParsedArgs,
  DeployOptions,
  ServerEntry,
  ServerResult,
  OperationResult,
  SSHConfig,
  SSHOptions,
} from '../types.ts';
import { readInventory, resolveServers, getSSHOptions } from '../lib/inventory.ts';
import { setupSSH, cleanupSSH } from '../lib/ssh.ts';
import { logger } from '../lib/logger.ts';

// ── Common Option Parsing ───────────────────────────────

/**
 * Parse and validate common deployment options from CLI arguments.
 *
 * Extracts --env, --scope, --filter, --deploy-path, --strategy,
 * --max-parallel, --dry-run, and --project-name from the parsed args.
 * Falls back to environment variables (DEPLOY_PATH) when flags aren't set.
 *
 * @param args - Parsed CLI arguments
 * @returns Validated deploy options
 * @throws Error if required options (--env, --deploy-path) are missing
 */
export function parseDeployOptions(args: ParsedArgs): DeployOptions {
  const environment = args.options['env'];
  if (!environment) {
    throw new Error('--env is required (e.g., --env acceptance)');
  }

  const scope = args.options['scope'] ?? 'all';
  if (!['all', 'group', 'tag', 'server'].includes(scope)) {
    throw new Error(`Invalid --scope: "${scope}". Valid: all, group, tag, server`);
  }

  // --deploy-path can be set via flag or DEPLOY_PATH env var
  const deployPath = args.options['deploy-path'] ?? process.env['DEPLOY_PATH'];
  if (!deployPath) {
    throw new Error('--deploy-path is required (e.g., --deploy-path /opt/myapp)');
  }

  const strategy = args.options['strategy'] ?? 'in-place';
  if (strategy !== 'in-place' && strategy !== 'registry') {
    throw new Error(`Invalid --strategy: "${strategy}". Valid: in-place, registry`);
  }

  const maxParallel = parseInt(args.options['max-parallel'] ?? '10', 10);
  if (isNaN(maxParallel) || maxParallel < 1) {
    throw new Error('--max-parallel must be a positive integer');
  }

  return {
    environment,
    scope: scope as DeployOptions['scope'],
    filter: args.options['filter'],
    strategy,
    maxParallel,
    dryRun: args.options['dry-run'] === 'true',
    deployPath,
    projectName: args.options['project-name'] ?? '',
  };
}

// ── Server Resolution ───────────────────────────────────

/**
 * Resolve target servers from inventory using deploy options.
 *
 * Reads deploy-inventory.json, resolves servers for the given environment
 * and scope/filter, and returns the server list along with SSH options.
 *
 * @param options - Deploy options with environment, scope, and filter
 * @returns Object containing resolved servers and SSH connection options
 */
export function resolveTargetServers(options: DeployOptions): {
  servers: ServerEntry[];
  sshOptions: { keySecretName: string; jumpHostSecret?: string };
} {
  const inventory = readInventory();
  const servers = resolveServers(
    inventory,
    options.environment,
    options.scope,
    options.filter,
  );
  const sshOptions = getSSHOptions(inventory, options.environment);

  return { servers, sshOptions };
}

// ── SSH Lifecycle ───────────────────────────────────────

/**
 * Create SSH options from environment variables using inventory SSH config.
 *
 * Maps the secret names from deploy-inventory.json to actual environment
 * variable values (set by GitHub Actions from repository secrets).
 *
 * @param sshOpts - SSH option names from inventory (key secret, jump host secret)
 * @returns SSH options with actual key content and jump host address
 */
export function buildSSHOptions(sshOpts: {
  keySecretName: string;
  jumpHostSecret?: string;
}): SSHOptions {
  // The SSH key is available as an env var named by the inventory's ssh_key_secret field
  // In practice this is almost always SSH_PRIVATE_KEY, set by GitHub Actions
  const privateKey = process.env['SSH_PRIVATE_KEY'] ?? process.env[sshOpts.keySecretName];

  // Jump host address, if the environment uses jump host access
  const jumpHost = sshOpts.jumpHostSecret
    ? process.env[sshOpts.jumpHostSecret]
    : undefined;

  return { privateKey, jumpHost };
}

/**
 * Execute a function with SSH setup and automatic cleanup.
 *
 * Sets up SSH config/key files, runs the provided function, and ensures
 * cleanup happens regardless of success or failure. This prevents
 * leaking SSH key material on disk.
 *
 * @param sshOptions - SSH connection options (key content, jump host)
 * @param fn - Async function to execute with the SSH config
 * @returns The return value of the provided function
 */
export async function withSSH<T>(
  sshOptions: SSHOptions,
  fn: (config: SSHConfig) => Promise<T>,
): Promise<T> {
  const config = setupSSH(sshOptions);
  try {
    return await fn(config);
  } finally {
    cleanupSSH(config);
  }
}

// ── Parallel Server Execution ───────────────────────────

/**
 * Execute an operation on multiple servers in parallel with batching.
 *
 * Respects the maxParallel limit by processing servers in batches.
 * For example, with maxParallel=10 and 25 servers: runs 10, waits,
 * runs 10, waits, runs 5.
 *
 * Each server operation is timed individually. The overall result
 * includes per-server results and aggregate success/fail counts.
 *
 * @param operationName - Name for logging and summary (e.g., "prepare", "switch")
 * @param servers - List of servers to operate on
 * @param operation - Async function to run on each server
 * @param maxParallel - Maximum concurrent operations (default: 10)
 * @returns Aggregated operation result with per-server details
 */
export async function executeOnServers(
  operationName: string,
  servers: ServerEntry[],
  operation: (server: ServerEntry) => Promise<ServerResult>,
  maxParallel: number = 10,
): Promise<OperationResult> {
  const overallStart = Date.now();
  const results: ServerResult[] = [];

  // Process servers in batches to respect maxParallel limit
  for (let i = 0; i < servers.length; i += maxParallel) {
    const batch = servers.slice(i, i + maxParallel);
    const batchNumber = Math.floor(i / maxParallel) + 1;
    const totalBatches = Math.ceil(servers.length / maxParallel);

    if (totalBatches > 1) {
      logger.step(
        `${batchNumber}/${totalBatches}`,
        `Processing batch of ${batch.length} server(s)`,
      );
    }

    // Run all servers in this batch concurrently
    const batchPromises = batch.map(async (server) => {
      logger.server(server.name, 'start', operationName);
      const start = Date.now();

      try {
        const result = await operation(server);
        const duration = Date.now() - start;

        if (result.success) {
          logger.server(server.name, 'ok', `${(duration / 1000).toFixed(1)}s`);
        } else {
          logger.server(server.name, 'fail', result.error ?? 'unknown error');
        }

        // Ensure duration is set from our timing
        return { ...result, duration };
      } catch (err: unknown) {
        const duration = Date.now() - start;
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.server(server.name, 'fail', errorMsg);

        return {
          server,
          success: false,
          duration,
          error: errorMsg,
        } satisfies ServerResult;
      }
    });

    // Wait for all servers in this batch to complete before starting next batch
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  const totalDuration = Date.now() - overallStart;
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  return {
    operation: operationName,
    results,
    totalDuration,
    successCount,
    failCount,
  };
}

// ── Dry Run Helper ──────────────────────────────────────

/**
 * Log what would happen in dry-run mode without executing.
 *
 * Shows the operation name, target servers, and deploy options
 * so the user can verify the command would target the right servers.
 *
 * @param operationName - Name of the operation
 * @param servers - Resolved target servers
 * @param options - Deploy options
 */
export function logDryRun(
  operationName: string,
  servers: ServerEntry[],
  options: DeployOptions,
): void {
  logger.info(`DRY RUN — ${operationName}`);
  logger.info(`Environment: ${options.environment}`);
  logger.info(`Scope: ${options.scope}${options.filter ? ` (filter: ${options.filter})` : ''}`);
  logger.info(`Strategy: ${options.strategy}`);
  logger.info(`Deploy path: ${options.deployPath}`);
  logger.info(`Max parallel: ${options.maxParallel}`);
  logger.info(`Target servers (${servers.length}):`);
  for (const server of servers) {
    logger.info(`  ${server.name} (${server.host}) [${server.group}]`);
  }
}

// ── Exit Helper ─────────────────────────────────────────

/**
 * Exit the process based on operation result.
 *
 * Prints a summary and exits with code 0 if all succeeded,
 * or code 1 if any server failed.
 *
 * @param result - Aggregated operation result
 */
export function exitWithResult(result: OperationResult): void {
  logger.summary(result);

  if (result.failCount > 0) {
    process.exit(1);
  }
}
