# Docs: README + SECRETS-SETUP

> **Document**: 05-docs.md
> **Parent**: [Index](00-index.md)

## Overview

Document the new behavior in the two user-facing files (AR #11): root `README.md`
and the generated `scaffold/templates/.github/SECRETS-SETUP.md`.

## README.md

Add/extend a section covering:

1. **Config & inventory placeholders** — `${VAR}` substitution:
   - Syntax: braced `${VAR}` only.
   - Resolves from environment variables (CI secrets) plus:
     - `${env}` — environment name (both files).
     - `${ENV}` — uppercase prefix, e.g. `ACC` (`deploy-config.json` only).
   - Missing/empty variable → hard error (deploy aborts).
   - Example inventory host: `"host": "deploy@${PROD_HOST}"`.
   - Example config: `"secret_key": "${ENV}_ENV_FILE"`,
     `"local_file": "local_data/${env}/.env"`.
2. **Inventory always present** — note that `deploy-inventory.json` is generated
   for both single and multi topologies, and the single-server form has one
   server per environment.
3. **Per-environment project name** — the release workflow sets
   `COMPOSE_PROJECT_NAME` to `<project>-<deploy_target>` so environments are
   isolated on a shared host.

## SECRETS-SETUP.md (template)

`scaffold/templates/.github/SECRETS-SETUP.md` is generated into target projects.
Add a short subsection:

- **Host secrets** — when inventory hosts use `${VAR}` (e.g. `${PROD_HOST}`),
  add those as GitHub secrets / CI environment variables. List the default
  single-topology variables: `TEST_HOST`, `ACC_HOST`, `PROD_HOST`.
- **Placeholder format** — one line explaining `${VAR}` resolves from secrets at
  deploy time; missing values fail the deploy fast.

> The existing `CONFIG_SECRETS_TABLE` placeholder and its generator
> (`buildConfigSecretsTable`) are unchanged — they list the `${ENV}_*` secret
> names which still hold (the prefix values are identical; only the placeholder
> delimiter changed from `{ENV}` to `${ENV}`).

## Error Handling

N/A — documentation only.

## Testing Requirements

- Documentation correctness verified by review (no automated test).
- Ensure no remaining `{ENV}` / `{env}` (old syntax) references in README or
  SECRETS-SETUP after the edit (covered by the repo-wide grep check in the
  execution plan).
