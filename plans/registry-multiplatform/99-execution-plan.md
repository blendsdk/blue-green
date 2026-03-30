# Execution Plan: Registry & Multi-Platform Backport

> **Document**: 99-execution-plan.md
> **Parent**: [Index](00-index.md)
> **Last Updated**: 2026-03-30 14:50
> **Progress**: 0/24 tasks (0%)

## Overview

Backport registry strategy support to scaffold templates, add multi-platform Docker builds via buildx, and validate with end-to-end integration tests on ScaffoldApp.

**🚨 Update this document after EACH completed task!**

---

## Implementation Phases

| Phase | Title | Sessions | Est. Time |
|-------|-------|----------|-----------|
| 1 | Registry command refactor (buildx + cleanup) | 1 | 30 min |
| 2 | Workflow template backport (partials) | 1 | 45 min |
| 3 | Scaffold generator updates (platform prompt) | 1 | 30 min |
| 4 | Integration test — in-place strategy | 1-2 | 30 min |
| 5 | Integration test — registry strategy | 1-2 | 30 min |

**Total: ~5-7 sessions, ~3 hours**

---

## Phase 1: Registry Command Refactor

### Session 1.1: Refactor registry.ts to use buildx

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.
- If 90% reached: wrap up, handle commit per active commit mode, then `/compact`.

**Reference**: [03-registry-command.md](03-registry-command.md)
**Objective**: Replace `docker build`+`push` with `docker buildx build --push`, add cleanup

**Tasks**:

| # | Task | File |
|---|------|------|
| 1.1.1 | Refactor registry command: replace `docker build` + `docker push` with `docker buildx build --push` | `src/deploy-cli/commands/registry.ts` |
| 1.1.2 | Add buildx builder setup (create + use, idempotent) | `src/deploy-cli/commands/registry.ts` |
| 1.1.3 | Change default tag from timestamp to `latest` | `src/deploy-cli/commands/registry.ts` |
| 1.1.4 | Add image cleanup after successful push (docker rmi + prune, best-effort) | `src/deploy-cli/commands/registry.ts` |
| 1.1.5 | Verify: `npm run verify` passes, run tests | all |

**Deliverables**:
- [ ] registry.ts uses buildx
- [ ] Multi-platform `--platform` works (comma-separated)
- [ ] Image cleanup after push
- [ ] All verification passing

**Verify**: `clear && sleep 3 && npm run verify && bash -n scaffold/templates/deployment/scripts/remote-ops.sh`

---

## Phase 2: Workflow Template Backport

### Session 2.1: Create workflow partials and update templates

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.

**Reference**: [04-workflow-templates.md](04-workflow-templates.md)
**Objective**: Add conditional registry steps to release workflow templates

**Tasks**:

| # | Task | File |
|---|------|------|
| 2.1.1 | Create `workflow-release-registry-steps.yml` partial (QEMU + buildx + login + push + cleanup) | `scaffold/partials/` |
| 2.1.2 | Create `workflow-release-upload-inplace.yml` partial (current upload step) | `scaffold/partials/` |
| 2.1.3 | Create `workflow-release-upload-registry.yml` partial (upload with --strategy registry) | `scaffold/partials/` |
| 2.1.4 | Update `release-multi.yml` template: replace hardcoded steps with `{{WORKFLOW_REGISTRY_STEPS}}` and `{{WORKFLOW_UPLOAD_STEPS}}` placeholders | `scaffold/templates/.github/workflows/release-multi.yml` |
| 2.1.5 | Update `release-single.yml` template: same placeholders | `scaffold/templates/.github/workflows/release-single.yml` |
| 2.1.6 | Verify: `npm run verify` passes | all |

**Deliverables**:
- [ ] 3 new workflow partials created
- [ ] Both release templates use placeholders
- [ ] All verification passing

**Verify**: `clear && sleep 3 && npm run verify && bash -n scaffold/templates/deployment/scripts/remote-ops.sh`

---

## Phase 3: Scaffold Generator Updates

### Session 3.1: Add platform prompt and wire partials

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.

