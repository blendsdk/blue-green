# Execution Plan: Deploy CLI & Multi-Server Coordination

> **Document**: 99-execution-plan.md
> **Parent**: [Index](00-index.md)
> **Last Updated**: 2026-03-29 23:20
> **Progress**: 6/42 tasks (14%)

## Overview

Implement a TypeScript deployment CLI that replaces bash-in-YAML orchestration, adds two-phase coordinated multi-server deploys, and supports both in-place and registry-based deployment strategies.

**🚨 Update this document after EACH completed task!**

---

## Implementation Phases

| Phase | Title | Sessions | Est. Time |
|-------|-------|----------|-----------|
| 1 | TypeScript project setup + esbuild pipeline | 1 | 60 min |
| 2 | Deploy CLI core libraries | 1-2 | 120 min |
| 3 | Deploy CLI commands | 2 | 120 min |
| 4 | remote-ops.sh updates (two-phase + registry) | 1 | 60 min |
| 5 | Registry deployment templates | 1 | 90 min |
| 6 | Workflow YAML refactoring | 1 | 90 min |
| 7 | Scaffold generator updates | 1 | 90 min |
| 8 | ScaffoldApp migration + integration testing | 2 | 120 min |
| 9 | Documentation + cleanup | 1 | 60 min |

**Total: ~12 sessions, ~13.5 hours**

---

## Phase 1: TypeScript Project Setup + esbuild Pipeline

### Session 1.1: Project scaffolding and build pipeline

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [03-deploy-cli-architecture.md](03-deploy-cli-architecture.md)
**Objective**: Set up TypeScript project, esbuild bundler, and verify end-to-end build pipeline

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 1.1.1 | Create `package.json` with esbuild dev dependency and build scripts | `package.json` |
| 1.1.2 | Create `tsconfig.json` for strict TypeScript + ESNext | `tsconfig.json` |
| 1.1.3 | Create entry point skeleton `src/deploy-cli/index.ts` with argument parser | `src/deploy-cli/index.ts` |
| 1.1.4 | Create types file `src/deploy-cli/types.ts` with all interfaces | `src/deploy-cli/types.ts` |
| 1.1.5 | Create esbuild config and verify bundle produces `scaffold/templates/deployment/scripts/deploy-cli.js` | `esbuild.config.mjs` |
| 1.1.6 | Verify: `npm run build:cli` produces valid bundle, `node deploy-cli.js --help` works | verify |

**Deliverables**:
- [ ] TypeScript compiles without errors
- [ ] esbuild produces single JS bundle
- [ ] `node deploy-cli.js --help` prints usage

**Verify**: `clear && sleep 3 && npx tsc --noEmit && npm run build:cli && node scaffold/templates/deployment/scripts/deploy-cli.js --help`

---

## Phase 2: Deploy CLI Core Libraries

### Session 2.1: SSH, config, inventory, logger, process libraries

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [03-deploy-cli-architecture.md](03-deploy-cli-architecture.md)
**Objective**: Implement all library modules that commands depend on

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 2.1.1 | Implement `lib/process.ts` — spawn helper with timeout and stream capture | `src/deploy-cli/lib/process.ts` |
| 2.1.2 | Implement `lib/logger.ts` — structured output with emoji prefixes | `src/deploy-cli/lib/logger.ts` |
| 2.1.3 | Implement `lib/ssh.ts` — setupSSH, sshExec, scpUpload, cleanupSSH | `src/deploy-cli/lib/ssh.ts` |
| 2.1.4 | Implement `lib/config.ts` — readConfig, resolveConfigEntries, getEnvDefaults | `src/deploy-cli/lib/config.ts` |
| 2.1.5 | Implement `lib/inventory.ts` — readInventory, resolveServers, getSSHOptions | `src/deploy-cli/lib/inventory.ts` |

