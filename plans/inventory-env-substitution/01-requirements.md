# Requirements: Inventory & Config Env-Var Substitution

> **Document**: 01-requirements.md
> **Parent**: [Index](00-index.md)

## Feature Overview

Provide a single, uniform `${VAR}` substitution mechanism for every string value
in the Deploy CLI's two JSON config files (`deploy-inventory.json` and
`deploy-config.json`), remove the legacy `{ENV}` / `{env}` syntax, and fix three
related defects in scaffold generation, the release workflow, and user docs.

## Functional Requirements

### Must Have

- [ ] **FR-1** A shared resolver replaces `${VAR}` tokens in any string value,
  recursively across objects and arrays. (AR #3, AR #7)
- [ ] **FR-2** `${VAR}` resolves from a context object. For `deploy-config.json`
  the context is `{ ...process.env, ENV: <prefix>, env: <environment> }`. For
  `deploy-inventory.json` the context is `{ ...process.env, env: <environment> }`.
  (AR #2, AR #9)
- [ ] **FR-3** A referenced variable that is missing or empty causes a hard error
  naming the variable; the operation aborts. (AR #8)
- [ ] **FR-4** Strings containing no `${...}` token are returned unchanged
  (static values keep working). (AR #3)
- [ ] **FR-5** The legacy `{ENV}` / `{env}` replacement in `config.ts` is removed;
  `deploy-config.json` uses `${ENV}` / `${env}`. (AR #1)
- [ ] **FR-6** `scaffold.js` generates `deploy-inventory.json` for ALL topologies,
  not only multi-server. (AR #6)
- [ ] **FR-7** For single topology, the generated inventory contains one server
  each for `test`, `acceptance`, and `production`, all `access: direct`. (AR #10)
- [ ] **FR-8** `release-single.yml` and `release-multi.yml` pass
  `--project-name {{PROJECT_NAME_LOWER}}-${{ inputs.deploy_target }}` to the
  upload step. (AR #5)
- [ ] **FR-9** `scaffold.js` `generateDeployConfig()` and the
  `deploy-config.json` template use `${ENV}` / `${env}`. (AR #1)
- [ ] **FR-10** Root `README.md` and `scaffold/templates/.github/SECRETS-SETUP.md`
  document the `${VAR}` mechanism, the per-target project name, and that the
  inventory is always generated. (AR #11)
- [ ] **FR-11** The bundled `scaffold/templates/deployment/scripts/deploy-cli.js`
  is rebuilt so the new resolver ships to generated projects.

### Should Have

- [ ] **SR-1** Inventory templates include a commented `${VAR}` example so users
  discover the feature.

### Won't Have (Out of Scope)

- Escape syntax for literal `${...}` (e.g. `$${VAR}`). (AR #12)
- Bare `$VAR` (unbraced) syntax. (AR #7)
- Any change to the `access` enum, jump-host, or SSH resolution logic.
- Migration shims for the old `{ENV}` / `{env}` syntax. (AR #4)

## Technical Requirements

### Performance

- Resolution runs once per file read; negligible cost. No measurable impact.

### Compatibility

- ESM module format with `.ts` import extensions (per project.md).
- Bundle remains ESM, runnable under generated projects with `"type": "module"`.
- **Breaking change:** config files using `{ENV}` / `{env}` will no longer
  resolve. Acceptable — no current consumers (AR #4).

### Security

- The resolver only reads from the provided context (process env + injected
  values). It does not execute shell, does not eval, and does not read files.
- Hard-error on missing variables prevents silently deploying to an
  unintended/empty host (fail-fast). (AR #8)
- No secret values are logged by the resolver.

## Scope Decisions

| Decision   | Options Considered | Chosen | Rationale | AR Ref |
| ---------- | ------------------ | ------ | --------- | ------ |
| Syntax | `${VAR}` / `$VAR` | `${VAR}` | Avoids literal-`$` false positives | AR #7 |
| Missing var | error / empty | error | Fail-fast for deploys | AR #8 |
| Inventory context | +`env` / none / +both | `process.env`+`env` | Prefix meaningless in inventory | AR #9 |
| Single inventory | 3-env / 1-env | 3-env, 1 server each | Mirrors config envs | AR #10 |
| Docs scope | README / +secrets | README + SECRETS-SETUP | Only user-facing format docs | AR #11 |

> **Traceability:** Every scope decision references the Ambiguity Register entry
> that resolved it. See `00-ambiguity-register.md`.

## Acceptance Criteria

1. [ ] `${VAR}` resolves in both config files; static values unchanged.
2. [ ] Missing variable produces a descriptive hard error.
3. [ ] `deploy-config.json` uses `${ENV}` / `${env}`; no `{ENV}` / `{env}` remain
   in `src/` or `scaffold/`.
4. [ ] `deploy-inventory.json` is generated for single and multi topology.
5. [ ] `release.yml` project name includes the deploy target.
6. [ ] README and SECRETS-SETUP document the new behavior.
7. [ ] All spec + impl tests pass (`npm run verify`).
8. [ ] `bash -n` passes on `remote-ops.sh`.
9. [ ] Bundle rebuilt and reflects the new resolver.
