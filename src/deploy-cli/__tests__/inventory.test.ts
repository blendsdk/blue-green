/**
 * Unit tests for lib/inventory.ts — deploy-inventory.json reading and server resolution.
 *
 * Tests cover:
 * - Reading valid/invalid inventory files
 * - Server resolution with all scope types (all, group, tag, server)
 * - SSH options lookup
 * - Error handling for missing files, unknown environments, and invalid scopes
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DeployInventory } from '../types.ts';
import { readInventory, resolveServers, getSSHOptions } from '../lib/inventory.ts';

// Resolve fixture path relative to this test file
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'deploy-inventory.json');

/**
 * Build a minimal single-environment inventory with one server host.
 * Used by the ${VAR} specification tests to exercise resolution in isolation.
 */
function inventoryWithHost(host: string): DeployInventory {
  return {
    ssh_key_secret: 'SSH_PRIVATE_KEY',
    environments: {
      acceptance: {
        access: 'direct',
        servers: [{ name: 'acc-01', host, group: 'all' }],
      },
    },
  };
}

// ── readInventory ───────────────────────────────────────

describe('readInventory', () => {
  it('should read and parse a valid inventory file', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.equal(inventory.ssh_key_secret, 'SSH_PRIVATE_KEY');
    assert.ok(typeof inventory.environments === 'object');
  });

  it('should have all three environments', () => {
    const inventory = readInventory(FIXTURE_PATH);

    const envNames = Object.keys(inventory.environments);
    assert.deepEqual(envNames.sort(), ['acceptance', 'production', 'test']);
  });

  it('should throw on missing file', () => {
    assert.throws(
      () => readInventory('/nonexistent/path/deploy-inventory.json'),
      (err: Error) => {
        assert.ok(err.message.includes('Inventory file not found'));
        return true;
      },
    );
  });
});

// ── resolveServers — scope: all ─────────────────────────

describe('resolveServers — scope: all', () => {
  it('should return all servers in test environment', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'test', 'all');

    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, 'test-01');
  });

  it('should return all servers in acceptance environment', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'acceptance', 'all');

    assert.equal(servers.length, 3);
    const names = servers.map(s => s.name);
    assert.ok(names.includes('acc-01'));
    assert.ok(names.includes('acc-02'));
    assert.ok(names.includes('acc-api-01'));
  });

  it('should return all servers in production environment', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'production', 'all');

    assert.equal(servers.length, 3);
  });
});

// ── resolveServers — scope: group ───────────────────────

describe('resolveServers — scope: group', () => {
  it('should filter by group name', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'acceptance', 'group', 'web');

    assert.equal(servers.length, 2);
    assert.ok(servers.every(s => s.group === 'web'));
  });

  it('should filter api group', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'acceptance', 'group', 'api');

    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, 'acc-api-01');
  });

  it('should throw when no servers match group', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => resolveServers(inventory, 'acceptance', 'group', 'nonexistent'),
      (err: Error) => {
        assert.ok(err.message.includes('No servers found in group'));
        assert.ok(err.message.includes('Available groups'));
        return true;
      },
    );
  });

  it('should throw when filter is missing for group scope', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => resolveServers(inventory, 'acceptance', 'group'),
      (err: Error) => {
        assert.ok(err.message.includes('--filter is required'));
        return true;
      },
    );
  });
});

// ── resolveServers — scope: tag ─────────────────────────

describe('resolveServers — scope: tag', () => {
  it('should filter by tag', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'production', 'tag', 'eu-west');

    // All 3 production servers have the eu-west tag
    assert.equal(servers.length, 3);
  });

  it('should filter by primary tag', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'production', 'tag', 'primary');

    // Only prod-01 has the primary tag
    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, 'prod-01');
  });

  it('should filter acceptance servers by tag', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'acceptance', 'tag', 'primary');

    // Only acc-api-01 has the primary tag
    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, 'acc-api-01');
  });

  it('should throw when no servers match tag', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => resolveServers(inventory, 'test', 'tag', 'eu-west'),
      (err: Error) => {
        assert.ok(err.message.includes('No servers found with tag'));
        return true;
      },
    );
  });

  it('should throw when filter is missing for tag scope', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => resolveServers(inventory, 'production', 'tag'),
      (err: Error) => {
        assert.ok(err.message.includes('--filter is required'));
        return true;
      },
    );
  });
});

// ── resolveServers — scope: server ──────────────────────

