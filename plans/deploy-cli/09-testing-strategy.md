# Testing Strategy

> **Document**: 09-testing-strategy.md
> **Parent**: [Index](00-index.md)

## Testing Overview

This project spans infrastructure code (bash, YAML), a TypeScript CLI, and real server deployments. Testing happens at three levels:

1. **Static validation** — syntax checks, type checks, lint
2. **Unit tests** — TypeScript CLI logic (config resolution, argument parsing)
3. **Integration tests** — real deploys to ScaffoldApp servers

### Coverage Goals

- Static validation: 100% (all files pass syntax checks)
- Unit tests: core library modules (config.ts, inventory.ts, argument parsing)
- Integration tests: all deployment scenarios tested on real servers

## Test Categories

### Static Validation

| What | Command | When |
|------|---------|------|
| TypeScript type checking | `npx tsc --noEmit` | After every CLI code change |
| esbuild bundle | `npm run build:cli` | After every CLI code change |
| Bash syntax | `bash -n deployment/scripts/remote-ops.sh` | After remote-ops changes |
| YAML validity | `docker compose config` (on scaffolded output) | After workflow/compose changes |
| Bundle runs | `node deployment/scripts/deploy-cli.js --help` | After every build |

### Unit Tests (TypeScript)

| Module | Test File | What It Tests |
|--------|-----------|---------------|
| `lib/config.ts` | `config.test.ts` | Read deploy-config.json, resolve entries per environment, extract env_defaults |
| `lib/inventory.ts` | `inventory.test.ts` | Read deploy-inventory.json, resolve servers with scope/filter, get SSH options |
| `index.ts` (parser) | `parser.test.ts` | Argument parsing: flags, positional command, defaults, missing required |
| `lib/logger.ts` | `logger.test.ts` | Output formatting (verify strings, not side effects) |

**Test runner:** Node.js built-in test runner (`node --test`) — zero dependency, available in Node 18+.

**Test location:** `src/deploy-cli/__tests__/`

**Example test structure:**

```typescript
// src/deploy-cli/__tests__/config.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, resolveConfigEntries, getEnvDefaults } from '../lib/config.js';

describe('readConfig', () => {
  it('reads deploy-config.json', () => {
    const config = readConfig('fixtures/deploy-config.json');
    assert.ok(config.configs.length > 0);
    assert.ok(config.environments.test);
  });
});

describe('resolveConfigEntries', () => {
  it('resolves {ENV} placeholder to environment prefix', () => {
    const config = readConfig('fixtures/deploy-config.json');
    const entries = resolveConfigEntries(config, 'acceptance');
    assert.equal(entries[0].resolvedSecretKey, 'ACC_ENV_FILE');
  });
});
```

### Integration Tests (ScaffoldApp)

See [08-scaffoldapp-migration.md](08-scaffoldapp-migration.md) for full test plan.

| Test | Type | Validates |
|------|------|-----------|
| Two-phase deploy to acceptance | E2E | Core problem fixed (no version inconsistency) |
| Operations workflow | E2E | All operations work through CLI |
| Single server deploy (test) | E2E | Backward compat for single-server |
| Rollback | E2E | Rollback works with two-phase |
| Scoped deploy | E2E | Scope/filter targeting works |
| Registry deploy | E2E | Build-once, pull-everywhere works |
| Registry rollback | E2E | Registry rollback works |

## Test Data / Fixtures

### deploy-config.json Fixture

```json
{
  "configs": [
    {
      "name": "Docker Environment",
      "secret_key": "{ENV}_ENV_FILE",
      "local_file": "local_data/{env}/.env",
      "deploy_path": ".env"
    }
  ],
  "environments": {
    "test": { "prefix": "TEST", "env_defaults": { "NGINX_HTTP_PORT": "8080" } },
    "acceptance": { "prefix": "ACC", "env_defaults": { "NGINX_HTTP_PORT": "8081" } }
  }
}
```

### deploy-inventory.json Fixture

```json
{
  "ssh_key_secret": "DEPLOY_SSH_KEY",
  "environments": {
    "test": {
      "access": "jump_host",
      "jump_host_secret": "JUMP_HOST",
      "servers": [
        { "name": "test-01", "host": "deploy@10.0.0.3", "group": "all" }
      ]
    },
    "acceptance": {
      "access": "jump_host",
      "jump_host_secret": "JUMP_HOST",
      "servers": [
        { "name": "acc-01", "host": "deploy@10.0.0.3", "group": "all" },
        { "name": "acc-02", "host": "deploy@10.0.0.4", "group": "all" }
      ]
    }
  }
}
```

## Verification Commands

### During Development (blue-green-template repo)

```bash
# TypeScript type check
npx tsc --noEmit

# Build CLI bundle
npm run build:cli

# Run unit tests
node --test src/deploy-cli/__tests__/*.test.ts

# Verify bundle runs
node scaffold/templates/deployment/scripts/deploy-cli.js --help

# Bash syntax check
bash -n scaffold/templates/deployment/scripts/remote-ops.sh
```

### During ScaffoldApp Migration

```bash
# Verify CLI works
node deployment/scripts/deploy-cli.js --help

# Verify remote-ops.sh syntax
bash -n deployment/scripts/remote-ops.sh

# Verify docker-compose config
cd deployment && docker compose config
```

## Verification Checklist

- [ ] TypeScript compiles without errors (`tsc --noEmit`)
- [ ] esbuild produces valid bundle (`npm run build:cli`)
- [ ] Bundle runs and shows help (`node deploy-cli.js --help`)
- [ ] All unit tests pass (`node --test`)
- [ ] `bash -n` passes on remote-ops.sh
- [ ] ScaffoldApp deploys successfully with CLI
- [ ] Two-phase deploy verified on acceptance (both servers)
- [ ] All operations work through CLI
- [ ] No regressions
