/**
 * Deploy CLI — Switch command.
 *
 * Runs `blue-green-switch` on all resolved servers in parallel.
 * This is the second phase of a two-phase deployment:
 *
 * 1. prepare — Build/pull image, start new color, wait for health checks
 * 2. **switch** — Swap Nginx upstream to new color
 *
 * The switch phase is fast — it only swaps the Nginx upstream config
 * and reloads Nginx. This takes milliseconds per server, making the
 * traffic cutover nearly instantaneous across all servers.
 *
 * In a coordinated multi-server deploy, switch only runs after ALL
 * servers have successfully completed prepare (see deploy.ts).
 *
 * @module commands/switch
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

// ── Switch Command Handler ──────────────────────────────

/**
 * Run blue-green-switch on all resolved servers.
 *
 * Orchestrates the second phase of a blue-green deployment:
 * 1. Resolve target servers from inventory
 * 2. Setup SSH configuration
 * 3. Run `remote-ops.sh blue-green-switch` on all servers in parallel
 * 4. Report per-server results
 * 5. Exit 0 if all succeeded, exit 1 if any failed
 *
 * If switch fails on some servers, the results clearly show which servers
 * switched and which didn't — critical for understanding partial states.
 *
 * @param args - Parsed CLI arguments
 */
export async function switchCommand(args: ParsedArgs): Promise<void> {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);

  if (servers.length === 0) {
    logger.info('No servers matched — nothing to switch');
    return;
  }

  if (options.dryRun) {
    logDryRun('switch', servers, options);
    return;
  }

  logger.info(`Switching ${servers.length} server(s) in ${options.environment}`);

  const sshOpts = buildSSHOptions(sshOptions);
  const scriptsDir = `${options.deployPath}/scripts`;
  const remoteCommand = `bash ${scriptsDir}/remote-ops.sh blue-green-switch`;

  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      'switch',
      servers,
      (server) => runSwitch(sshConfig, server, remoteCommand),
      options.maxParallel,
    );
  });

  exitWithResult(result);
}

// ── Per-Server Switch Logic ─────────────────────────────

/**
 * Run blue-green-switch on a single server.
 *
 * This is the fast phase — just an Nginx config swap + reload.
 * Should complete in seconds unless there's a connectivity issue.
 *
 * A shorter timeout (2 minutes) is appropriate because the switch
 * operation itself is very lightweight.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param remoteCommand - Full remote command string
 * @returns Server result indicating success or failure
 */
async function runSwitch(
  sshConfig: SSHConfig,
  server: ServerEntry,
  remoteCommand: string,
): Promise<ServerResult> {
  try {
    const result = await sshExec(sshConfig, server.host, remoteCommand, {
      pipe: true, // Show switch output for visibility
      timeout: 120_000, // 2 minutes — switch is fast, timeout is a safety net
    });

    const success = result.exitCode === 0;

    return {
      server,
      success,
      duration: 0, // Set by executeOnServers wrapper
      output: result.stdout.trim() || undefined,
      error: success ? undefined : `switch failed (exit ${result.exitCode})`,
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
