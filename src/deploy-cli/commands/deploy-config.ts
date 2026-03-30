/**
 * Deploy CLI — Deploy Config command.
 *
 * Deploys config files from GitHub Actions secrets to remote servers.
 * Replaces the old deploy-config-files.sh script.
 *
 * Reads deploy-config.json to determine which secrets map to which files,
 * resolves environment-specific placeholders ({ENV} → "ACC"), extracts
 * secret values from the ALL_SECRETS environment variable (JSON from
 * `${{ toJSON(secrets) }}`), writes them to temp files, and SCPs them
 * to the correct paths on each server.
 *
 * @module commands/deploy-config
 */

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import type { ParsedArgs, SSHConfig, ServerEntry, ServerResult } from '../types.ts';
import { readConfig, resolveConfigEntries } from '../lib/config.ts';
import type { ResolvedConfigEntry } from '../lib/config.ts';
import { scpUpload, sshExec } from '../lib/ssh.ts';
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

// ── Deploy Config Command Handler ───────────────────────

/**
 * Deploy config files from secrets to all resolved servers.
 *
 * Workflow:
 * 1. Read deploy-config.json and resolve entries for the target environment
 * 2. Parse ALL_SECRETS env var to get secret values
 * 3. For each server, SCP each config file to its deploy path
 *
 * @param args - Parsed CLI arguments
 */
export async function deployConfigCommand(args: ParsedArgs): Promise<void> {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);

  if (servers.length === 0) {
    logger.info('No servers matched — nothing to deploy');
    return;
  }

  // Read and resolve config entries for this environment
  const config = readConfig();
  const entries = resolveConfigEntries(config, options.environment);

  if (entries.length === 0) {
    logger.info('No config entries defined — nothing to deploy');
    return;
  }

  // Parse ALL_SECRETS env var — this is a JSON object of all GitHub secrets
  // Set in workflows via: ALL_SECRETS: ${{ toJSON(secrets) }}
  const secrets = parseSecrets();

  // Validate that all required secrets exist before starting
  const missingSecrets = entries.filter(e => !secrets[e.secretKey]);
  if (missingSecrets.length > 0) {
    const missing = missingSecrets.map(e => e.secretKey).join(', ');
    logger.error(`Missing secrets: ${missing}`);
    logger.error('Ensure ALL_SECRETS env var contains all required secrets.');
    process.exit(1);
  }

  if (options.dryRun) {
    logDryRun('deploy-config', servers, options);
    logger.info(`Config entries to deploy (${entries.length}):`);
    for (const entry of entries) {
      logger.info(`  ${entry.name}: ${entry.secretKey} → ${entry.deployPath}`);
    }
    return;
  }

  logger.info(`Deploying ${entries.length} config file(s) to ${servers.length} server(s)`);

  const sshOpts = buildSSHOptions(sshOptions);

  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      'deploy-config',
      servers,
      (server) => deployConfigToServer(sshConfig, server, entries, secrets, options.deployPath),
      options.maxParallel,
    );
  });

  exitWithResult(result);
}

// ── Per-Server Deploy Logic ─────────────────────────────

/**
 * Deploy all config files to a single server.
 *
 * For each config entry:
 * 1. Extract secret value from ALL_SECRETS
 * 2. Write to a local temp file
 * 3. SCP to the server at deployPath/entry.deployPath
 * 4. Clean up the temp file
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param entries - Resolved config entries
 * @param secrets - Parsed secrets from ALL_SECRETS
 * @param deployPath - Remote deployment root path
 * @returns Server result indicating success or failure
 */
async function deployConfigToServer(
  sshConfig: SSHConfig,
  server: ServerEntry,
  entries: ResolvedConfigEntry[],
  secrets: Record<string, string>,
  deployPath: string,
): Promise<ServerResult> {
  const deployed: string[] = [];

  try {
    for (const entry of entries) {
      const secretValue = secrets[entry.secretKey];
      if (!secretValue) {
        // This shouldn't happen — we validated above, but be defensive
        throw new Error(`Secret "${entry.secretKey}" not found for config "${entry.name}"`);
      }

      // Write secret to a temp file for SCP transfer
      const tempFile = join(tmpdir(), `deploy-config-${Date.now()}-${entry.name}`);
      try {
        writeFileSync(tempFile, secretValue, { mode: 0o600 });

        // Determine the full remote path
        const remotePath = `${deployPath}/${entry.deployPath}`;

        // Ensure the parent directory exists on the remote server
        const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        if (remoteDir) {
          await sshExec(sshConfig, server.host, `mkdir -p ${remoteDir}`);
        }

        // Upload the config file
        await scpUpload(sshConfig, server.host, tempFile, remotePath);
        deployed.push(entry.name);
      } finally {
        // Always clean up the temp file — don't leave secrets on disk
        try { unlinkSync(tempFile); } catch { /* already gone */ }
      }
    }

    return {
      server,
      success: true,
      duration: 0, // Set by executeOnServers wrapper
      output: `deployed: ${deployed.join(', ')}`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg,
      output: deployed.length > 0 ? `partial: ${deployed.join(', ')}` : undefined,
    };
  }
}

// ── Secret Parsing ──────────────────────────────────────

/**
 * Parse the ALL_SECRETS environment variable.
 *
 * In GitHub Actions workflows, this is set via:
 *   ALL_SECRETS: ${{ toJSON(secrets) }}
 *
 * The value is a JSON object where keys are secret names and
 * values are the secret contents.
 *
 * @returns Parsed secrets as a key-value record
 * @throws Error if ALL_SECRETS is not set or contains invalid JSON
 */
function parseSecrets(): Record<string, string> {
  const raw = process.env['ALL_SECRETS'];
  if (!raw) {
    logger.error('ALL_SECRETS environment variable is not set.');
    logger.error('In GitHub Actions, set it via: ALL_SECRETS: ${{ toJSON(secrets) }}');
    process.exit(1);
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('ALL_SECRETS must be a JSON object');
    }
    return parsed as Record<string, string>;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to parse ALL_SECRETS: ${errorMsg}`);
    process.exit(1);
  }
}
