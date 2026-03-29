/**
 * Deploy CLI — Upload command.
 *
 * Uploads deployment artifacts to remote servers:
 * 1. Scripts (remote-ops.sh, health-check-wait.sh)
 * 2. Setup directories via remote-ops.sh setup-dirs
 * 3. Application tarball (in-place strategy only)
 * 4. Docker/Nginx configuration files
 * 5. Seed active-upstream.conf if first deploy
 * 6. Set .env variables (DEPLOY_ENV, COMPOSE_PROJECT_NAME, env_defaults)
 *
 * This command replaces the upload logic that was previously inline
 * in the GitHub Actions workflow YAML.
 *
 * @module commands/upload
 */

import { existsSync } from 'fs';
import { join } from 'path';

import type { ParsedArgs, SSHConfig, ServerEntry, ServerResult } from '../types.ts';
import { sshExec, scpUpload } from '../lib/ssh.ts';
import { readConfig, getEnvDefaults } from '../lib/config.ts';
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

// ── Upload Command Handler ──────────────────────────────

/**
 * Upload deployment artifacts to all resolved servers.
 *
 * Orchestrates a multi-step upload sequence for each server:
 * scripts → setup-dirs → tarball → Docker/Nginx configs → .env setup.
 *
 * Each step uses SCP for file transfers and SSH for remote commands.
 * All servers are processed in parallel (respecting --max-parallel).
 *
 * @param args - Parsed CLI arguments
 */
export async function uploadCommand(args: ParsedArgs): Promise<void> {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);

  if (servers.length === 0) {
    logger.info('No servers matched — nothing to upload');
    return;
  }

  if (options.dryRun) {
    logDryRun('upload', servers, options);
    return;
  }

  logger.info(`Uploading to ${servers.length} server(s) in ${options.environment}`);

  const sshOpts = buildSSHOptions(sshOptions);

  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      'upload',
      servers,
      (server) => uploadToServer(sshConfig, server, options, args),
      options.maxParallel,
    );
  });

  exitWithResult(result);
}

// ── Per-Server Upload Logic ─────────────────────────────

/**
 * Upload all deployment artifacts to a single server.
 *
 * Executes the full upload sequence:
 * 1. Upload scripts (remote-ops.sh, health-check-wait.sh)
 * 2. Run setup-dirs to create directory structure
 * 3. Upload tarball and run receive-deploy (in-place only)
 * 4. Upload Docker files (Dockerfile, docker-compose.yml, .env.example)
 * 5. Upload Nginx config tree recursively
 * 6. Seed active-upstream.conf if first deploy
 * 7. Set .env variables from env_defaults
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server entry
 * @param options - Deploy options
 * @param args - Original parsed args (for tarball path)
 * @returns Server result indicating success or failure
 */
async function uploadToServer(
  sshConfig: SSHConfig,
  server: ServerEntry,
  options: ReturnType<typeof parseDeployOptions>,
  args: ParsedArgs,
): Promise<ServerResult> {
  const { deployPath, strategy } = options;
  const scriptsDir = `${deployPath}/scripts`;
  const output: string[] = [];

  try {
    // Step 1: Upload deployment scripts
    // These must be uploaded first because setup-dirs uses remote-ops.sh
    await uploadScripts(sshConfig, server, scriptsDir);
    output.push('scripts uploaded');

    // Step 2: Create directory structure on the remote server
    await sshExec(sshConfig, server.host, `bash ${scriptsDir}/remote-ops.sh setup-dirs`);
    output.push('dirs created');

    // Step 3: Upload and extract tarball (in-place strategy only)
    // Registry strategy skips this — images are pulled from the registry instead
    if (strategy === 'in-place') {
      const tarballPath = args.options['tarball'];
      if (tarballPath && existsSync(tarballPath)) {
        await scpUpload(sshConfig, server.host, tarballPath, deployPath);
        await sshExec(sshConfig, server.host, `bash ${scriptsDir}/remote-ops.sh receive-deploy`);
        output.push('tarball deployed');
      }
    }

    // Step 4: Upload Docker configuration files
    await uploadDockerConfigs(sshConfig, server, deployPath);
    output.push('docker configs uploaded');

    // Step 5: Upload Nginx configuration tree
    await uploadNginxConfigs(sshConfig, server, deployPath);
    output.push('nginx configs uploaded');

    // Step 6: Seed active-upstream if first deploy
    // On first deploy, active-upstream.conf doesn't exist yet — seed it with blue
    await seedActiveUpstream(sshConfig, server, deployPath);

    // Step 7: Set .env variables (DEPLOY_ENV, COMPOSE_PROJECT_NAME, env_defaults)
    await setEnvVariables(sshConfig, server, deployPath, options);
    output.push('.env configured');

    return {
      server,
      success: true,
      duration: 0, // Actual duration set by executeOnServers wrapper
      output: output.join(', '),
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg,
      output: output.join(', '),
    };
  }
}

// ── Upload Sub-Steps ────────────────────────────────────

/**
 * Upload deployment scripts to the server's scripts directory.
 *
 * Uploads remote-ops.sh and health-check-wait.sh, then makes them executable.
 * These scripts are the foundation for all remote operations.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param scriptsDir - Remote scripts directory path
 */
