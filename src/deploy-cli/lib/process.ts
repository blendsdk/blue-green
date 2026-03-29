/**
 * Deploy CLI — Process helpers.
 *
 * Wraps Node.js child_process.spawn with timeout support, stream capture,
 * and optional piping to parent process stdout/stderr for live CI output.
 *
 * Uses only Node.js built-in modules (zero runtime dependencies).
 *
 * @module lib/process
 */

import { spawn as nodeSpawn } from 'child_process';

/**
 * Options for spawning a child process.
 */
export interface SpawnOptions {
  /** Timeout in milliseconds — process is killed after this duration (default: no timeout) */
  timeout?: number;
  /** Additional environment variables merged with process.env */
  env?: Record<string, string>;
  /** Working directory for the child process */
  cwd?: string;
  /** If true, pipe stdout/stderr to parent process for live CI output */
  pipe?: boolean;
}

/**
 * Result of a spawned process — captured output and exit information.
 */
export interface SpawnResult {
  /** Captured stdout content */
  stdout: string;
  /** Captured stderr content */
  stderr: string;
  /** Process exit code (null if killed by signal) */
  exitCode: number | null;
}

/**
 * Spawn a child process and capture its output.
 *
 * Supports timeout (kills process if exceeded), environment variable injection,
 * working directory override, and optional live output piping.
 *
 * The command is split into the executable and its arguments. If you need
 * shell interpretation (pipes, redirects), use `spawnShell` instead.
 *
 * @param command - The executable to run
 * @param args - Arguments to pass to the executable
 * @param options - Spawn options (timeout, env, cwd, pipe)
 * @returns Promise resolving to captured stdout, stderr, and exit code
 *
 * @example
 * ```ts
 * const result = await spawn('ssh', ['-F', configPath, host, 'remote-ops.sh health-check'], {
 *   timeout: 30_000,
 *   pipe: true,
 * });
 * if (result.exitCode !== 0) {
 *   console.error('Health check failed:', result.stderr);
 * }
 * ```
 */
export function spawn(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const { timeout, env, cwd, pipe = false } = options;

    // Merge additional env vars with current process environment
    const mergedEnv = env
      ? { ...process.env, ...env }
      : process.env;

    const child = nodeSpawn(command, args, {
      cwd,
      env: mergedEnv,
      // Always capture output via pipe — we manually forward to parent if pipe=true
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Accumulate stdout and stderr
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      // Forward to parent stdout for live CI output
      if (pipe) {
        process.stdout.write(chunk);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      // Forward to parent stderr for live CI output
      if (pipe) {
        process.stderr.write(chunk);
      }
    });

    // Handle timeout — kill the process if it takes too long
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeout !== undefined && timeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        // Give process a grace period to clean up, then force kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5_000);
      }, timeout);
    }

    child.on('close', (code) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code,
      });
    });

    child.on('error', (err) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      reject(err);
    });
  });
}

/**
 * Spawn a shell command and capture its output.
 *
 * This is a convenience wrapper around `spawn` that runs the command
 * through the system shell, allowing pipes, redirects, and other shell features.
 *
 * @param command - Shell command string (e.g., "docker compose ps | grep healthy")
 * @param options - Spawn options (timeout, env, cwd, pipe)
 * @returns Promise resolving to captured stdout, stderr, and exit code
 */
export function spawnShell(
  command: string,
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  return spawn('/bin/sh', ['-c', command], options);
}