### Session 2.2: Unit tests for core libraries

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 2.2.1 | Create test fixtures (deploy-config.json, deploy-inventory.json) | `src/deploy-cli/__tests__/fixtures/` |
| 2.2.2 | Write unit tests for `lib/config.ts` | `src/deploy-cli/__tests__/config.test.ts` |
| 2.2.3 | Write unit tests for `lib/inventory.ts` | `src/deploy-cli/__tests__/inventory.test.ts` |
| 2.2.4 | Write unit tests for argument parser in `index.ts` | `src/deploy-cli/__tests__/parser.test.ts` |
| 2.2.5 | Verify: all tests pass, bundle builds | verify |

**Deliverables**:
- [ ] All 5 library modules implemented and typed
- [ ] Unit tests for config, inventory, parser
- [ ] All tests pass
- [ ] Bundle builds successfully

**Verify**: `clear && sleep 3 && npx tsc --noEmit && npm run build:cli && node --test src/deploy-cli/__tests__/*.test.ts`

---

## Phase 3: Deploy CLI Commands

### Session 3.1: upload, deploy-config, operate commands

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [03-deploy-cli-architecture.md](03-deploy-cli-architecture.md)
**Objective**: Implement the commands that replace existing bash scripts

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 3.1.1 | Implement `commands/upload.ts` — upload tarball, scripts, Docker/Nginx configs, set .env | `src/deploy-cli/commands/upload.ts` |
| 3.1.2 | Implement `commands/deploy-config.ts` — deploy config files from secrets | `src/deploy-cli/commands/deploy-config.ts` |
| 3.1.3 | Implement `commands/operate.ts` — run remote-ops.sh subcommand on servers | `src/deploy-cli/commands/operate.ts` |
| 3.1.4 | Wire commands into index.ts dispatcher | `src/deploy-cli/index.ts` |

### Session 3.2: prepare, switch, deploy, registry commands

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 3.2.1 | Implement `commands/prepare.ts` — run blue-green-prepare on all servers | `src/deploy-cli/commands/prepare.ts` |
| 3.2.2 | Implement `commands/switch.ts` — run blue-green-switch on all servers | `src/deploy-cli/commands/switch.ts` |
| 3.2.3 | Implement `commands/deploy.ts` — coordinated prepare → switch | `src/deploy-cli/commands/deploy.ts` |
| 3.2.4 | Implement `commands/registry.ts` — build + push Docker image | `src/deploy-cli/commands/registry.ts` |
| 3.2.5 | Wire all commands + verify full build | `src/deploy-cli/index.ts` |

**Deliverables**:
- [ ] All 7 commands implemented
- [ ] All commands registered in dispatcher
- [ ] Bundle builds successfully
- [ ] `node deploy-cli.js <command> --help` works for all commands

**Verify**: `clear && sleep 3 && npx tsc --noEmit && npm run build:cli && node scaffold/templates/deployment/scripts/deploy-cli.js --help`

---

## Phase 4: remote-ops.sh Updates

### Session 4.1: Two-phase commands + registry support

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [04-remote-ops-updates.md](04-remote-ops-updates.md)
**Objective**: Update remote-ops.sh template with two-phase deploy and registry support

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 4.1.1 | Add `detect_strategy()` function to remote-ops.sh template | `scaffold/templates/deployment/scripts/remote-ops.sh` |
| 4.1.2 | Implement `cmd_blue_green_prepare` — steps 1-6 with strategy detection | same |
| 4.1.3 | Implement `cmd_blue_green_switch` — steps 7-11 with state file | same |
| 4.1.4 | Refactor `cmd_blue_green_deploy` to call prepare + switch | same |
| 4.1.5 | Update `cmd_rebuild` for registry strategy | same |
| 4.1.6 | Update `cmd_rollback` for registry strategy (image tag rollback) | same |
| 4.1.7 | Update dispatcher and help command | same |
| 4.1.8 | Verify `bash -n` passes | verify |

**Deliverables**:
- [ ] Two-phase commands working
- [ ] Strategy auto-detection working
- [ ] Backward compatible `blue-green-deploy`
- [ ] `bash -n` passes

**Verify**: `clear && sleep 3 && bash -n scaffold/templates/deployment/scripts/remote-ops.sh`

---

## Phase 5: Registry Deployment Templates

