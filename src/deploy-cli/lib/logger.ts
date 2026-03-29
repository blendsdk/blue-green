/**
 * Deploy CLI — Structured logger.
 *
 * Provides consistent, emoji-prefixed output for CI environments.
 * Designed for visual scanning in GitHub Actions logs where color
 * support varies but emoji always renders clearly.
 *
 * @module lib/logger
 */

import type { OperationResult } from '../types.ts';

/**
 * Structured logger with consistent formatting for CI output.
 *
 * Uses emoji prefixes for quick visual identification in GitHub Actions logs:
 * - ✅ Success / info messages
 * - ❌ Error messages
 * - ⚠️  Warning messages
 * - 🔄 Step progress markers
 * - 🖥️  Server status updates
 */
export const logger = {

  /**
   * Log an informational message with a success/info emoji.
   * Used for general progress updates and confirmations.
   *
   * @param msg - Message to display
   */
  info(msg: string): void {
    console.log(`✅ ${msg}`);
  },

  /**
   * Log an error message with an error emoji.
   * Used for failures and error conditions.
   *
   * @param msg - Error message to display
   */
  error(msg: string): void {
    console.error(`❌ ${msg}`);
  },

  /**
   * Log a warning message with a warning emoji.
   * Used for non-fatal issues that deserve attention.
   *
   * @param msg - Warning message to display
   */
  warn(msg: string): void {
    console.warn(`⚠️  ${msg}`);
  },

  /**
   * Log a numbered step in a sequence.
   * Used for multi-step operations to show progress.
   *
   * @param n - Step number or label (e.g., "1/5", "2.1")
   * @param msg - Description of the step
   */
  step(n: string, msg: string): void {
    console.log(`🔄 [${n}] ${msg}`);
  },

  /**
   * Log a server-specific status update.
   * Used during multi-server operations to track per-server progress.
   *
   * @param name - Server name (e.g., "acc-01")
   * @param status - Current status (start = beginning, ok = success, fail = error)
   * @param msg - Optional additional message
   */
  server(name: string, status: 'start' | 'ok' | 'fail', msg?: string): void {
    const icons: Record<string, string> = {
      start: '🖥️ ',
      ok: '✅',
      fail: '❌',
    };
    const icon = icons[status] ?? '🖥️ ';
    const suffix = msg ? ` — ${msg}` : '';
    console.log(`${icon} [${name}]${suffix}`);
  },

  /**
   * Print a summary of an operation across all servers.
   * Shows per-server results, total duration, and overall success/failure counts.
   *
   * @param result - Aggregated operation result
   */
  summary(result: OperationResult): void {
    const { operation, results, totalDuration, successCount, failCount } = result;
    const durationSec = (totalDuration / 1000).toFixed(1);

    console.log('');
    console.log(`━━━ ${operation} Summary ━━━`);
    console.log(`  Total: ${results.length} server(s) in ${durationSec}s`);
    console.log(`  Success: ${successCount}  |  Failed: ${failCount}`);

    // Show per-server results for transparency
    if (results.length > 0) {
      console.log('');
      for (const r of results) {
        const icon = r.success ? '✅' : '❌';
        const duration = (r.duration / 1000).toFixed(1);
        const errSuffix = r.error ? ` — ${r.error}` : '';
        console.log(`  ${icon} ${r.server.name} (${duration}s)${errSuffix}`);
      }
    }

    // Overall status line
    console.log('');
    if (failCount === 0) {
      console.log(`✅ ${operation} completed successfully`);
    } else {
      console.log(`❌ ${operation} failed on ${failCount} server(s)`);
    }
    console.log('');
  },
};
