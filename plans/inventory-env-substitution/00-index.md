# Inventory & Config Env-Var Substitution — Implementation Plan

> **Feature**: Uniform `${VAR}` substitution across `deploy-inventory.json` and `deploy-config.json`, plus three related scaffold/workflow fixes
> **Status**: Planning Complete
> **Created**: 2026-06-11
> **CodeOps Version**: (codeops-mcp current)

## Overview

The Deploy CLI reads two JSON config files: `deploy-inventory.json` (server
lists per environment) and `deploy-config.json` (secret→file mappings). Today
only `deploy-config.json` supports placeholders, and it uses a bespoke
`{ENV}` / `{env}` syntax that resolves from the selected deploy environment.
The inventory file supports no substitution at all, so server hosts must be
hard-coded — IP addresses end up committed to git, and the same value cannot be
parameterized per environment.

This feature introduces **one uniform mechanism**: every string value in both
files supports `${VAR}` substitution, resolved from a single context (real
environment variables plus a small set of injected, environment-aware values).
The old `{ENV}` / `{env}` syntax is removed in favor of `${ENV}` / `${env}`.
There is exactly one way to template a value.

Alongside the substitution work, this plan fixes three defects discovered during
analysis: (1) `deploy-inventory.json` was only generated for multi-server
topology even though every command path reads it, breaking single-server
projects; (2) the generated `release.yml` did not include the deploy target in
the Docker Compose project name, so environments shared a project namespace;
and (3) user docs did not describe any of this.

## Document Index

| #   | Document                                                  | Description                                  |
| --- | --------------------------------------------------------- | -------------------------------------------- |
| AR  | [Ambiguity Register](00-ambiguity-register.md)            | Zero-Ambiguity Gate decisions (audit trail)  |
| 00  | [Index](00-index.md)                                      | This document — overview and navigation      |
| 01  | [Requirements](01-requirements.md)                        | Feature requirements and scope               |
| 02  | [Current State](02-current-state.md)                      | Analysis of current implementation           |
| 03  | [Env Resolver](03-env-resolver.md)                        | Resolver + config/inventory wiring spec      |
| 04  | [Scaffold & Workflows](04-scaffold-and-workflows.md)      | Inventory-always, project-name, migration    |
| 05  | [Docs](05-docs.md)                                        | README + SECRETS-SETUP documentation         |
| 07  | [Testing Strategy](07-testing-strategy.md)                | Spec test cases and verification             |
| 99  | [Execution Plan](99-execution-plan.md)                    | Phases, sessions, and task checklist         |

## Quick Reference

### Usage Examples

`deploy-inventory.json` — env-var host (resolved at read time):
```jsonc
{
  "ssh_key_secret": "DEPLOY_SSH_KEY",
  "environments": {
    "production": {
      "access": "direct",
      "servers": [
        { "name": "prod-01", "host": "deploy@${PROD_HOST}", "group": "all" }
      ]
    }
  }
}
```

`deploy-config.json` — `${ENV}` / `${env}` replace the old `{ENV}` / `{env}`:
```jsonc
{
  "configs": [
    { "name": "Docker Environment",
      "secret_key": "${ENV}_ENV_FILE",
      "local_file": "local_data/${env}/.env",
      "deploy_path": ".env" }
  ]
}
```

### Key Decisions

| Decision     | Outcome   | AR Ref |
| ------------ | --------- | ------ |
| Single templating syntax | `${VAR}` only; remove `{ENV}`/`{env}` | AR #1 |
| Resolution context | `process.env` + `ENV` (prefix, config only) + `env` | AR #2, AR #9 |
| Scope | All string values, recursive, both files | AR #3 |
| Missing var | Hard error, abort | AR #8 |
| Inventory always generated | Fixes single-server breakage | AR #6 |
| Project name per target | `<name>-${{ inputs.deploy_target }}` | AR #5 |

## Related Files

- `src/deploy-cli/lib/env-resolve.ts` (new)
- `src/deploy-cli/lib/config.ts`, `src/deploy-cli/lib/inventory.ts`
- `src/deploy-cli/types.ts`
- `scaffold/scaffold.js`
- `scaffold/templates/deploy-config.json`, `scaffold/templates/deploy-inventory.json`
- `scaffold/templates/.github/workflows/release-single.yml`, `release-multi.yml`
- `scaffold/templates/deployment/scripts/deploy-cli.js` (rebuilt bundle)
- `README.md`, `scaffold/templates/.github/SECRETS-SETUP.md`
- Tests: `src/deploy-cli/__tests__/env-resolve.spec.test.ts` (new), `config.test.ts`, `inventory.test.ts`, fixtures