### Session 5.1: Registry-specific templates and partials

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [05-registry-deployment.md](05-registry-deployment.md)
**Objective**: Create template variants for registry-based deployment

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 5.1.1 | Create in-place compose build partial | `scaffold/partials/compose-build-inplace.yml` |
| 5.1.2 | Create registry compose build partial | `scaffold/partials/compose-build-registry.yml` |
| 5.1.3 | Create registry env partial | `scaffold/partials/env-registry.txt` |
| 5.1.4 | Update docker-compose.yml template with `{{APP_BUILD_SECTION}}` | `scaffold/templates/deployment/docker-compose.yml` |
| 5.1.5 | Update .env.example template with conditional registry vars | `scaffold/templates/deployment/.env.example` |

**Deliverables**:
- [ ] Partials for both strategies created
- [ ] docker-compose.yml template uses conditional build section
- [ ] .env.example includes registry vars conditionally

**Verify**: Visual inspection of templates for correct placeholder usage

---

## Phase 6: Workflow YAML Refactoring

### Session 6.1: Refactor all 5 workflow templates

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [06-workflow-refactoring.md](06-workflow-refactoring.md)
**Objective**: Replace inline bash in all workflow files with CLI calls

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 6.1.1 | Refactor `release-single.yml` template | `scaffold/templates/.github/workflows/release-single.yml` |
| 6.1.2 | Refactor `release-multi.yml` template (three-job: build → prepare → switch) | `scaffold/templates/.github/workflows/release-multi.yml` |
| 6.1.3 | Refactor `operations-single.yml` template | `scaffold/templates/.github/workflows/operations-single.yml` |
| 6.1.4 | Refactor `operations-multi.yml` template | `scaffold/templates/.github/workflows/operations-multi.yml` |
| 6.1.5 | Update `SECRETS-SETUP.md` template if needed | `scaffold/templates/.github/SECRETS-SETUP.md` |

**Deliverables**:
- [ ] All workflow templates use CLI commands
- [ ] Zero inline bash logic (only CLI one-liners)
- [ ] YAML is valid

**Verify**: Visual inspection + YAML structure check

---

## Phase 7: Scaffold Generator Updates

### Session 7.1: New prompts + template selection in scaffold.js

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [07-scaffold-updates.md](07-scaffold-updates.md)
**Objective**: Update scaffold.js with deployment strategy choice and new file generation

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 7.1.1 | Add deployment strategy prompt (in-place / registry) | `scaffold/scaffold.js` |
| 7.1.2 | Add registry URL prompt (conditional) | same |
| 7.1.3 | Update partial resolution for new partials (compose-build, env-registry) | same |
| 7.1.4 | Update file generation: add deploy-cli.js, remove old scripts | same |
| 7.1.5 | Update summary output with strategy info + registry setup notes | same |
| 7.1.6 | Update flag-based mode (--strategy, --registry-url) | same |
| 7.1.7 | Test scaffold with both strategies (in-place + registry) | verify |

**Deliverables**:
- [ ] Strategy prompt works interactively
- [ ] Registry URL prompt shown only for registry strategy
- [ ] Correct templates generated per strategy
- [ ] Old scripts not generated (deploy-config-files.sh, etc.)
- [ ] deploy-cli.js always generated

**Verify**: `clear && sleep 3 && node scaffold/scaffold.js --help && node --check scaffold/scaffold.js`

---

## Phase 8: ScaffoldApp Migration + Integration Testing

### Session 8.1: Migrate ScaffoldApp to deploy CLI

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [08-scaffoldapp-migration.md](08-scaffoldapp-migration.md)
**Objective**: Migrate ScaffoldApp to use deploy CLI, test on real servers

**Prerequisites (before starting this phase):**
- [ ] Deploy CLI fully built and tested (Phases 1-3)
- [ ] remote-ops.sh updated (Phase 4)
- [ ] Workflow templates ready (Phase 6)

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 8.1.1 | Create `feature/deploy-cli` branch in ScaffoldApp | ScaffoldApp repo |
| 8.1.2 | Copy deploy-cli.js + updated remote-ops.sh to ScaffoldApp | ScaffoldApp `deployment/scripts/` |
| 8.1.3 | Remove old scripts (deploy-config-files.sh, multi-deploy.sh, resolve-*.js) | ScaffoldApp `deployment/scripts/` |
| 8.1.4 | Replace workflow files with CLI-based versions | ScaffoldApp `.github/workflows/` |
| 8.1.5 | Local verification: CLI help, bash -n, docker compose config | verify |
| 8.1.6 | Push and trigger test environment deploy via GitHub Actions | GitHub Actions |

