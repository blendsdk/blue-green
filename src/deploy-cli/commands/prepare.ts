/**
 * Deploy CLI — Prepare command.
 *
 * Runs `blue-green-prepare` on all resolved servers in parallel.
 * This is the first phase of a two-phase deployment:
 *
 * 1. **prepare** — Build/pull image, start new color, wait for health checks
 * 2. switch — Swap Nginx upstream to new color
 *
 * The prepare phase does NOT switch traffic — it only ensures the new
 * version is running and healthy on all servers. This allows the switch
 * phase to be fast and atomic (just an Nginx config swap + reload).
 *
 * In a coordinated multi-server deploy, all servers must complete prepare
 * before any server switches (see deploy.ts for the full workflow).
 *
 * @module commands/prepare
 */

import type { ParsedArgs, SSHConfig, ServerEntry, ServerResult } from '../types.ts';
import { sshExec } from '../lib/ssh.ts';
import { logger } from '../lib/logger.ts';
import {
  parseDeployOptions,
  resolveTargetServers,
  buildSSHOptions,
  withSSH,
  executeOnServers,
  logDryRun,
  exitWithResult,
} from './shared.ts';

// ── Prepare Command Handler ─────────────────────────────

/**
 * Run blue-green-prepare on all resolved servers.
 *
 * Orchestrates the first phase of a blue-green deployment:
 * 1. Resolve target servers from inventory
 * 2. Setup SSH configuration
 * 3. Run `remote-ops.sh blue-green-prepare` on all servers in parallel
 * 4. Report per-server results
 * 5. Exit 0 if all succeeded, exit 1 if any failed
 *
 * The prepare command passes the deployment strategy (in-place or registry)
 * to remote-ops.sh so it knows whether to build locally or pull from registry.
 *
 * @param args - Parsed CLI arguments
 */
export async function prepareCommand(args: ParsedArgs): Promise<void> {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);

  if (servers.length === 0) {
    logger.info('No servers matched — nothing to prepare');
    return;
  }

  if (options.dryRun) {
    logDryRun('prepare', servers, options);
    return;
  }

  logger.info(`Preparing ${servers.length} server(s) in ${options.environment}`);
  logger.info(`Strategy: ${options.strategy}`);

  const sshOpts = buildSSHOptions(sshOptions);
  const scriptsDir = `${options.deployPath}/scripts`;

  // Build the remote command — pass strategy so remote-ops.sh knows how to prepare
  const remoteCommand = `bash ${scriptsDir}/remote-ops.sh blue-green-prepare`;

  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      'prepare',
      servers,
      (server) => runPrepare(sshConfig, server, remoteCommand),
      options.maxParallel,
    );
  });

  exitWithResult(result);
}

// ── Per-Server Prepare Logic ────────────────────────────

/**
 * Run blue-green-prepare on a single server.
 *
 * This is typically the slowest phase of deployment because it involves:
 * - Building Docker images (in-place) or pulling from registry
 * - Starting the new color's containers
 * - Waiting for health checks to pass
 *
 * A generous timeout (10 minutes) is used because image builds can be slow.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param remoteCommand - Full remote command string
 * @returns Server result indicating success or failure
 */
async function runPrepare(
  sshConfig: SSHConfig,
  server: ServerEntry,
  remoteCommand: string,
): Promise<ServerResult> {
  try {
    const result = await sshExec(sshConfig, server.host, remoteCommand, {
      pipe: true, // Stream build output live for CI visibility
      timeout: 600_000, // 10 minutes — builds can be slow
    });

    const success = result.exitCode === 0;

    return {
      server,
      success,
      duration: 0, // Set by executeOnServers wrapper
      output: result.stdout.trim() || undefined,
      error: success ? undefined : `prepare failed (exit ${result.exitCode})`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg,
    };
  }
}