describe('resolveServers — scope: server', () => {
  it('should find a single server by name', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const servers = resolveServers(inventory, 'acceptance', 'server', 'acc-01');

    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, 'acc-01');
    assert.equal(servers[0]?.host, 'deploy@10.0.2.10');
  });

  it('should throw when server name not found', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => resolveServers(inventory, 'acceptance', 'server', 'nonexistent'),
      (err: Error) => {
        assert.ok(err.message.includes('Server "nonexistent" not found'));
        assert.ok(err.message.includes('Available servers'));
        return true;
      },
    );
  });

  it('should throw when filter is missing for server scope', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => resolveServers(inventory, 'acceptance', 'server'),
      (err: Error) => {
        assert.ok(err.message.includes('--filter is required'));
        return true;
      },
    );
  });
});

// ── resolveServers — error cases ────────────────────────

describe('resolveServers — error cases', () => {
  it('should throw on unknown environment', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => resolveServers(inventory, 'staging', 'all'),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown environment'));
        assert.ok(err.message.includes('staging'));
        return true;
      },
    );
  });

  it('should throw on invalid scope', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => resolveServers(inventory, 'test', 'invalid-scope'),
      (err: Error) => {
        assert.ok(err.message.includes('Invalid scope'));
        assert.ok(err.message.includes('Valid scopes'));
        return true;
      },
    );
  });
});

// ── getSSHOptions ───────────────────────────────────────

describe('getSSHOptions', () => {
  it('should return SSH key secret name', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const opts = getSSHOptions(inventory, 'test');

    assert.equal(opts.keySecretName, 'SSH_PRIVATE_KEY');
  });

  it('should return jump host secret for acceptance', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const opts = getSSHOptions(inventory, 'acceptance');

    assert.equal(opts.keySecretName, 'SSH_PRIVATE_KEY');
    assert.equal(opts.jumpHostSecret, 'JUMP_HOST');
  });

  it('should return undefined jumpHostSecret for direct access', () => {
    const inventory = readInventory(FIXTURE_PATH);
    const opts = getSSHOptions(inventory, 'test');

    assert.equal(opts.jumpHostSecret, undefined);
  });

  it('should throw on unknown environment', () => {
    const inventory = readInventory(FIXTURE_PATH);

    assert.throws(
      () => getSSHOptions(inventory, 'nonexistent'),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown environment'));
        return true;
      },
    );
  });
});

// ── Specification: ${VAR} host resolution ───────────────
// Source: 07-testing-strategy.md ST-14..ST-17 (FR-1, FR-2, FR-3, AR #8, AR #9)
// Inventory hosts support ${VAR} substitution resolved from a context of
// process.env plus the injected ${env} (environment name). The ${ENV} prefix
// is intentionally NOT available in the inventory (AR #9).

describe('Specification: resolveServers ${VAR} host resolution', () => {
  // Source: ST-14 (FR-1, FR-2, AR #9) — env-var host resolves from process.env
  it('should resolve a ${VAR} host from process.env', () => {
    process.env['ACC_HOST'] = '10.0.0.9';
    try {
      const inventory = inventoryWithHost('deploy@${ACC_HOST}');
      const servers = resolveServers(inventory, 'acceptance', 'all');
      assert.equal(servers[0]?.host, 'deploy@10.0.0.9');
    } finally {
      delete process.env['ACC_HOST'];
    }
  });

  // Source: ST-15 (FR-4) — static host (no token) passes through unchanged
  it('should leave a static host (no token) unchanged', () => {
    const inventory = inventoryWithHost('deploy@10.0.2.10');
    const servers = resolveServers(inventory, 'acceptance', 'all');
    assert.equal(servers[0]?.host, 'deploy@10.0.2.10');
  });

  // Source: ST-16 (FR-3, AR #8) — missing variable is a hard error
  it('should throw naming the variable when a ${VAR} host is unset', () => {
    delete process.env['MISSING_HOST'];
    const inventory = inventoryWithHost('deploy@${MISSING_HOST}');
    assert.throws(
      () => resolveServers(inventory, 'acceptance', 'all'),
      (err: Error) => {
        assert.ok(err.message.includes('MISSING_HOST'), `Expected 'MISSING_HOST' in: ${err.message}`);
        return true;
      },
    );
  });

  // Source: ST-17 (FR-2, AR #9) — injected ${env} resolves to the environment name
  it('should resolve the injected ${env} to the environment name', () => {
    const inventory = inventoryWithHost('deploy@${env}-host');
    const servers = resolveServers(inventory, 'acceptance', 'all');
    assert.equal(servers[0]?.host, 'deploy@acceptance-host');
  });
});
