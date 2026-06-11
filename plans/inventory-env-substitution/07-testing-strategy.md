# Testing Strategy: Inventory & Config Env-Var Substitution

> **Document**: 07-testing-strategy.md
> **Parent**: [Index](00-index.md)

## Testing Overview

The Deploy CLI uses the Node.js built-in test runner (`node:test`) run via
`npm run test:cli`. Tests live in `src/deploy-cli/__tests__/`. This feature adds
specification tests for the new resolver and updates existing config/inventory
tests for the new syntax.

### Coverage Goals

- Resolver (`env-resolve.ts`) — 90%+ (core shared utility).
- Config/inventory integration — all `${VAR}` paths covered.

## 🚨 Specification Test Cases (MANDATORY)

> Derived exclusively from `01-requirements.md`, `03-env-resolver.md`, and the
> Ambiguity Register. These define expected behavior BEFORE implementation and
> are immutable oracles.

### Resolver — `resolveString` / `resolvePlaceholders`

| # | Input / Scenario | Expected Output / Behavior | Source |
|---|-----------------|---------------------------|--------|
| ST-1 | `resolveString('deploy@host', {})` (no token) | returns `'deploy@host'` unchanged | FR-4, AR #3 |
| ST-2 | `resolveString('deploy@${H}', { H: '1.2.3.4' })` | returns `'deploy@1.2.3.4'` | FR-1, FR-2 |
| ST-3 | `resolveString('${U}@${H}', { U: 'deploy', H: 'x' })` | returns `'deploy@x'` (multiple) | FR-1 |
| ST-4 | `resolveString('a${X}b${X}c', { X: '-' })` | returns `'a-b-c'` (repeated var) | FR-1 |
| ST-5 | `resolveString('${MISSING}', {})` | throws Error naming `MISSING` | FR-3, AR #8 |
| ST-6 | `resolveString('${EMPTY}', { EMPTY: '' })` | throws Error naming `EMPTY` | FR-3, AR #8 |
| ST-7 | `resolveString('$HOST', { HOST: 'x' })` (bare) | returns `'$HOST'` unchanged (braced-only) | AR #7 |
| ST-8 | `resolvePlaceholders({ a: '${X}', b: 2 }, { X: 'v' })` | returns `{ a: 'v', b: 2 }` (scalars pass) | FR-1, FR-4 |
| ST-9 | `resolvePlaceholders({ tags: ['${R}', 's'] }, { R: 'eu' })` | returns `{ tags: ['eu', 's'] }` (array) | FR-1 |
| ST-10 | `resolvePlaceholders({ '${K}': 'v' }, { K: 'x' })` | key unchanged → `{ '${K}': 'v' }` (keys not substituted) | FR-1, AR #3 |

### Config integration — `resolveConfigEntries`

| # | Input / Scenario | Expected Output / Behavior | Source |
|---|-----------------|---------------------------|--------|
| ST-11 | acceptance config, `secret_key: '${ENV}_ENV_FILE'` | resolves to `'ACC_ENV_FILE'` | FR-5, AR #1 |
| ST-12 | acceptance config, `local_file: 'local_data/${env}/.env'` | resolves to `'local_data/acceptance/.env'` | FR-5, AR #1 |
| ST-13 | config referencing unknown env name | throws "Unknown environment" (existing behavior preserved) | FR-5 |

### Inventory integration — `resolveServers`

| # | Input / Scenario | Expected Output / Behavior | Source |
|---|-----------------|---------------------------|--------|
| ST-14 | host `'deploy@${ACC_HOST}'`, env `ACC_HOST=10.0.0.9` | resolved server host = `'deploy@10.0.0.9'` | FR-1, FR-2, AR #9 |
| ST-15 | static host `'deploy@10.0.2.10'` (no token) | unchanged | FR-4 |
| ST-16 | host `'deploy@${MISSING_HOST}'`, var unset | throws Error naming `MISSING_HOST` | FR-3, AR #8 |
| ST-17 | host `'deploy@${env}-host'`, env `acceptance` | resolves to `'deploy@acceptance-host'` (`${env}` injected) | FR-2, AR #9 |

## Test Categories

### Specification Tests (from ST-cases)

> Written BEFORE implementation. Verified to fail (red) before resolver exists.

| Test File | ST Cases Covered | Component |
| --------- | ---------------- | --------- |
| `env-resolve.spec.test.ts` | ST-1 .. ST-10 | Resolver |
| `config.test.ts` (updated) | ST-11 .. ST-13 | Config integration |
| `inventory.test.ts` (updated) | ST-14 .. ST-17 | Inventory integration |

### Implementation Tests (edge cases)

| Test File | Description | Priority |
| --------- | ----------- | -------- |
| `env-resolve.impl.test.ts` | adjacent tokens `${A}${B}`, underscore/digit var names, deeply nested objects, empty object/array | Med |

### Validation (non-code)

| What | Command |
|------|---------|
| Scaffold generates inventory for single topology + `${ENV}` config | `bash scripts/verify-scaffold-output.sh` (temp-dir generate + asserts) |
| remote-ops.sh still syntactically valid | `bash -n scaffold/templates/deployment/scripts/remote-ops.sh` |
| No old `{ENV}`/`{env}` syntax remains | repo-wide grep check |
| Bundle rebuilt | `npm run build:cli` then assert `deploy-cli.js` contains resolver marker |

## Test Data / Fixtures

- Update `__tests__/fixtures/deploy-config.json` to `${ENV}`/`${env}`.
- Inventory tests set/clean `process.env` vars around each case (no fixture
  change required, or add a `${VAR}` host to the fixture used only by new tests).

## Verification Checklist

- [ ] All ST cases defined with concrete input/output (done above)
- [ ] Spec tests written before implementation
- [ ] Spec tests fail before implementation (red phase)
- [ ] Spec tests pass after implementation (green phase)
- [ ] Impl tests written for edge cases
- [ ] `npm run verify` passes
- [ ] `bash -n` passes on remote-ops.sh
- [ ] No `{ENV}`/`{env}` old-syntax remains
- [ ] Bundle rebuilt
