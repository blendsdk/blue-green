# Current State: Deploy CLI & Multi-Server Coordination

> **Document**: 02-current-state.md
> **Parent**: [Index](00-index.md)

## Existing Implementation

### Architecture Overview

```
Internet → ProxyBuilder (SSL termination, passthrough mode)
         → HTTP → Blue-Green Nginx (security hardening, rate limiting, blue/green routing)
         → App replicas (BlendSDK/WebAFX)
```

For multi-server environments, ProxyBuilder load-balances across multiple servers, each running their own independent blue-green stack.

### Current Deployment Flow (Multi-Server)

```
GitHub Actions workflow_dispatch
  → build_and_test job (build + yarn test)
  → prepare job (resolve servers from deploy-inventory.json)
  → deploy-direct job (matrix strategy, parallel per server)
      Per server:
        1. Setup SSH (inline bash: ~25 lines)
        2. Upload scripts (remote-ops.sh, health-check-wait.sh)
        3. Setup remote directories
        4. Deploy tarball (deploy-package.sh)
        5. Deploy Docker + Nginx config (inline bash: ~12 lines)
        6. Deploy config files from secrets (deploy-config-files.sh)
        7. Set deployment environment (inline bash: ~20 lines)
        8. blue-green-deploy (remote-ops.sh — builds + switches per server)
        9. Post-deploy health check
```

**The Problem:** Step 8 (`blue-green-deploy`) builds the Docker image AND switches traffic on each server independently. With 2+ servers, the build times vary, causing a window where some servers serve the new version and others still serve the old version.

### Current File Inventory

#### CI-Side Scripts (GitHub Actions runner)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `deployment/scripts/deploy-config-files.sh` | ~80 | Deploy config files from GitHub Secrets to server via SCP | → Absorbed into CLI |
| `deployment/scripts/multi-deploy.sh` | ~120 | Fan-out deployment to 20+ servers | → Absorbed into CLI |
| `deployment/scripts/resolve-config.js` | ~60 | Read deploy-config.json, output config entries | → Absorbed into CLI |
| `deployment/scripts/resolve-servers.js` | ~100 | Read deploy-inventory.json, output server matrix | → Absorbed into CLI |

#### Server-Side Scripts

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `deployment/scripts/remote-ops.sh` | ~420 | All server-side operations (deploy, switch, rollback, etc.) | → Modified (two-phase + registry) |
| `deployment/scripts/health-check-wait.sh` | ~60 | Poll Docker health until healthy | → Kept as-is |

#### Workflow Files

| File | Lines | Inline Bash | Purpose |
|------|-------|-------------|---------|
| `.github/workflows/build-test.yml` | ~30 | ~5 lines | Build + test on push/PR |
| `.github/workflows/release-single.yml` | ~180 | ~120 lines | Single-server release deploy |
| `.github/workflows/release-multi.yml` | ~280 | ~180 lines | Multi-server release deploy |
| `.github/workflows/operations-single.yml` | ~150 | ~100 lines | Single-server operations |
| `.github/workflows/operations-multi.yml` | ~140 | ~80 lines | Multi-server operations |

**Total inline bash in YAML: ~485 lines across 5 files**

#### Configuration Files

| File | Purpose | Status |
|------|---------|--------|
| `deploy-config.json` | Config file manifest + env defaults per environment | → Read by CLI |
| `deploy-inventory.json` | Server inventory per environment | → Read by CLI |

### Duplicated Bash Blocks

These blocks are copy-pasted across multiple workflow files:

| Block | Files | Lines Per Copy | Total |
|-------|-------|---------------|-------|
| SSH setup (key write, config, jump host) | release-single, release-multi (×2), ops-single, ops-multi | ~25 | ~125 |
| Deploy Docker/Nginx config (mkdir, scp tree) | release-single, release-multi | ~12 | ~24 |
| Set deployment environment (sed/grep .env) | release-single, release-multi | ~20 | ~40 |
| Resolve target (case test/acc/prod) | release-single, ops-single | ~10 | ~20 |

**Total duplicated bash: ~209 lines**

### Code Analysis: The Blue-Green Deploy Algorithm

Current `remote-ops.sh cmd_blue_green_deploy()` — 11 steps, all in one command:

