# Execution Plan: Inventory & Config Env-Var Substitution

> **Document**: 99-execution-plan.md
> **Parent**: [Index](00-index.md)
> **Last Updated**: 2026-06-11 13:06
> **Progress**: 14/16 tasks (88%)
> **CodeOps Version**: (codeops-mcp current)

## Overview

Implement a uniform `${VAR}` resolver across both Deploy CLI config files, remove
the legacy `{ENV}`/`{env}` syntax, always generate `deploy-inventory.json`, put
the deploy target into the release project name, document it, and rebuild the
bundle. Spec-first ordering per `testing.md` Rule 10.

**🚨 Update this document after EACH completed task!**

---

## Implementation Phases

| Phase | Title | Sessions | Est. Time |
| ----- | ----- | -------- | --------- |
| 1 | Resolver (spec → impl → tests) | 1 | 45 min |
| 2 | Wire into config + inventory | 1 | 45 min |
| 3 | Scaffold + workflows | 1 | 40 min |
| 4 | Docs | 1 | 20 min |
| 5 | Bundle rebuild + full verify | 1 | 20 min |

**Total: 5 sessions, ~2.5–3 hours**

---

## Phase 1: Resolver

### Session 1.1: env-resolve (spec-first)

**Reference**: `03-env-resolver.md`, `07-testing-strategy.md`

**Tasks**:

| # | Task | File |
|---|------|------|
| 1.1.1 | Write spec tests ST-1..ST-10 | `src/deploy-cli/__tests__/env-resolve.spec.test.ts` |
| 1.1.2 | Run spec tests — verify FAIL (red) | (test runner) |
| 1.1.3 | Implement `resolveString` + `resolvePlaceholders` | `src/deploy-cli/lib/env-resolve.ts` |
| 1.1.4 | Run spec tests — verify PASS (green) | (test runner) |
| 1.1.5 | Write impl edge-case tests | `src/deploy-cli/__tests__/env-resolve.impl.test.ts` |

**Verify**: `npm run test:cli`

---

## Phase 2: Wire into config + inventory

### Session 2.1: config.ts + inventory.ts + types.ts

**Reference**: `03-env-resolver.md`

**Tasks**:

| # | Task | File |
|---|------|------|
| 2.1.1 | Update `config.test.ts` spec (ST-11..ST-13) + fixture to `${ENV}`/`${env}` | `__tests__/config.test.ts`, `__tests__/fixtures/deploy-config.json` |
| 2.1.2 | Replace `{ENV}`/`{env}` logic with resolver in `config.ts` | `src/deploy-cli/lib/config.ts` |
| 2.1.3 | Add inventory `${VAR}` spec tests (ST-14..ST-17) | `__tests__/inventory.test.ts` |
| 2.1.4 | Wire resolver into `resolveServers`/SSH lookup in `inventory.ts` | `src/deploy-cli/lib/inventory.ts` |
| 2.1.5 | Update `types.ts` JSDoc for `${VAR}` support | `src/deploy-cli/types.ts` |

**Verify**: `npm run test:cli`

---

## Phase 3: Scaffold + workflows

### Session 3.1: generator, templates, release YAML

**Reference**: `04-scaffold-and-workflows.md`

**Tasks**:

| # | Task | File |
|---|------|------|
| 3.1.1 | Always add inventory to file list; branch `generateDeployInventory`; migrate `generateDeployConfig` to `${ENV}`/`${env}` + align `{prefix,env_defaults}` shape | `scaffold/scaffold.js` |
| 3.1.2 | Migrate `deploy-config.json` template to `${ENV}`/`${env}` | `scaffold/templates/deploy-config.json` |
| 3.1.3 | Project-name `-${{ inputs.deploy_target }}` in both release workflows | `scaffold/templates/.github/workflows/release-single.yml`, `release-multi.yml` |
| 3.1.4 | Add `scripts/verify-scaffold-output.sh` + run it | `scripts/verify-scaffold-output.sh` |

**Verify**: `bash scripts/verify-scaffold-output.sh` + `node scaffold/scaffold.js --help`

---

## Phase 4: Docs

### Session 4.1: README + SECRETS-SETUP

**Reference**: `05-docs.md`

**Tasks**:

| # | Task | File |
|---|------|------|
| 4.1.1 | Document `${VAR}`, per-env project name, always-inventory | `README.md` |
| 4.1.2 | Document host secrets + placeholder format | `scaffold/templates/.github/SECRETS-SETUP.md` |

**Verify**: repo-wide grep confirms no old `{ENV}`/`{env}` remains

