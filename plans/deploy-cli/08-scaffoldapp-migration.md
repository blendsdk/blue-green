# ScaffoldApp Migration & Integration Testing

> **Document**: 08-scaffoldapp-migration.md
> **Parent**: [Index](00-index.md)

## Overview

ScaffoldApp (`/home/gevik/workdir/github/ScaffoldApp`) is the real-world test project for validating the deploy CLI. It currently deploys to two acceptance servers (acc-01 at 10.0.0.3, acc-02 at 10.0.0.4) using the old workflow. This phase migrates it to use the new deploy CLI and validates the two-phase coordinated deployment.

## Current ScaffoldApp State

### Infrastructure

- **Repository:** GitHub, with GitHub Actions self-hosted runner
- **Servers:** 
  - test-01: `deploy@10.0.0.3` (test environment)
  - acc-01: `deploy@10.0.0.3` (acceptance environment)
  - acc-02: `deploy@10.0.0.4` (acceptance environment)
- **Access:** Jump host (`JUMP_HOST` secret)
- **Strategy:** In-place (tarball → docker build on server)
- **Topology:** Multi-server for acceptance

### Files to Replace

| Current File | Replaced With |
|-------------|---------------|
| `deployment/scripts/deploy-config-files.sh` | `deployment/scripts/deploy-cli.js` |
| `deployment/scripts/multi-deploy.sh` | (absorbed into deploy-cli.js) |
| `deployment/scripts/resolve-config.js` | (absorbed into deploy-cli.js) |
| `deployment/scripts/resolve-servers.js` | (absorbed into deploy-cli.js) |
| `deployment/scripts/remote-ops.sh` | Updated `remote-ops.sh` (two-phase) |
| `.github/workflows/release.yml` | Refactored release workflow |
| `.github/workflows/operations.yml` | Refactored operations workflow |

## Migration Steps

### Step 1: Create Feature Branch in ScaffoldApp

```
cd /home/gevik/workdir/github/ScaffoldApp
git checkout -b feature/deploy-cli
```

### Step 2: Copy New Files

Copy the built `deploy-cli.js` and updated `remote-ops.sh` from the blue-green-template scaffold output into ScaffoldApp:

- `deployment/scripts/deploy-cli.js` ← from bundled output
- `deployment/scripts/remote-ops.sh` ← updated template
- `deployment/scripts/health-check-wait.sh` ← unchanged

### Step 3: Remove Old Scripts

- `deployment/scripts/deploy-config-files.sh`
- `deployment/scripts/multi-deploy.sh`
- `deployment/scripts/resolve-config.js`
- `deployment/scripts/resolve-servers.js`

### Step 4: Update Workflow Files

Replace `.github/workflows/release.yml` with the new CLI-based multi-server release workflow.
Replace `.github/workflows/operations.yml` with the new CLI-based operations workflow.
Keep `.github/workflows/build-test.yml` as-is.

### Step 5: Test Locally

Before pushing, verify:
- `node deployment/scripts/deploy-cli.js --help` works
- `bash -n deployment/scripts/remote-ops.sh` passes
- Workflow YAML is valid

## Integration Test Plan

### Test 1: In-Place Two-Phase Deploy to Acceptance

**Goal:** Verify the core problem is solved — both acc-01 and acc-02 switch simultaneously.

**Steps:**
1. Trigger release workflow for `acceptance` environment
2. Observe: `deploy_prepare` job runs — both servers build + health check
3. Observe: `deploy_prepare` completes for both servers
4. Observe: `deploy_switch` job runs — both servers switch nginx
5. Verify: both servers serve the same version within seconds

**Validation:**
```bash
# After deploy, check both servers report same version
ssh deploy@10.0.0.3 "curl -s http://localhost:8081/health"
ssh deploy@10.0.0.4 "curl -s http://localhost:8081/health"
# Both should return same version/color
```

### Test 2: Operations Workflow

**Goal:** Verify all operations work through the CLI.

**Test each:**
- `health-check` on acceptance (both servers)
- `view-logs` on acceptance (both servers)
- `restart-app` on acceptance (both servers)
- `switch-color` on acceptance (both servers)
- `deploy-config` on acceptance (both servers)

### Test 3: Single Server Deploy (Test Environment)

**Goal:** Verify single-server deploy still works.

**Steps:**
1. Trigger release workflow for `test` environment
2. Observe: single server deploy (test-01)
3. Verify: health check passes

### Test 4: Rollback

**Goal:** Verify rollback works with new two-phase commands.

**Steps:**
1. Deploy version A to acceptance
2. Deploy version B to acceptance
3. Trigger rollback operation
4. Verify both servers are back on version A

### Test 5: Scoped Deploy

**Goal:** Verify scope/filter works for targeting specific servers.

**Steps:**
1. Trigger release with scope=`server`, filter=`acc-01`
2. Verify: only acc-01 is deployed, acc-02 unchanged

## Registry Integration Test (After Registry Setup)

### Prerequisites

- [ ] Docker registry running and accessible from CI runner + both servers
- [ ] `insecure-registries` configured on all Docker daemons
- [ ] Connectivity verified: push from CI, pull from servers

### Test 6: Registry-Based Deploy

**Goal:** Verify build-once, pull-everywhere works.

**Steps:**
1. Update ScaffoldApp to registry strategy:
   - Replace `build:` with `image:` in docker-compose.yml
   - Add `REGISTRY_URL`, `IMAGE_NAME`, `IMAGE_TAG` to .env
2. Trigger release workflow
3. Observe: image built on CI runner, pushed to registry
4. Observe: both servers pull the image (no local build)
5. Observe: prepare + switch as before
6. Verify: both servers serve the same version

### Test 7: Registry Rollback

**Steps:**
1. Deploy with tag `20260329220000`
2. Deploy with tag `20260329230000`
3. Trigger rollback
4. Verify both servers are back to `20260329220000`

## Success Criteria

1. [ ] Two-phase deploy works: both servers prepare, then both switch
2. [ ] Version inconsistency window reduced to <5 seconds
3. [ ] All operations work through CLI
4. [ ] Single-server deploy still works
5. [ ] Rollback works
6. [ ] Scoped deploy works
7. [ ] (After registry setup) Registry deploy works
8. [ ] No regressions in existing functionality
