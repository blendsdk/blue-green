# Current State: Inventory & Config Env-Var Substitution

> **Document**: 02-current-state.md
> **Parent**: [Index](00-index.md)

## Existing Implementation

### What Exists

**`deploy-config.json` placeholders (bespoke syntax).** `lib/config.ts`
`resolveConfigEntries()` does two literal `.replace()` calls:

```ts
secretKey: entry.secret_key.replace('{ENV}', envConfig.prefix),
localFile: entry.local_file.replace('{env}', environment),
```

Only these two fields are templated, only the first occurrence is replaced, and
the syntax (`{ENV}` / `{env}`) is unique to this file.

**`deploy-inventory.json` — no substitution.** `lib/inventory.ts`
`readInventory()` is a plain `JSON.parse`. `resolveServers()` returns
`ServerEntry` objects verbatim. The `host` field flows directly into
`sshExec(sshConfig, server.host, …)` / `scpUpload(...)` across every command
(`prepare`, `switch`, `deploy`, `upload`, `deploy-config`, `operate`). A
`${VAR}` written in a host would be passed literally to SSH and fail.

### Relevant Files

| File | Purpose | Changes Needed |
| ---- | ------- | -------------- |
| `src/deploy-cli/lib/config.ts` | Config read + `{ENV}`/`{env}` resolve | Replace bespoke resolve with shared `${VAR}` resolver |
| `src/deploy-cli/lib/inventory.ts` | Inventory read + server resolution | Run shared resolver after parse |
| `src/deploy-cli/types.ts` | Type defs + JSDoc | Update `host`/field JSDoc |
| `scaffold/scaffold.js` | Generator | `generateDeployConfig` syntax; `generateDeployInventory` topology branch; always add inventory to file list |
| `scaffold/templates/deploy-config.json` | Config template | `{ENV}`/`{env}` → `${ENV}`/`${env}` |
| `scaffold/templates/deploy-inventory.json` | Inventory template | Add `${VAR}` example comment |
| `scaffold/templates/.github/workflows/release-single.yml` | Single release | project-name + deploy target |
| `scaffold/templates/.github/workflows/release-multi.yml` | Multi release | project-name + deploy target |
| `scaffold/templates/deployment/scripts/deploy-cli.js` | Bundled CLI | Rebuild via esbuild |
| `README.md` | Root docs | Document `${VAR}`, project-name, inventory |
| `scaffold/templates/.github/SECRETS-SETUP.md` | Secrets docs | Document `${VAR}` config format |

### Code Analysis

`scaffold.js` `buildFileList()` only adds the inventory under multi topology:

```js
// --- Inventory (only if multi) ---
if (answers.topology === 'multi') {
  add('deploy-inventory.json', 'deploy-inventory.json');
}
```

But `commands/shared.ts` `resolveTargetServers()` calls `readInventory()` on
EVERY command path, including single-server. So a single-server generated
project has no `deploy-inventory.json` and every deploy command throws
"Inventory file not found".

`release-single.yml` upload step:
```yaml
--project-name {{PROJECT_NAME_LOWER}} {{UPLOAD_STRATEGY_FLAG}}
```
`projectName` flows only into `upload.ts` `setEnvVariables()`, which writes
`COMPOSE_PROJECT_NAME` to the remote `.env`. `deploy`/`prepare`/`switch` read it
back from that `.env`. Therefore fixing only the upload step is sufficient to
give each environment its own Compose namespace.

## Gaps Identified

### Gap 1: Inventory has no substitution
**Current:** host is a literal string. **Required:** `${VAR}` resolved from env.
**Fix:** shared resolver in `readInventory()`. (FR-1, FR-2)

### Gap 2: Two templating syntaxes
**Current:** config uses `{ENV}`/`{env}`; nothing else templates. **Required:**
one `${VAR}` syntax everywhere. **Fix:** remove bespoke replace; inject
`ENV`/`env` into context. (FR-5)

### Gap 3: Inventory not generated for single topology
**Current:** single-server projects break at runtime. **Required:** always
generate. **Fix:** move `add(...)` out of the `multi` guard; branch
`generateDeployInventory`. (FR-6, FR-7)

### Gap 4: Project name shares namespace across environments
**Current:** `COMPOSE_PROJECT_NAME` identical for all targets. **Required:**
per-target. **Fix:** append `-${{ inputs.deploy_target }}`. (FR-8)

### Gap 5: No user docs
**Fix:** README + SECRETS-SETUP. (FR-10)

## Dependencies

### Internal Dependencies
- `lib/config.ts` and `lib/inventory.ts` both depend on the new
  `lib/env-resolve.ts`.
- The bundle (`deploy-cli.js`) depends on all `src/deploy-cli` changes — rebuilt
  last.

### External Dependencies
- esbuild (already configured) for the bundle rebuild.
- Node test runner (already used) for spec/impl tests.

## Risks and Concerns

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Breaking existing config consumers | Low | Med | No current consumers (AR #4); documented breaking change |
| `${VAR}` false-match on literal `$` | Low | Low | Braced-only syntax (AR #7); no escape needed (AR #12) |
| Forgetting to rebuild bundle | Med | High | Explicit task + verify step in execution plan |
| Resolver touches `*_secret` name fields | Low | Med | Those fields contain no `${...}`, so resolver leaves them untouched |
