/**
 * Unit tests for lib/config.ts — deploy-config.json reading and resolution.
 *
 * Tests cover:
 * - Reading valid/invalid config files
 * - Resolving config entries with placeholder expansion
 * - Environment defaults lookup
 * - Error handling for missing files and unknown environments
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig, resolveConfigEntries, getEnvDefaults } from '../lib/config.ts';

// Resolve fixture path relative to this test file
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'deploy-config.json');

// ── readConfig ──────────────────────────────────────────

describe('readConfig', () => {
  it('should read and parse a valid config file', () => {
    const config = readConfig(FIXTURE_PATH);

    // Verify top-level structure
    assert.ok(Array.isArray(config.configs), 'configs should be an array');
    assert.ok(typeof config.environments === 'object', 'environments should be an object');

    // Verify expected data from fixture
    assert.equal(config.configs.length, 2, 'should have 2 config entries');
    assert.equal(config.configs[0]?.name, 'Docker Environment');
    assert.equal(config.configs[1]?.name, 'App Config');
  });

  it('should have all three environments', () => {
    const config = readConfig(FIXTURE_PATH);

    const envNames = Object.keys(config.environments);
    assert.deepEqual(envNames.sort(), ['acceptance', 'production', 'test']);
  });

  it('should throw on missing file', () => {
    assert.throws(
      () => readConfig('/nonexistent/path/deploy-config.json'),
      (err: Error) => {
        assert.ok(err.message.includes('Config file not found'), `Expected 'Config file not found' in: ${err.message}`);
        return true;
      },
    );
  });
});

// ── resolveConfigEntries ────────────────────────────────

describe('resolveConfigEntries', () => {
  it('should resolve {ENV} placeholder with uppercase prefix for acceptance', () => {
    const config = readConfig(FIXTURE_PATH);
    const entries = resolveConfigEntries(config, 'acceptance');

    assert.equal(entries.length, 2);

    // First entry: Docker Environment
    assert.equal(entries[0]?.secretKey, 'ACC_ENV_FILE', '{ENV} should be replaced with ACC');
    assert.equal(entries[0]?.localFile, 'local_data/acceptance/.env', '{env} should be replaced with acceptance');
    assert.equal(entries[0]?.deployPath, '.env');

    // Second entry: App Config
    assert.equal(entries[1]?.secretKey, 'ACC_APP_CONFIG');
    assert.equal(entries[1]?.localFile, 'local_data/acceptance/app-config.json');
  });

  it('should resolve placeholders for test environment', () => {
    const config = readConfig(FIXTURE_PATH);
    const entries = resolveConfigEntries(config, 'test');

    assert.equal(entries[0]?.secretKey, 'TEST_ENV_FILE');
    assert.equal(entries[0]?.localFile, 'local_data/test/.env');
  });

  it('should resolve placeholders for production environment', () => {
    const config = readConfig(FIXTURE_PATH);
    const entries = resolveConfigEntries(config, 'production');

    assert.equal(entries[0]?.secretKey, 'PROD_ENV_FILE');
    assert.equal(entries[0]?.localFile, 'local_data/production/.env');
  });

  it('should preserve deploy_path unchanged', () => {
    const config = readConfig(FIXTURE_PATH);
    const entries = resolveConfigEntries(config, 'acceptance');

    // deploy_path has no placeholders — should pass through unchanged
    assert.equal(entries[0]?.deployPath, '.env');
    assert.equal(entries[1]?.deployPath, 'app-config.json');
  });

  it('should preserve human-readable name', () => {
    const config = readConfig(FIXTURE_PATH);
    const entries = resolveConfigEntries(config, 'acceptance');

    assert.equal(entries[0]?.name, 'Docker Environment');
    assert.equal(entries[1]?.name, 'App Config');
  });

  it('should throw on unknown environment', () => {
    const config = readConfig(FIXTURE_PATH);

    assert.throws(
      () => resolveConfigEntries(config, 'staging'),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown environment'), `Expected 'Unknown environment' in: ${err.message}`);
        assert.ok(err.message.includes('staging'), 'Should include the invalid environment name');
        assert.ok(err.message.includes('test'), 'Should list available environments');
        return true;
      },
    );
  });
});

// ── getEnvDefaults ──────────────────────────────────────

describe('getEnvDefaults', () => {
  it('should return env_defaults for acceptance', () => {
    const config = readConfig(FIXTURE_PATH);
    const defaults = getEnvDefaults(config, 'acceptance');

    assert.equal(defaults['NGINX_HTTP_PORT'], '8081');
    assert.equal(defaults['DOZZLE_PORT'], '9981');
  });

  it('should return env_defaults for test', () => {
    const config = readConfig(FIXTURE_PATH);
    const defaults = getEnvDefaults(config, 'test');

    assert.equal(defaults['NGINX_HTTP_PORT'], '8080');
    assert.equal(defaults['DOZZLE_PORT'], '9980');
  });

  it('should return env_defaults for production', () => {
    const config = readConfig(FIXTURE_PATH);
    const defaults = getEnvDefaults(config, 'production');

    assert.equal(defaults['NGINX_HTTP_PORT'], '8082');
    assert.equal(defaults['DOZZLE_PORT'], '9982');
  });

  it('should throw on unknown environment', () => {
    const config = readConfig(FIXTURE_PATH);

    assert.throws(
      () => getEnvDefaults(config, 'nonexistent'),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown environment'));
        return true;
      },
    );
  });
});
