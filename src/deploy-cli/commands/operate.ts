/**
 * Deploy CLI — Operate command.
 *
 * Runs any remote-ops.sh subcommand on resolved servers.
 * This is the general-purpose command for ad-hoc operations like
 * health-check, restart, view-logs, cleanup, etc.
 *
 * Extra arguments after "--" are passed through to remote-ops.sh.
 * For example:
 *   node deploy-cli.js operate --env test --op view-logs -- 500
 *   → ssh server "remote-ops.sh view-logs 500"
 *
 * @module commands/operate
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

// ── Operate Command Handler ─────────────────────────────

/**
 * Run a remote-ops.sh subcommand on all resolved servers.
 *
 * The operation name is specified via --op flag. Any extra arguments
 * after "--" are passed through to the remote command.
 *
 * Some operations (like view-logs) produce large output and benefit
 * from live streaming — this is handled by piping SSH output to stdout.
 *
 * @param args - Parsed CLI arguments
 */
export async function operateCommand(args: ParsedArgs): Promise<void> {
  const options = parseDeployOptions(args);

  // --op is required for the operate command
  const operation = args.options['op'];
  if (!operation) {
    logger.error('--op is required for the operate command');
    logger.error('Example: --op health-check, --op restart, --op view-logs');
    process.exit(1);
  }

  const { servers, sshOptions } = resolveTargetServers(options);

  if (servers.length === 0) {
    logger.info('No servers matched — nothing to do');
    return;
  }

  if (options.dryRun) {
    logDryRun(`operate:${operation}`, servers, options);
    if (args.extraArgs.length > 0) {
      logger.info(`Extra args: ${args.extraArgs.join(' ')}`);
    }
    return;
  }

  logger.info(`Running "${operation}" on ${servers.length} server(s) in ${options.environment}`);

  const sshOpts = buildSSHOptions(sshOptions);

  // Build the full remote command with extra args
  const extraArgsStr = args.extraArgs.length > 0
    ? ' ' + args.extraArgs.join(' ')
    : '';
  const scriptsDir = `${options.deployPath}/scripts`;
  const remoteCommand = `bash ${scriptsDir}/remote-ops.sh ${operation}${extraArgsStr}`;

  // Determine if this operation should stream output live
  // Operations like view-logs benefit from real-time output
  const streamingOps = new Set(['view-logs', 'status', 'docker-logs']);
  const shouldPipe = streamingOps.has(operation);

  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      `operate:${operation}`,
      servers,
      (server) => runOperation(sshConfig, server, remoteCommand, shouldPipe),
      options.maxParallel,
    );
  });

  exitWithResult(result);
}

// ── Per-Server Operation ────────────────────────────────

/**
 * Run a remote-ops.sh command on a single server.
 *
 * Executes the command via SSH and captures the result.
 * Exit code 0 = success, anything else = failure.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param remoteCommand - Full remote command string
 * @param pipe - Whether to pipe output live to stdout
 * @returns Server result indicating success or failure
 */
async function runOperation(
  sshConfig: SSHConfig,
  server: ServerEntry,
  remoteCommand: string,
  pipe: boolean,
): Promise<ServerResult> {
  try {
    const result = await sshExec(sshConfig, server.host, remoteCommand, {
      pipe,
      // Operations get a generous timeout (5 minutes)
      // Some operations like rebuild can take a while
      timeout: 300_000,
    });

    const success = result.exitCode === 0;
    const output = result.stdout.trim() || result.stderr.trim();

    return {
      server,
      success,
      duration: 0, // Set by executeOnServers wrapper
      output: output || undefined,
      error: success ? undefined : `exit code ${result.exitCode}`,
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
