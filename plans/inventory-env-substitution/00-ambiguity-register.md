# Ambiguity Register: Inventory & Config Env-Var Substitution

> **Status**: ✅ GATE PASSED — all 12 items resolved
> **Last Updated**: 2026-06-11

This register is the audit trail for every design decision in this plan. Each
decision in the plan documents back-references an `AR #` entry here.

| # | Category | Ambiguity / Gap | Options Presented | User Decision | Status |
|---|----------|-----------------|-------------------|---------------|--------|
| 1 | Technical | One templating mechanism vs two | Single `${VAR}` / keep `{ENV}` too | Single `${VAR}` only — fold `{ENV}`/`{env}` in | ✅ Resolved |
| 2 | Behavioral | What `${VAR}` resolves from | process.env / merged context | Merged context: `process.env` + injected `ENV` (prefix) + `env` (environment name) | ✅ Resolved |
| 3 | Scope | Which values support substitution | host only / all string values | All string values, recursively, in both config + inventory | ✅ Resolved |
| 4 | Compat | Existing users / migration | migrate with shims / clean break | Nobody uses it — clean break, no shims | ✅ Resolved |
| 5 | Behavioral | release.yml project name | static / per-target | Append `-${{ inputs.deploy_target }}` to `--project-name` | ✅ Resolved |
| 6 | Bug | Inventory not generated for single topology | keep multi-only / always generate | Always generate `deploy-inventory.json` | ✅ Resolved |
| 7 | Technical | Placeholder syntax | braced `${VAR}` only / also bare `$VAR` | Braced `${VAR}` only | ✅ Resolved |
| 8 | Behavioral | Missing/empty referenced variable | hard error / empty-string fallback | Hard error and abort (fail-fast) | ✅ Resolved |
| 9 | Technical | Inventory resolver context | process.env+env / process.env only / both ENV+env everywhere | `process.env` + `${env}` (no `${ENV}` prefix in inventory) | ✅ Resolved |
| 10 | Scope | Single-topology inventory content | one server per env / single env one server / 3-env example | One server each for test / acceptance / production (`access: direct`) | ✅ Resolved |
| 11 | Docs | "Update docs and readme" scope | README only / README + secrets doc / wider | Root `README.md` + `scaffold/templates/.github/SECRETS-SETUP.md` | ✅ Resolved |
| 12 | Technical | Literal `${...}` escape support | add `$${VAR}` escape / out of scope | Out of scope — no value legitimately needs a literal `${}` | ✅ Resolved |

## Resolution Notes

**AR-1..AR-6:** Resolved during planning conversation (2026-06-11).

**AR-7..AR-12:** The user explicitly chose to accept the agent's recommendations
("Give me your best possible recommendations ... let's not overcomplicate
things"). Each recommendation below is recorded as the user's decision:

- **AR-7** — Braced `${VAR}` only avoids false positives with any literal `$`
  characters that may legitimately appear in values.
- **AR-8** — A deploy must never proceed with a silently-empty host/secret. A
  hard error naming the missing variable is safer than producing `deploy@` and
  failing obscurely later.
- **AR-9** — The `ENV` prefix (e.g. `ACC`) is an artifact of the config-secret
  naming scheme and has no meaning in the inventory. Only `env` (the environment
  name) and real environment variables are injected for the inventory.
- **AR-10** — Mirroring the three config environments keeps a single, consistent
  mental model across both generated files.
- **AR-11** — These are the only two user-facing documents that describe the
  config/inventory format and the release project-name behavior.
- **AR-12** — Keeping the resolver free of escape handling keeps it tiny and
  predictable; no inventory/config value has a legitimate need for a literal
  `${}` token.