---

## Phase 5: Bundle + full verify

### Session 5.1: rebuild bundle, final verification

**Tasks**:

| # | Task | File |
|---|------|------|
| 5.1.1 | Rebuild Deploy CLI bundle | `scaffold/templates/deployment/scripts/deploy-cli.js` |
| 5.1.2 | Full verify + `bash -n` remote-ops.sh + cleanup tmp scripts | (verify) |

**Verify**: `npm run verify` + `bash -n scaffold/templates/deployment/scripts/remote-ops.sh`

---

## 🚨 Master Progress Checklist (All Phases) — MANDATORY

> **⚠️ EXECUTION RULE — APPLIES TO EVERY AGENT EXECUTING THIS PLAN:**
>
> 1. After completing each task: mark it `[x]` with a timestamp.
> 2. After each phase: confirm every completed task is `[x]`.
> 3. Update the Progress header after every update.
> 4. This checklist MUST exist — reconstruct from phase details if missing.
> 5. Never batch updates — update immediately after each task.

### Phase 1: Resolver
- [x] 1.1.1 Write spec tests ST-1..ST-10 (`env-resolve.spec.test.ts`) ✅ (completed: 2026-06-11 12:57)
- [x] 1.1.2 Run spec tests — verify FAIL (red) ✅ (completed: 2026-06-11 12:57)
- [x] 1.1.3 Implement `env-resolve.ts` ✅ (completed: 2026-06-11 12:58)
- [x] 1.1.4 Run spec tests — verify PASS (green) ✅ (completed: 2026-06-11 12:58)
- [x] 1.1.5 Write impl edge-case tests (`env-resolve.impl.test.ts`) ✅ (completed: 2026-06-11 12:58)

### Phase 2: Wire into config + inventory
- [x] 2.1.1 Update `config.test.ts` + fixture to `${ENV}`/`${env}` ✅ (completed: 2026-06-11 13:00)
- [x] 2.1.2 Replace `{ENV}`/`{env}` logic in `config.ts` ✅ (completed: 2026-06-11 13:01)
- [x] 2.1.3 Add inventory `${VAR}` spec tests ✅ (completed: 2026-06-11 13:02)
- [x] 2.1.4 Wire resolver into `inventory.ts` ✅ (completed: 2026-06-11 13:02)
- [x] 2.1.5 Update `types.ts` JSDoc ✅ (completed: 2026-06-11 13:03)

### Phase 3: Scaffold + workflows
- [x] 3.1.1 scaffold.js: always-inventory, topology branch, config syntax + shape ✅ (completed: 2026-06-11 13:05)
- [x] 3.1.2 Migrate `deploy-config.json` template ✅ (completed: 2026-06-11 13:05)
- [x] 3.1.3 Release workflows project-name per target ✅ (completed: 2026-06-11 13:05)
- [x] 3.1.4 Add + run `verify-scaffold-output.sh` ✅ (completed: 2026-06-11 13:06)

### Phase 4: Docs
- [ ] 4.1.1 README updates
- [ ] 4.1.2 SECRETS-SETUP updates

### Phase 5: Bundle + verify
- [ ] 5.1.1 Rebuild bundle
- [ ] 5.1.2 Full verify + bash -n + cleanup

---

## Session Protocol

### Starting a Session
1. Run `clear && sleep 3 && scripts/agent.sh start`
2. Reference this plan: "Implement Phase X per `plans/inventory-env-substitution/99-execution-plan.md`"

### Ending a Session
1. Run `npm run verify`
2. Handle commit per active commit mode (`gitcm`/`gitcmp`)
3. Run `clear && sleep 3 && scripts/agent.sh finished`
4. `/compact`

---

## Dependencies

```
Phase 1 (resolver)
    ↓
Phase 2 (wire config + inventory)
    ↓
Phase 3 (scaffold + workflows)
    ↓
Phase 4 (docs)
    ↓
Phase 5 (bundle + verify)
```

---

## Success Criteria

**Feature is complete when:**

1. ✅ All phases completed
2. ✅ All verification passing (`npm run verify`)
3. ✅ No warnings/errors
4. ✅ No dead code — old `{ENV}`/`{env}` logic fully removed (per `code.md` rule 4)
5. ✅ Security: resolver no eval/shell; missing-var fail-fast (per `code.md` rules 32-34)
6. ✅ Documentation updated (README + SECRETS-SETUP)
7. ✅ Bundle rebuilt
8. ✅ **Post-completion:** Ask user to re-analyze project and update `.clinerules/project.md`
