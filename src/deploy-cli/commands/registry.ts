/**
 * Deploy CLI — Registry command.
 *
 * Build and push a Docker image to a self-hosted registry (CI-side only).
 * Used in the registry deployment strategy where images are built on the
 * CI runner and pushed to a shared registry, then pulled by each server.
 *
 * This runs locally on the CI runner (not via SSH to remote servers).
 * The registry is assumed to be accessible from the runner (e.g., via
 * `network_mode: "host"` where the runner can push to `localhost:5000`).
 *
 * Output:
 *   Prints `IMAGE_TAG=<tag>` to stdout for downstream workflow steps
 *   to capture via `$GITHUB_OUTPUT` or similar mechanisms.
 *
 * @module commands/registry
 */

import type { ParsedArgs, RegistryOptions } from '../types.ts';
import { spawn } from '../lib/process.ts';
import { logger } from '../lib/logger.ts';

// ── Registry Command Handler ────────────────────────────

/**
 * Build and push a Docker image to the registry.
 *
 * Workflow:
 * 1. Parse registry options (--registry-url, --image-name, --tag)
 * 2. Generate tag if not provided (YYYYMMDDHHMMSS timestamp)
 * 3. Build Docker image with registry tag and git SHA label
 * 4. Push Docker image to the registry
 * 5. Output IMAGE_TAG for downstream steps
 *
 * @param args - Parsed CLI arguments
 */
export async function registryCommand(args: ParsedArgs): Promise<void> {
  const options = parseRegistryOptions(args);

  const dryRun = args.options['dry-run'] === 'true';
  if (dryRun) {
    logRegistryDryRun(options);
    return;
  }

  const fullTag = `${options.registryUrl}/${options.imageName}:${options.imageTag}`;
  logger.info(`Building image: ${fullTag}`);

  // Step 1: Build the Docker image
  await buildImage(fullTag, args);

  // Step 2: Push the image to the registry
  await pushImage(fullTag);

  // Step 3: Output the tag for downstream workflow steps
  // This can be captured in GitHub Actions via $GITHUB_OUTPUT
  logger.info(`Image pushed successfully: ${fullTag}`);
  console.log(`IMAGE_TAG=${options.imageTag}`);
}

// ── Option Parsing ──────────────────────────────────────

/**
 * Parse and validate registry-specific options from CLI arguments.
 *
 * @param args - Parsed CLI arguments
 * @returns Validated registry options
 * @throws Error if required options are missing
 */
function parseRegistryOptions(args: ParsedArgs): RegistryOptions {
  const registryUrl = args.options['registry-url'];
  if (!registryUrl) {
    logger.error('--registry-url is required (e.g., --registry-url localhost:5000)');
    process.exit(1);
  }

  const imageName = args.options['image-name'];
  if (!imageName) {
    logger.error('--image-name is required (e.g., --image-name myapp)');
    process.exit(1);
  }

  // Generate a timestamp tag if none provided
  // Format: YYYYMMDDHHMMSS — sortable and unique per second
  const imageTag = args.options['tag'] ?? generateTimestampTag();

  return { registryUrl, imageName, imageTag };
}

// ── Docker Build ────────────────────────────────────────

/**
 * Build a Docker image with the specified tag.
 *
 * Includes a git SHA label for traceability — the git commit hash
 * is embedded in the image metadata so you can always trace an image
 * back to the source commit.
 *
 * The build context is the deploy path (--deploy-path) or current directory.
 *
 * @param fullTag - Full image tag (registry/name:tag)
 * @param args - Parsed CLI arguments for deploy-path
 */
async function buildImage(fullTag: string, args: ParsedArgs): Promise<void> {
  const deployPath = args.options['deploy-path'] ?? '.';

  // Get git SHA for image labeling (traceability)
  const gitSha = await getGitSha();

  const buildArgs = [
    'build',
    '-t', fullTag,
    '--label', `git.sha=${gitSha}`,
    deployPath,
  ];

  logger.step('1/2', 'Building Docker image');

  const result = await spawn('docker', buildArgs, {
    pipe: true, // Stream build output live
    timeout: 600_000, // 10 minutes for builds
  });

  if (result.exitCode !== 0) {
    logger.error('Docker build failed');
    logger.error(result.stderr.trim());
    process.exit(1);
  }
}

// ── Docker Push ─────────────────────────────────────────

/**
 * Push a Docker image to the registry.
 *
 * @param fullTag - Full image tag (registry/name:tag) to push
 */
async function pushImage(fullTag: string): Promise<void> {
  logger.step('2/2', 'Pushing Docker image to registry');

  const result = await spawn('docker', ['push', fullTag], {
    pipe: true,
    timeout: 300_000, // 5 minutes for push
  });

  if (result.exitCode !== 0) {
    logger.error('Docker push failed');
    logger.error(result.stderr.trim());
    process.exit(1);
  }
}

// ── Helpers ─────────────────────────────────────────────

/**
 * Generate a timestamp-based image tag.
 *
 * Format: YYYYMMDDHHMMSS (e.g., "20260329220000")
 * This is sortable and unique per second, suitable for image versioning.
 *
 * @returns Timestamp tag string
 */
function generateTimestampTag(): string {
  const now = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

/**
 * Get the current git commit SHA.
 *
 * Used to label Docker images for traceability.
 * Falls back to "unknown" if git is not available.
 *
 * @returns Git SHA string or "unknown"
 */
async function getGitSha(): Promise<string> {
  try {
    const result = await spawn('git', ['rev-parse', 'HEAD'], {
      timeout: 5_000,
    });
    return result.exitCode === 0 ? result.stdout.trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Log what would happen in dry-run mode for the registry command.
 *
 * @param options - Registry options
 */
function logRegistryDryRun(options: RegistryOptions): void {
  const fullTag = `${options.registryUrl}/${options.imageName}:${options.imageTag}`;
  logger.info('DRY RUN — registry');
  logger.info(`Registry URL: ${options.registryUrl}`);
  logger.info(`Image name: ${options.imageName}`);
  logger.info(`Image tag: ${options.imageTag}`);
  logger.info(`Full tag: ${fullTag}`);
  logger.info('Would build and push this image');
}
