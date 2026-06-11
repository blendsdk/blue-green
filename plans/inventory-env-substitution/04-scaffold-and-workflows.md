# Scaffold & Workflows: Inventory-Always, Project-Name, Template Migration

> **Document**: 04-scaffold-and-workflows.md
> **Parent**: [Index](00-index.md)

## Overview

Three scaffold/workflow changes: (1) always generate `deploy-inventory.json` with
a topology-aware body, (2) migrate the generated `deploy-config.json` to the
`${ENV}` / `${env}` syntax, and (3) put the deploy target into the release
project name.

## Change 1: Always generate the inventory (FR-6, FR-7, AR #6, AR #10)

### `buildFileList()`

Move the inventory out of the `multi` guard so it is always added:

```js
// --- Config files (always) ---
add('deploy-config.json', 'deploy-config.json');
add('deploy-inventory.json', 'deploy-inventory.json');   // always (was multi-only)
```

### `generateDeployInventory(answers)` — topology branch

```js
function generateDeployInventory(answers) {
  if (answers.topology === 'single') {
    // One server per environment, direct access (AR #10). ${VAR} hosts let users
    // keep real addresses out of git (resolved from CI secrets at deploy time).
    return JSON.stringify({
      ssh_key_secret: 'DEPLOY_SSH_KEY',
      environments: {
        test:       { access: 'direct', servers: [ { name: 'test-01', host: 'deploy@${TEST_HOST}', group: 'all' } ] },
        acceptance: { access: 'direct', servers: [ { name: 'acc-01',  host: 'deploy@${ACC_HOST}',  group: 'all' } ] },
        production: { access: 'direct', servers: [ { name: 'prod-01', host: 'deploy@${PROD_HOST}', group: 'all' } ] },
      },
    }, null, 2) + '\n';
  }
  // multi — existing multi-server example (unchanged shape)
  return JSON.stringify({ /* existing multi structure */ }, null, 2) + '\n';
}
```

> The `generateAllFiles()` special-case already routes `deploy-inventory.json`
> through `generateDeployInventory(answers)`, so no change is needed there beyond
> the file-list addition.

## Change 2: Migrate config to `${ENV}` / `${env}` (FR-9, AR #1)

### `generateDeployConfig(answers)`

```js
configs: [
  { name: 'Docker Environment', secret_key: '${ENV}_ENV_FILE',
    local_file: 'local_data/${env}/.env', deploy_path: '.env' },
  { name: 'App Config', secret_key: '${ENV}_APP_CONFIG',
    local_file: 'local_data/${env}/app-config.json', deploy_path: 'app-config.json' },
],
```

> **Note:** the inline `environments` map in `generateDeployConfig()` currently
> emits `{ test: 'TEST', ... }`, but the template
> `scaffold/templates/deploy-config.json` emits the richer
> `{ prefix, env_defaults }` shape that the CLI actually consumes. The generator
> path is the source of truth used by `generateAllFiles()`. **Implementation
> note:** align `generateDeployConfig()` to emit the same `{ prefix, env_defaults }`
> shape as the template so generated projects match the CLI's `EnvironmentConfig`
> type. (Pre-existing inconsistency surfaced during planning — fixing it here is
> in-scope since we are already editing this function.)

### `scaffold/templates/deploy-config.json`

Replace `{ENV}` → `${ENV}` and `{env}` → `${env}` in the two `configs` entries.
The `environments` block (prefix + env_defaults) is unchanged.

## Change 3: Release project name per target (FR-8, AR #5)

### `release-single.yml` and `release-multi.yml`

In the upload step only (the sole consumer of `--project-name`):

```yaml
--project-name {{PROJECT_NAME_LOWER}}-${{ inputs.deploy_target }} {{UPLOAD_STRATEGY_FLAG}}
```

This yields a distinct `COMPOSE_PROJECT_NAME` per environment
(e.g. `myapp-acceptance`, `myapp-production`), isolating Docker Compose
resources between environments on a shared host.

## Change 4: Inventory template `${VAR}` example (SR-1)

Add a commented example near the top of
`scaffold/templates/deploy-inventory.json` showing a `${VAR}` host, so users
discover the feature. (JSON has no comments, so this is a `_comment` key or a
documented example in SECRETS-SETUP — see docs doc. To keep the file valid JSON
and avoid a stray key, the discoverability example lives in
`SECRETS-SETUP.md` and `README.md` rather than inside the JSON.)

> **Decision refinement:** the `${VAR}` example is documented in `README.md` and
> `SECRETS-SETUP.md` (Change in `05-docs.md`) instead of inside the JSON file, so
> the generated `deploy-inventory.json` remains strict, comment-free JSON.

## Error Handling

| Error Case | Handling Strategy | AR Ref |
| ---------- | ----------------- | ------ |
| User runs single-server deploy with unset `${*_HOST}` | Resolver hard-errors naming the var (from `03-env-resolver.md`) | AR #8 |
| Existing project already has inventory | scaffold conflict detection skips it unless `--force` (existing behavior) | — |

## Testing Requirements

- `scaffold.js` is validated by generating into a temp dir and asserting the
  inventory exists for single topology and config uses `${ENV}`/`${env}` (covered
  via a verify script; see testing strategy).
- Workflow YAML is syntax-only; validated by inspection + `git diff` review.