```
Step 1:  Detect current active color (read upstream config)
Step 2:  Determine target color (opposite or --force-color)
Step 3:  Verify deployment tarball exists
Step 4:  Build target color image (docker compose build)          ← SLOW, variable
Step 5:  Start core + target replicas (docker compose up -d)      ← SLOW
Step 6:  Wait for health checks                                    ← SLOW, variable
─── Everything above = "prepare" phase ───
Step 7:  Switch Nginx upstream (copy config file)                  ← FAST (<1s)
Step 8:  Reload Nginx (nginx -s reload)                            ← FAST (<1s)
Step 9:  Verify traffic reaches new color                          ← FAST (~5s)
Step 10: Stop old color replicas                                   ← FAST (~2s)
Step 11: Docker cleanup                                            ← FAST (~1s)
─── Everything above = "switch" phase ───
```

**Prepare phase: 2-5 minutes (variable per server)**
**Switch phase: <10 seconds (nearly instant)**

This is why splitting into two phases solves the consistency problem — the slow, variable part happens first on all servers, then the fast, near-instant switch happens atomically.

## Gaps Identified

### Gap 1: Non-Atomic Multi-Server Switch

**Current Behavior:** Each server builds, health-checks, and switches independently. With 2 servers in acceptance, there's a 2-5 minute window where users hit different versions.

**Required Behavior:** All servers prepare (build + health) first, then all servers switch simultaneously.

**Fix Required:** Split `blue-green-deploy` into `blue-green-prepare` + `blue-green-switch`, orchestrate from CI.

### Gap 2: Redundant Docker Builds

**Current Behavior:** Each server builds the same Docker image independently from the same tarball. With N servers, we do N identical builds.

**Required Behavior:** For registry mode, build once on CI and push to registry. All servers pull the pre-built image.

**Fix Required:** New deployment strategy (registry), different Dockerfile/compose, different remote-ops commands.

### Gap 3: Bash Duplication in Workflows

**Current Behavior:** ~209 lines of bash duplicated across 5 workflow files. SSH setup alone is copy-pasted 5 times.

**Required Behavior:** Workflow YAML calls CLI commands. No inline bash logic.

**Fix Required:** Deploy CLI absorbs all orchestration logic.

### Gap 4: No Orchestration Layer

**Current Behavior:** GitHub Actions matrix strategy provides parallelism but no coordination between matrix jobs. Each job is independent.

**Required Behavior:** A coordination layer that can: run operations on all servers in parallel, wait for all to complete, then proceed to next phase.

**Fix Required:** Deploy CLI provides this orchestration (or GitHub Actions job dependencies provide the barrier between prepare and switch jobs).

### Gap 5: Hard-Coded Nginx Directory List

**Current Behavior:** Workflow bash lists every nginx subdirectory explicitly in `scp` commands: `conf.d`, `includes`, `locations`, `upstreams`. Adding a new directory requires updating multiple files.

**Required Behavior:** Auto-discover nginx subdirectories or use a single recursive copy.

**Fix Required:** CLI uses `scp -r` or discovers directories dynamically.

## Dependencies

### Internal Dependencies

- `remote-ops.sh` — must be updated first (Phase 4) before CLI can call new commands
- `scaffold/scaffold.js` — must be updated after CLI is ready (Phase 7)
- Workflow templates — must be updated after CLI is ready (Phase 6)

### External Dependencies

- **esbuild** — dev dependency for building CLI (npm install)
- **Docker registry** — required for registry deployment strategy testing (Phase 8)
- **ScaffoldApp** — test project for integration testing (Phase 8)
- **Servers acc-01 + acc-02** — real servers for integration testing

## Risks and Concerns

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| esbuild can't bundle Node.js child_process usage | Very Low | High | child_process is a Node.js built-in, esbuild handles it natively with `platform: 'node'` |
| SSH operations in Node.js are less reliable than bash | Low | High | We use `child_process.spawn('ssh', ...)` — literally the same `ssh` binary, just spawned by Node |
| Registry network issues between CI and servers | Medium | Medium | Test connectivity early; document `insecure-registries` requirement |
| Breaking existing deployments during migration | Medium | High | New branch; ScaffoldApp migration is a separate commit; can revert |
| Scaffold consumers with existing projects | Low | Low | Old `blue-green-deploy` command still works; new commands are additive |
| TypeScript compilation issues in CI | Low | Medium | CLI is pre-compiled; CI just runs the bundled JS |