**Reference**: [05-scaffold-generator.md](05-scaffold-generator.md)
**Objective**: Update scaffold.js with platform prompt and workflow partial injection

**Tasks**:

| # | Task | File |
|---|------|------|
| 3.1.1 | Add `--platform` CLI flag to argument parser | `scaffold/scaffold.js` |
| 3.1.2 | Add platform choice prompt (after registry URL, when strategy=registry) | `scaffold/scaffold.js` |
| 3.1.3 | Add platform to `answersFromFlags()` function | `scaffold/scaffold.js` |
| 3.1.4 | Add DOCKER_PLATFORM, WORKFLOW_REGISTRY_STEPS, WORKFLOW_UPLOAD_STEPS to `resolveVars()` | `scaffold/scaffold.js` |
| 3.1.5 | Update `.env.example` template: add REGISTRY_URL guidance comment | `scaffold/templates/deployment/.env.example` |
| 3.1.6 | Update configuration summary output to show platform | `scaffold/scaffold.js` |
| 3.1.7 | Verify: `npm run verify` passes, test scaffold.js with `--help` | all |

**Deliverables**:
- [ ] Platform prompt works in interactive mode
- [ ] `--platform` CLI flag works
- [ ] Workflow partials injected correctly for both strategies
- [ ] All verification passing

**Verify**: `clear && sleep 3 && npm run verify && bash -n scaffold/templates/deployment/scripts/remote-ops.sh`

---

## Phase 4: Integration Test — In-Place Strategy

### Session 4.1: Test in-place on ScaffoldApp (single + multi server)

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.

**Reference**: [06-integration-testing.md](06-integration-testing.md)
**Objective**: Verify in-place strategy works end-to-end on ScaffoldApp

**Tasks**:

| # | Task | File |
|---|------|------|
| 4.1.1 | Create `test/inplace-multi` branch from `feature/deploy-cli` on ScaffoldApp | ScaffoldApp repo |
| 4.1.2 | Update branch: in-place docker-compose.yml + in-place release workflow (from updated templates) | ScaffoldApp repo |
| 4.1.3 | Push branch, trigger Release workflow on acceptance (multi-server) via `gh workflow run` | ScaffoldApp repo |
| 4.1.4 | Monitor and verify: all 3 jobs pass (build → prepare → switch) | GitHub Actions |
| 4.1.5 | Create `test/inplace-single` branch, update with single-server release workflow | ScaffoldApp repo |
| 4.1.6 | Push branch, trigger Release workflow on test (single-server) via `gh workflow run` | ScaffoldApp repo |
| 4.1.7 | Monitor and verify: deploy job passes | GitHub Actions |

**Deliverables**:
- [ ] In-place multi-server deploy succeeds on acceptance
- [ ] In-place single-server deploy succeeds on test

**Verify**: `gh run view <id> --json conclusion`

---

## Phase 5: Integration Test — Registry Strategy

### Session 5.1: Test registry on ScaffoldApp (single + multi server)

**⚠️ Session Execution Rules:**
- Continue implementing until 90% of the 200K context window is reached.

**Reference**: [06-integration-testing.md](06-integration-testing.md)
**Objective**: Verify registry strategy with buildx works end-to-end on ScaffoldApp

**Tasks**:

| # | Task | File |
|---|------|------|
| 5.1.1 | Create `test/registry-multi` branch from `feature/deploy-cli` on ScaffoldApp | ScaffoldApp repo |
| 5.1.2 | Update branch: registry docker-compose.yml + registry release workflow (from updated templates) | ScaffoldApp repo |
| 5.1.3 | Push branch, trigger Release workflow on acceptance (multi-server) via `gh workflow run` | ScaffoldApp repo |
| 5.1.4 | Monitor and verify: all 3 jobs pass (build+push → prepare+pull → switch) | GitHub Actions |
| 5.1.5 | Create `test/registry-single` branch, update with single-server registry release workflow | ScaffoldApp repo |
| 5.1.6 | Push branch, trigger Release workflow on test (single-server) via `gh workflow run` | ScaffoldApp repo |
| 5.1.7 | Monitor and verify: deploy job passes | GitHub Actions |

