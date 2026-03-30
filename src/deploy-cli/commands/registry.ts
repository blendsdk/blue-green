/**
 * Deploy CLI — Registry command.
 *
 * Build and push a Docker image to a self-hosted registry (CI-side only).
 * Uses `docker buildx build --push` for native multi-architecture support —
 * a single command builds for one or more platforms, creates a manifest list,
 * and pushes directly to the registry.
 *
 * This runs locally on the CI runner (not via SSH to remote servers).
 * The registry is assumed to be accessible from the runner.
 *
 * For multi-platform builds (e.g., --platform linux/amd64,linux/arm64),
 * QEMU must be registered on the CI runner beforehand (typically via
 * `docker run --privileged multiarch/qemu-user-static --reset -p yes`).
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

/** Name of the buildx builder instance used for blue-green builds */
const BUILDX_BUILDER_NAME = 'bluegreen';

// ── Registry Command Handler ────────────────────────────

/**
 * Build and push a Docker image to the registry using buildx.
 *
 * Workflow:
 * 1. Parse registry options (--registry-url, --image-name, --tag, --platform)
 * 2. Ensure a buildx builder exists (idempotent create + use)
 * 3. Build and push via `docker buildx build --push` (single command)
 * 4. Clean up local images (best-effort, may not exist with buildx --push)
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

  // Step 1: Ensure buildx builder is available (idempotent)
  await ensureBuildxBuilder();

  // Step 2: Build and push in a single buildx command
  await buildAndPushImage(fullTag, args, options.platform);

  // Step 3: Clean up local images (best-effort)
  await cleanupImages(fullTag);

  // Step 4: Output the tag for downstream workflow steps
  // This can be captured in GitHub Actions via $GITHUB_OUTPUT
  logger.info(`Image pushed successfully: ${fullTag}`);
  console.log(`IMAGE_TAG=${options.imageTag}`);
}

// ── Option Parsing ──────────────────────────────────────

/**
 * Parse and validate registry-specific options from CLI arguments.
 *
 * Uses `latest` as the default tag — this simplifies the deployment pipeline
 * since the same tag is used everywhere (CI push, docker-compose pull, .env).
 * Image identity is tracked via the `git.sha` label embedded in each build.
 *
 * @param args - Parsed CLI arguments
 * @returns Validated registry options
 * @throws Error if required options are missing
 */
function parseRegistryOptions(args: ParsedArgs): RegistryOptions {
  const registryUrl = args.options['registry-url'];
  if (!registryUrl) {
    logger.error('--registry-url is required (e.g., --registry-url registry.example.com)');
    process.exit(1);
  }

  const imageName = args.options['image-name'];
  if (!imageName) {
    logger.error('--image-name is required (e.g., --image-name myapp)');
    process.exit(1);
  }

  // Default to "latest" — simplifies pipeline (CI push + server pull use same tag).
  // Image traceability is via git.sha label, not tag uniqueness.
  const imageTag = args.options['tag'] ?? 'latest';

  const platform = args.options['platform'] ?? undefined;

  return { registryUrl, imageName, imageTag, platform };
}

// ── Buildx Builder Setup ────────────────────────────────

/**
 * Ensure a buildx builder instance exists and is selected.
 *
 * This is idempotent — if the builder already exists, `docker buildx create`
 * returns a non-zero exit code which we handle by falling back to `use`.
 * If it doesn't exist, we create it and then select it.
 *
 * The builder is needed for multi-platform builds (--platform with
 * comma-separated values) and for the --push flag which pushes directly
 * from the build cache without loading into the local docker daemon.
 */
async function ensureBuildxBuilder(): Promise<void> {
  logger.info(`Ensuring buildx builder "${BUILDX_BUILDER_NAME}" is available`);

  // Try to create the builder — if it already exists, this fails harmlessly
  const createResult = await spawn('docker', [
    'buildx', 'create',
    '--name', BUILDX_BUILDER_NAME,
    '--driver', 'docker-container',
  ], {
    timeout: 15_000,
  });

  if (createResult.exitCode === 0) {
    logger.info(`Created buildx builder "${BUILDX_BUILDER_NAME}"`);
  }

  // Select the builder — works whether we just created it or it existed
  const useResult = await spawn('docker', [
    'buildx', 'use', BUILDX_BUILDER_NAME,
  ], {
    timeout: 5_000,
  });

  if (useResult.exitCode !== 0) {
    logger.error(`Failed to select buildx builder "${BUILDX_BUILDER_NAME}"`);
    logger.error(useResult.stderr.trim());
    logger.error('docker buildx is required. Install Docker 20.10+ with buildx plugin.');
    process.exit(1);
  }
}

