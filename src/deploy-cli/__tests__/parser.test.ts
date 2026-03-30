/**
 * Unit tests for the argument parser in index.ts.
 *
 * Tests cover:
 * - Command extraction from positional args
 * - Named option parsing (--flag value)
 * - Boolean flag parsing (--dry-run, --help, --version)
 * - Extra arguments after "--" separator
 * - Edge cases (empty args, unknown flags, mixed args)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from '../index.ts';

// ── Command Parsing ─────────────────────────────────────

describe('parseArgs — command', () => {
  it('should extract the command from first positional arg', () => {
    const result = parseArgs(['deploy', '--env', 'acceptance']);

    assert.equal(result.command, 'deploy');
  });

  it('should handle command-only input', () => {
    const result = parseArgs(['status']);

    assert.equal(result.command, 'status');
    assert.deepEqual(result.options, {});
    assert.deepEqual(result.extraArgs, []);
  });

  it('should return empty command for empty args', () => {
    const result = parseArgs([]);

    assert.equal(result.command, '');
    assert.deepEqual(result.options, {});
    assert.deepEqual(result.extraArgs, []);
  });
});

// ── Named Options ───────────────────────────────────────

describe('parseArgs — named options', () => {
  it('should parse --flag value pairs', () => {
    const result = parseArgs(['deploy', '--env', 'acceptance', '--scope', 'all']);

    assert.equal(result.options['env'], 'acceptance');
    assert.equal(result.options['scope'], 'all');
  });

  it('should parse multiple options', () => {
    const result = parseArgs([
      'upload',
      '--env', 'production',
      '--scope', 'group',
      '--filter', 'web',
      '--deploy-path', '/opt/myapp',
      '--project-name', 'myapp',
    ]);

    assert.equal(result.command, 'upload');
    assert.equal(result.options['env'], 'production');
    assert.equal(result.options['scope'], 'group');
    assert.equal(result.options['filter'], 'web');
    assert.equal(result.options['deploy-path'], '/opt/myapp');
    assert.equal(result.options['project-name'], 'myapp');
  });

  it('should handle options before the command', () => {
    // When --help comes first, it should be parsed as an option
    // and "deploy" would become the command
    const result = parseArgs(['--help']);

    assert.equal(result.command, '');
    assert.equal(result.options['help'], 'true');
  });

  it('should handle flag without a value as boolean', () => {
    // Unknown flags without a value get treated as boolean
    const result = parseArgs(['deploy', '--verbose']);

    assert.equal(result.options['verbose'], 'true');
  });

  it('should not consume next flag as value', () => {
    // When a flag is followed by another flag, both should be parsed independently
    const result = parseArgs(['deploy', '--verbose', '--env', 'test']);

    assert.equal(result.options['verbose'], 'true');
    assert.equal(result.options['env'], 'test');
  });
});

// ── Boolean Flags ───────────────────────────────────────

describe('parseArgs — boolean flags', () => {
  it('should parse --dry-run as boolean', () => {
    const result = parseArgs(['deploy', '--dry-run', '--env', 'test']);

    assert.equal(result.options['dry-run'], 'true');
    assert.equal(result.options['env'], 'test');
  });

  it('should parse --help as boolean', () => {
    const result = parseArgs(['--help']);

    assert.equal(result.options['help'], 'true');
  });

  it('should parse --version as boolean', () => {
    const result = parseArgs(['--version']);

    assert.equal(result.options['version'], 'true');
  });

  it('should not consume next arg for boolean flags', () => {
    // --dry-run is a known boolean flag — the next arg should NOT be consumed as its value
    const result = parseArgs(['deploy', '--dry-run', 'extra-arg']);

    assert.equal(result.options['dry-run'], 'true');
    // 'deploy' is the command, 'extra-arg' after a boolean flag becomes an extra arg
    assert.equal(result.command, 'deploy');
    assert.deepEqual(result.extraArgs, ['extra-arg']);
  });
});

// ── Extra Arguments ─────────────────────────────────────

describe('parseArgs — extra arguments after "--"', () => {
  it('should collect everything after "--" as extra args', () => {
    const result = parseArgs([
      'operate',
      '--env', 'test',
      '--op', 'view-logs',
      '--', '500',
    ]);

    assert.equal(result.command, 'operate');
    assert.equal(result.options['env'], 'test');
    assert.equal(result.options['op'], 'view-logs');
    assert.deepEqual(result.extraArgs, ['500']);
  });

  it('should collect multiple extra args', () => {
    const result = parseArgs([
      'operate',
      '--env', 'test',
      '--', '--tail', '100', '--follow',
    ]);

    assert.deepEqual(result.extraArgs, ['--tail', '100', '--follow']);
  });

  it('should not parse flags after "--"', () => {
    // Everything after "--" is literal — "--env" should NOT be parsed as a flag
    const result = parseArgs([
      'operate',
      '--', '--env', 'test',
    ]);

    assert.equal(result.options['env'], undefined);
    assert.deepEqual(result.extraArgs, ['--env', 'test']);
  });

  it('should handle "--" with no extra args', () => {
    const result = parseArgs(['deploy', '--env', 'test', '--']);

    assert.equal(result.command, 'deploy');
    assert.deepEqual(result.extraArgs, []);
  });
});

// ── Registry Options ────────────────────────────────────

describe('parseArgs — registry options', () => {
  it('should parse registry-specific flags', () => {
    const result = parseArgs([
      'registry',
      '--registry-url', 'localhost:5000',
      '--image-name', 'myapp',
      '--tag', '20260330120000',
    ]);

    assert.equal(result.command, 'registry');
    assert.equal(result.options['registry-url'], 'localhost:5000');
    assert.equal(result.options['image-name'], 'myapp');
    assert.equal(result.options['tag'], '20260330120000');
  });
});

// ── Edge Cases ──────────────────────────────────────────

describe('parseArgs — edge cases', () => {
  it('should handle the "help" command as a positional arg', () => {
    const result = parseArgs(['help']);

    assert.equal(result.command, 'help');
  });

  it('should handle max-parallel as a value flag', () => {
    const result = parseArgs(['deploy', '--max-parallel', '5']);

    assert.equal(result.options['max-parallel'], '5');
  });

  it('should handle strategy flag', () => {
    const result = parseArgs(['deploy', '--strategy', 'registry']);

    assert.equal(result.options['strategy'], 'registry');
  });
});