async function uploadScripts(
  sshConfig: SSHConfig,
  server: ServerEntry,
  scriptsDir: string,
): Promise<void> {
  // Ensure the scripts directory exists on the remote server
  await sshExec(sshConfig, server.host, `mkdir -p ${scriptsDir}`);

  // Upload the two core deployment scripts
  const scriptFiles = ['remote-ops.sh', 'health-check-wait.sh'];
  const localPaths = scriptFiles
    .map(f => join('deployment', 'scripts', f))
    .filter(f => existsSync(f));

  if (localPaths.length > 0) {
    await scpUpload(sshConfig, server.host, localPaths, scriptsDir);
    // Make scripts executable
    await sshExec(sshConfig, server.host, `chmod +x ${scriptsDir}/*.sh`);
  }
}

/**
 * Upload Docker configuration files (Dockerfile, docker-compose.yml, .env.example).
 *
 * These files are placed at the deployment root on the remote server.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param deployPath - Remote deployment root path
 */
async function uploadDockerConfigs(
  sshConfig: SSHConfig,
  server: ServerEntry,
  deployPath: string,
): Promise<void> {
  const dockerFiles = ['Dockerfile', 'docker-compose.yml', '.env.example'];
  const localPaths = dockerFiles
    .map(f => join('deployment', f))
    .filter(f => existsSync(f));

  if (localPaths.length > 0) {
    await scpUpload(sshConfig, server.host, localPaths, deployPath);
  }
}

/**
 * Upload the Nginx configuration tree recursively.
 *
 * The Nginx config directory structure (conf.d/, includes/, locations/,
 * upstreams/) is copied as-is to the remote server, preserving the
 * modular config layout.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param deployPath - Remote deployment root path
 */
async function uploadNginxConfigs(
  sshConfig: SSHConfig,
  server: ServerEntry,
  deployPath: string,
): Promise<void> {
  const nginxDir = join('deployment', 'nginx');
  if (existsSync(nginxDir)) {
    // Ensure the nginx directory exists on the remote before uploading
    await sshExec(sshConfig, server.host, `mkdir -p ${deployPath}/nginx`);
    await scpUpload(
      sshConfig,
      server.host,
      nginxDir,
      `${deployPath}/`,
      { recursive: true },
    );
  }
}

/**
 * Seed active-upstream.conf with blue on first deploy.
 *
 * Checks if active-upstream.conf exists on the remote server. If it doesn't
 * (first deploy), copies blue-upstream.conf as the initial active upstream.
 * This ensures Nginx has a valid upstream before the first switch.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param deployPath - Remote deployment root path
 */
async function seedActiveUpstream(
  sshConfig: SSHConfig,
  server: ServerEntry,
  deployPath: string,
): Promise<void> {
  const upstreamsDir = `${deployPath}/nginx/upstreams`;
  const activeConf = `${upstreamsDir}/active-upstream.conf`;
  const blueConf = `${upstreamsDir}/blue-upstream.conf`;

  // Check if active-upstream.conf already exists
  const check = await sshExec(
    sshConfig,
    server.host,
    `test -f ${activeConf} && echo exists || echo missing`,
  );

  if (check.stdout.trim() === 'missing') {
    logger.info(`Seeding active-upstream.conf with blue on ${server.name}`);
    await sshExec(sshConfig, server.host, `cp ${blueConf} ${activeConf}`);
  }
}

/**
 * Set environment variables in the remote .env file.
 *
 * Creates or updates the .env file with:
 * - DEPLOY_ENV — the environment name (test, acceptance, production)
 * - COMPOSE_PROJECT_NAME — for Docker Compose isolation
 * - env_defaults from deploy-config.json (NGINX_HTTP_PORT, etc.)
 *
 * Uses a heredoc approach via SSH to write/update the .env file.
 *
 * @param sshConfig - SSH config for connections
 * @param server - Target server
 * @param deployPath - Remote deployment root path
 * @param options - Deploy options with environment and project name
 */
async function setEnvVariables(
  sshConfig: SSHConfig,
  server: ServerEntry,
  deployPath: string,
  options: ReturnType<typeof parseDeployOptions>,
): Promise<void> {
  const envFile = `${deployPath}/.env`;

  // Build the list of env vars to set
  const envVars: Record<string, string> = {
    DEPLOY_ENV: options.environment,
  };

  // Only set COMPOSE_PROJECT_NAME if a project name was provided
  if (options.projectName) {
    envVars['COMPOSE_PROJECT_NAME'] = options.projectName;
  }

  // Merge env_defaults from deploy-config.json (e.g., NGINX_HTTP_PORT, DOZZLE_PORT)
  try {
    const config = readConfig();
    const defaults = getEnvDefaults(config, options.environment);
    Object.assign(envVars, defaults);
  } catch {
    // Config file may not exist — that's OK, just skip defaults
    logger.warn('Could not read deploy-config.json for env_defaults — skipping');
  }

  // Create .env if it doesn't exist, then update/append each variable
  // Using grep + sed to update existing vars or append new ones
  const commands: string[] = [`touch ${envFile}`];
  for (const [key, value] of Object.entries(envVars)) {
    // If the key exists, update it; if not, append it
    commands.push(
      `grep -q "^${key}=" ${envFile} ` +
      `&& sed -i "s|^${key}=.*|${key}=${value}|" ${envFile} ` +
      `|| echo "${key}=${value}" >> ${envFile}`,
    );
  }

  await sshExec(sshConfig, server.host, commands.join(' && '));
}