### Session 8.2: Integration tests on real servers

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 8.2.1 | Test: two-phase deploy to acceptance (acc-01 + acc-02) | GitHub Actions |
| 8.2.2 | Test: operations workflow (health-check, view-logs, restart) | GitHub Actions |
| 8.2.3 | Test: rollback on acceptance | GitHub Actions |
| 8.2.4 | Test: scoped deploy (single server) | GitHub Actions |
| 8.2.5 | Fix any issues found during testing | various |

**Deliverables**:
- [ ] ScaffoldApp deploys successfully with CLI
- [ ] Two-phase deploy verified (both servers switch together)
- [ ] All operations work
- [ ] Rollback works
- [ ] No regressions

**Verify**: Successful GitHub Actions runs + health checks on both servers

---

## Phase 9: Documentation + Cleanup

### Session 9.1: Documentation and final cleanup

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: All plan documents
**Objective**: Update README, clean up old files, final verification

**Tasks**:

| # | Task | File(s) |
|---|------|---------|
| 9.1.1 | Update README.md with deploy CLI documentation | `README.md` |
| 9.1.2 | Remove old script templates from scaffold | `scaffold/templates/deployment/scripts/` |
| 9.1.3 | Clean up any temporary test files | various |
| 9.1.4 | Final end-to-end scaffold test (run scaffold, verify output) | manual |
| 9.1.5 | Update `.clinerules/project.md` with new project structure | `.clinerules/project.md` |

**Deliverables**:
- [ ] README updated with CLI usage
- [ ] Old templates removed
- [ ] Clean scaffold output

**Verify**: `clear && sleep 3 && bash -n scaffold/templates/deployment/scripts/remote-ops.sh && node scaffold/templates/deployment/scripts/deploy-cli.js --help`

---

## Task Checklist (All Phases)

### Phase 1: TypeScript Project Setup
- [x] 1.1.1 Create package.json with esbuild ✅ (completed: 2026-03-30 00:49)
- [x] 1.1.2 Create tsconfig.json ✅ (completed: 2026-03-30 00:49)
- [x] 1.1.3 Create index.ts entry point with arg parser ✅ (completed: 2026-03-30 00:49)
- [x] 1.1.4 Create types.ts with all interfaces ✅ (completed: 2026-03-30 00:49)
- [x] 1.1.5 Create esbuild config + verify bundle ✅ (completed: 2026-03-30 00:49)
- [x] 1.1.6 Verify end-to-end build pipeline ✅ (completed: 2026-03-30 00:49)

### Phase 2: Deploy CLI Core Libraries
- [ ] 2.1.1 Implement lib/process.ts
- [ ] 2.1.2 Implement lib/logger.ts
- [ ] 2.1.3 Implement lib/ssh.ts
- [ ] 2.1.4 Implement lib/config.ts
- [ ] 2.1.5 Implement lib/inventory.ts
- [ ] 2.2.1 Create test fixtures
- [ ] 2.2.2 Unit tests for config.ts
- [ ] 2.2.3 Unit tests for inventory.ts
- [ ] 2.2.4 Unit tests for parser
- [ ] 2.2.5 Verify all tests pass + bundle builds

### Phase 3: Deploy CLI Commands
- [ ] 3.1.1 Implement commands/upload.ts
- [ ] 3.1.2 Implement commands/deploy-config.ts
- [ ] 3.1.3 Implement commands/operate.ts
- [ ] 3.1.4 Wire commands into dispatcher
- [ ] 3.2.1 Implement commands/prepare.ts
- [ ] 3.2.2 Implement commands/switch.ts
- [ ] 3.2.3 Implement commands/deploy.ts
- [ ] 3.2.4 Implement commands/registry.ts
- [ ] 3.2.5 Wire all commands + verify build