// ── Docker Buildx Build + Push ──────────────────────────

/**
 * Build and push a Docker image using `docker buildx build --push`.
 *
 * This replaces the previous two-step flow (docker build + docker push)
 * with a single buildx command that:
 * - Builds for one or more platforms (--platform)
 * - Creates a manifest list for multi-platform images
 * - Pushes directly from the build cache (no local image load needed)
 *
 * For multi-platform builds, QEMU must be registered on the runner.
 * The --push flag means the image is never loaded into the local daemon —
 * it goes directly from build cache to registry.
 *
 * @param fullTag - Full image tag (registry/name:tag)
 * @param args - Parsed CLI arguments for deploy-path
 * @param platform - Target platform(s) (e.g., "linux/arm64" or "linux/amd64,linux/arm64")
 */
async function buildAndPushImage(fullTag: string, args: ParsedArgs, platform?: string): Promise<void> {
  const deployPath = args.options['deploy-path'] ?? '.';

  // Get git SHA for image labeling (traceability)
  const gitSha = await getGitSha();

  const buildArgs = [
    'buildx', 'build',
    '--tag', fullTag,
    '--label', `git.sha=${gitSha}`,
    '--push', // Push directly from build cache — no local image load
  ];

  // Platform support: single arch, multi-arch comma-separated, or omit for native
  if (platform) {
    buildArgs.push('--platform', platform);
    logger.info(`Target platform(s): ${platform}`);
  }

  // Build context is the deploy path (typically the deployment directory)
  buildArgs.push(deployPath);

  logger.step('1/1', 'Building and pushing Docker image via buildx');

  const result = await spawn('docker', buildArgs, {
    pipe: true, // Stream build output live for CI visibility
    timeout: 600_000, // 10 minutes for builds
  });

  if (result.exitCode !== 0) {
    logger.error('Docker buildx build --push failed');
    logger.error(result.stderr.trim());

    // Provide helpful hints for common failures
    if (result.stderr.includes('exec format error') || result.stderr.includes('no match for platform')) {
      logger.error('Hint: QEMU may not be registered. Run: docker run --privileged multiarch/qemu-user-static --reset -p yes');
    }
    if (result.stderr.includes('unauthorized') || result.stderr.includes('authentication required')) {
      logger.error('Hint: docker login to the registry may be required before running this command.');
    }

    process.exit(1);
  }
}

// ── Image Cleanup ───────────────────────────────────────

/**
 * Clean up local Docker images after a successful push.
 *
 * With `buildx --push`, images are pushed directly from the build cache
 * and may NOT exist in the local Docker daemon. The `docker rmi` is
 * best-effort — it's expected to fail silently when no local image exists.
 *
 * Also prunes dangling images to free disk space on CI runners.
 *
 * @param fullTag - Full image tag to attempt removing
 */
async function cleanupImages(fullTag: string): Promise<void> {
  logger.info('Cleaning up local images (best-effort)');

  // Try to remove the specific image — may not exist locally with buildx --push
  try {
    await spawn('docker', ['rmi', fullTag], { timeout: 30_000 });
  } catch {
    // Ignore — image may not exist locally, which is fine
  }

  // Prune dangling images to free CI runner disk space
  try {
    await spawn('docker', ['image', 'prune', '-f'], { timeout: 30_000 });
  } catch {
    // Ignore — cleanup is best-effort, don't fail the command
  }
}

// ── Helpers ─────────────────────────────────────────────

/**
 * Get the current git commit SHA.
 *
 * Used to label Docker images for traceability — the git commit hash
 * is embedded in the image metadata so you can always trace an image
 * back to the source commit.
 *
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
  logger.info(`Platform: ${options.platform ?? '(native)'}`);
  logger.info(`Full tag: ${fullTag}`);
  logger.info(`Builder: ${BUILDX_BUILDER_NAME}`);
  logger.info('Would: create/use buildx builder → buildx build --push → cleanup');
}
