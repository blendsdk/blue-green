/**
 * Deploy CLI — Deploy command.
 *
 * Full coordinated two-phase deployment: prepare all → barrier → switch all.
 *
 * This is the primary deployment command that ensures zero-downtime
 * blue-green deployments across multiple servers. The two-phase approach
 * guarantees that ALL servers have the new version running and healthy
 * before ANY server switches traffic.
 *
 * Workflow:
 * 1. Run `blue-green-prepare` on all servers in parallel
 * 2. **Barrier** — If any server failed prepare, STOP (don't switch anything)
 * 3. Run `blue-green-switch` on all servers in parallel
 * 4. Report combined results
 *
 * This prevents the partial-deploy problem where some servers serve v2
 * while others still serve v1 — all servers switch together.
 *
 * @module commands/deploy
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

// ── Deploy Command Handler ──────────────────────────────

/**
 * Run a full coordinated blue-green deployment.
 *
 * Executes a two-phase deploy with a barrier between phases:
 *
 * **Phase 1 (prepare):** Build/pull, start new color, health check — in parallel
 * **Barrier:** If ANY server failed prepare → abort, do NOT switch
 * **Phase 2 (switch):** Swap Nginx upstream on all servers — in parallel
 *
 * This ensures atomic multi-server deployments where all servers
 * switch to the new version at the same time (after verification).
 *
 * @param args - Parsed CLI arguments
 */
export async function deployCommand(args: ParsedArgs): Promise<void> {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);

  if (servers.length === 0) {
    logger.info('No servers matched — nothing to deploy');
    return;
  }

  if (options.dryRun) {
    logDryRun('deploy (prepare → switch)', servers, options);
    return;
  }

  logger.info(`Deploying to ${servers.length} server(s) in ${options.environment}`);
  logger.info(`Strategy: ${options.strategy}`);

  const sshOpts = buildSSHOptions(sshOptions);
  const scriptsDir = `${options.deployPath}/scripts`;

  await withSSH(sshOpts, async (sshConfig) => {
    // ── Phase 1: Prepare ────────────────────────────────
    logger.step('1/2', 'PREPARE — Building and starting new version on all servers');

    const prepareCommand = `bash ${scriptsDir}/remote-ops.sh blue-green-prepare`;

    const prepareResult = await executeOnServers(
      'prepare',
      servers,
      (server) => runRemoteOp(sshConfig, server, prepareCommand, 600_000),
      options.maxParallel,
    );

    logger.summary(prepareResult);

    // ── Barrier ─────────────────────────────────────────
    // If ANY server failed prepare, abort the entire deployment.
    // Do NOT switch traffic to partially-prepared servers.
    if (prepareResult.failCount > 0) {
      logger.error('BARRIER — Prepare failed on some servers. Aborting deploy.');
      logger.error('No servers will be switched. Fix failures and retry.');

      const failedServers = prepareResult.results
        .filter(r => !r.success)
        .map(r => r.server.name)
        .join(', ');
      logger.error(`Failed servers: ${failedServers}`);

      process.exit(1);
    }

    logger.info('All servers prepared successfully — proceeding to switch');

    // ── Phase 2: Switch ─────────────────────────────────
    logger.step('2/2', 'SWITCH — Swapping traffic to new version on all servers');

    const switchCmd = `bash ${scriptsDir}/remote-ops.sh blue-green-switch`;

    const switchResult = await executeOnServers(
      'switch',
      servers,
      (server) => runRemoteOp(sshConfig, server, switchCmd, 120_000),
      options.maxParallel,
    );

    // Show the combined deploy result
    // Combine timing from both phases for total duration
    const combinedResult = {
      ...switchResult,
      operation: 'deploy',
      totalDuration: prepareResult.totalDuration + switchResult.totalDuration,
    };

    exitWithResult(combinedResult);
  });
}

// ── Remote Operation Helper ─────────────────────────────

/**
 * Run a remote-ops.sh command on a single server.
 *
 * Generic helper used by both prepare and switch phases.
 * Returns a ServerResult with success/failure and captured output.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param command - Remote command to execute
 * @param timeout - Timeout in milliseconds
 * @returns Server result indicating success or failure
 */
async function runRemoteOp(
  sshConfig: SSHConfig,
  server: ServerEntry,
  command: string,
  timeout: number,
): Promise<ServerResult> {
  try {
    const result = await sshExec(sshConfig, server.host, command, {
      pipe: true,
      timeout,
    });

    const success = result.exitCode === 0;

    return {
      server,
      success,
      duration: 0, // Set by executeOnServers wrapper
      output: result.stdout.trim() || undefined,
      error: success ? undefined : `failed (exit ${result.exitCode})`,
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