### Phase 4: remote-ops.sh Updates
- [ ] 4.1.1 Add detect_strategy() function
- [ ] 4.1.2 Implement cmd_blue_green_prepare
- [ ] 4.1.3 Implement cmd_blue_green_switch
- [ ] 4.1.4 Refactor cmd_blue_green_deploy
- [ ] 4.1.5 Update cmd_rebuild for registry
- [ ] 4.1.6 Update cmd_rollback for registry
- [ ] 4.1.7 Update dispatcher and help
- [ ] 4.1.8 Verify bash -n passes

### Phase 5: Registry Deployment Templates
- [ ] 5.1.1 Create in-place compose build partial
- [ ] 5.1.2 Create registry compose build partial
- [ ] 5.1.3 Create registry env partial
- [ ] 5.1.4 Update docker-compose.yml template
- [ ] 5.1.5 Update .env.example template

### Phase 6: Workflow YAML Refactoring
- [ ] 6.1.1 Refactor release-single.yml
- [ ] 6.1.2 Refactor release-multi.yml
- [ ] 6.1.3 Refactor operations-single.yml
- [ ] 6.1.4 Refactor operations-multi.yml
- [ ] 6.1.5 Update SECRETS-SETUP.md

### Phase 7: Scaffold Generator Updates
- [ ] 7.1.1 Add deployment strategy prompt
- [ ] 7.1.2 Add registry URL prompt
- [ ] 7.1.3 Update partial resolution
- [ ] 7.1.4 Update file generation (add/remove scripts)
- [ ] 7.1.5 Update summary output
- [ ] 7.1.6 Update flag-based mode
- [ ] 7.1.7 Test scaffold with both strategies

### Phase 8: ScaffoldApp Migration + Integration Testing
- [ ] 8.1.1 Create feature branch in ScaffoldApp
- [ ] 8.1.2 Copy deploy-cli.js + remote-ops.sh
- [ ] 8.1.3 Remove old scripts
- [ ] 8.1.4 Replace workflow files
- [ ] 8.1.5 Local verification
- [ ] 8.1.6 Push and trigger test deploy
- [ ] 8.2.1 Test two-phase deploy to acceptance
- [ ] 8.2.2 Test operations workflow
- [ ] 8.2.3 Test rollback
- [ ] 8.2.4 Test scoped deploy
- [ ] 8.2.5 Fix issues found during testing

### Phase 9: Documentation + Cleanup
- [ ] 9.1.1 Update README.md
- [ ] 9.1.2 Remove old script templates
- [ ] 9.1.3 Clean up temp files
- [ ] 9.1.4 End-to-end scaffold test
- [ ] 9.1.5 Update .clinerules/project.md

---

## Session Protocol

### Starting a Session

1. Start agent settings: `clear && sleep 3 && scripts/agent.sh start`
2. Reference: "Implement Phase X, Session X.X per `plans/deploy-cli/99-execution-plan.md`"

### Ending a Session

1. Verify: `clear && sleep 3 && npx tsc --noEmit && npm run build:cli`
2. Handle commit per active commit mode
3. End agent settings: `clear && sleep 3 && scripts/agent.sh finished`
4. Compact: `/compact`

### Between Sessions

1. Review completed tasks in this checklist
2. Start new conversation
3. Run `exec_plan deploy-cli` to continue

---

## Dependencies

```
Phase 1 (TS setup)
    ↓
Phase 2 (core libs)
    ↓
Phase 3 (commands) ──→ Phase 4 (remote-ops.sh)
    ↓                       ↓
Phase 5 (registry templates)
    ↓
Phase 6 (workflow refactoring)
    ↓
Phase 7 (scaffold updates)
    ↓
Phase 8 (ScaffoldApp migration + testing)
    ↓
Phase 9 (docs + cleanup)
```

---

## Success Criteria

**Feature is complete when:**

1. ✅ All phases completed
2. ✅ All verification passing (tsc, esbuild, bash -n, node --test)
3. ✅ No warnings/errors
4. ✅ ScaffoldApp integration tests pass on real servers
5. ✅ Documentation updated
6. ✅ **Post-completion:** Ask user to re-analyze project and update `.clinerules/project.md`