**Deliverables**:
- [ ] Registry multi-server deploy succeeds on acceptance
- [ ] Registry single-server deploy succeeds on test

**Verify**: `gh run view <id> --json conclusion`

---

## Task Checklist (All Phases)

### Phase 1: Registry Command Refactor
- [ ] 1.1.1 Refactor registry command to use docker buildx build --push
- [ ] 1.1.2 Add buildx builder setup (idempotent)
- [ ] 1.1.3 Change default tag from timestamp to latest
- [ ] 1.1.4 Add image cleanup after push (docker rmi + prune)
- [ ] 1.1.5 Verify all passing

### Phase 2: Workflow Template Backport
- [ ] 2.1.1 Create workflow-release-registry-steps.yml partial
- [ ] 2.1.2 Create workflow-release-upload-inplace.yml partial
- [ ] 2.1.3 Create workflow-release-upload-registry.yml partial
- [ ] 2.1.4 Update release-multi.yml template with placeholders
- [ ] 2.1.5 Update release-single.yml template with placeholders
- [ ] 2.1.6 Verify all passing

### Phase 3: Scaffold Generator Updates
- [ ] 3.1.1 Add --platform CLI flag to argument parser
- [ ] 3.1.2 Add platform choice prompt (registry strategy only)
- [ ] 3.1.3 Add platform to answersFromFlags()
- [ ] 3.1.4 Add DOCKER_PLATFORM + workflow partials to resolveVars()
- [ ] 3.1.5 Update .env.example with REGISTRY_URL guidance
- [ ] 3.1.6 Update config summary to show platform
- [ ] 3.1.7 Verify all passing

### Phase 4: Integration Test — In-Place
- [ ] 4.1.1 Create test/inplace-multi branch on ScaffoldApp
- [ ] 4.1.2 Update with in-place files from updated templates
- [ ] 4.1.3 Trigger acceptance multi-server deploy
- [ ] 4.1.4 Verify all jobs pass
- [ ] 4.1.5 Create test/inplace-single branch
- [ ] 4.1.6 Trigger test single-server deploy
- [ ] 4.1.7 Verify deploy passes

### Phase 5: Integration Test — Registry
- [ ] 5.1.1 Create test/registry-multi branch on ScaffoldApp
- [ ] 5.1.2 Update with registry files from updated templates
- [ ] 5.1.3 Trigger acceptance multi-server deploy
- [ ] 5.1.4 Verify all jobs pass
- [ ] 5.1.5 Create test/registry-single branch
- [ ] 5.1.6 Trigger test single-server deploy
- [ ] 5.1.7 Verify deploy passes

---

## Session Protocol

### Starting a Session

1. Start agent settings: `clear && scripts/agent.sh start`
2. Reference: "Implement Phase X, Session X.X per `plans/registry-multiplatform/99-execution-plan.md`"

### Ending a Session

1. Run: `clear && sleep 3 && npm run verify && bash -n scaffold/templates/deployment/scripts/remote-ops.sh`
2. Handle commit per active commit mode
3. End agent settings: `clear && scripts/agent.sh finished`
4. Compact: `/compact`

### Between Sessions

1. Review completed tasks in this checklist
2. Start new conversation for next session
3. Run `exec_plan registry-multiplatform` to continue

---

## Dependencies

```
Phase 1 (registry.ts refactor)
    ↓
Phase 2 (workflow templates)
    ↓
Phase 3 (scaffold.js)
    ↓
Phase 4 (integration: in-place) ──┐
Phase 5 (integration: registry) ──┘ (parallel or sequential)
```

---

## Success Criteria

**Feature is complete when:**

1. ✅ All 5 phases completed
2. ✅ All verification passing (`npm run verify`)
3. ✅ No warnings/errors
4. ✅ All 4 integration tests pass (2 strategies × 2 topologies)
5. ✅ Test branches cleaned up on ScaffoldApp
6. ✅ **Post-completion:** Ask user to re-analyze project and update `.clinerules/project.md`
