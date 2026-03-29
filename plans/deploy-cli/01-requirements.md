# Requirements: Deploy CLI & Multi-Server Coordination

> **Document**: 01-requirements.md
> **Parent**: [Index](00-index.md)

## Feature Overview

Replace the current bash-heavy GitHub Actions deployment workflows with a TypeScript-based deployment CLI that provides:
- Two-phase coordinated multi-server deploys (prepare all → switch all)
- Support for both in-place and registry-based deployment strategies
- Simplified workflow YAML (thin orchestration, CLI does the work)
- Type-safe, testable, maintainable deployment logic

## Functional Requirements

### Must Have

- [ ] **Two-phase deploy coordination** — `prepare` (build + health) on all servers, then `switch` (nginx swap) on all servers, eliminating the version inconsistency window
- [ ] **TypeScript Deploy CLI** — single bundled JS file, zero runtime dependencies, runs with just `node`
- [ ] **In-place deployment** — current tarball-based strategy continues to work
- [ ] **Registry-based deployment** — build once on CI, push to registry, all servers pull
- [ ] **Scaffold choice** — interactive prompt for deployment strategy (in-place / registry)
- [ ] **SSH orchestration** — CLI handles SSH config, key management, jump host support
- [ ] **Multi-server parallel execution** — prepare/switch run on all servers concurrently
- [ ] **Config deployment** — CLI handles deploy-config.json resolution and secret file deployment
- [ ] **Backward compatibility** — `remote-ops.sh blue-green-deploy` still works for single-server use
- [ ] **Progress reporting** — structured output showing per-server status during multi-server operations
- [ ] **Simplified workflows** — all 5 GitHub Actions workflow files refactored to call CLI commands

### Should Have

- [ ] **Error recovery** — if `prepare` fails on one server, report which servers succeeded/failed
- [ ] **Dry-run mode** — `--dry-run` flag that shows what would happen without executing
- [ ] **Configurable parallelism** — `--max-parallel N` for large deployments
- [ ] **Image tagging** — `YYYYMMDDHHMMSS` format with git SHA as Docker label

### Won't Have (Out of Scope)

- Kubernetes migration — we stay with Docker Compose
- Ansible/Terraform integration — CLI replaces this need
- Automated registry provisioning — user manages their own registry
- Changes to ProxyBuilder — stays as external SSL terminator
- Changes to application layer (app code, Dockerfile base, nginx configs)
- GitHub Actions reusable workflows / composite actions
- GUI or web dashboard for deployments

## Technical Requirements

### Runtime

- Node.js 18+ (for `fetch` API availability in remote-ops health checks)
- Zero external npm dependencies at runtime
- Single bundled JS file (esbuild output)
- Works on Linux (self-hosted GitHub Actions runners)

### Build

- TypeScript source compiled with esbuild
- esbuild is the only dev dependency
- Bundled output is git-tracked (scaffold consumers don't need esbuild)

### Compatibility

- Must work with current GitHub Actions self-hosted runner setup
- Must work with current SSH/SCP-based deployment model
- Must work behind jump hosts
- Must support Docker Compose profiles (blue/green/core/all)
- `remote-ops.sh` changes must be backward compatible

### Security

- SSH keys handled via environment variables (from GitHub Secrets)
- No secrets written to workflow logs
- Temp SSH key files cleaned up after use
- Registry authentication via `docker login` (standard Docker mechanism)

## Scope Decisions

| Decision | Options Considered | Chosen | Rationale |
|----------|-------------------|--------|-----------|
| CLI language | Bash, Node.js (JS), TypeScript, Go, Python | TypeScript | Matches ecosystem, type safety, bundleable to zero-dep JS |
| Bundler | esbuild, rollup, webpack, tsx | esbuild | Fastest, simplest config for Node.js CLI bundling |
| Server-side tool | Rewrite in TS too / Keep bash | Keep bash (`remote-ops.sh`) | docker compose commands are inherently shell; no benefit to TS |
| Old scripts | Keep deprecated / Remove | Remove | Clean break; old logic absorbed into CLI |
| Registry type | GHCR / Docker Hub / Self-hosted | Self-hosted (`registry:3`) | No internet dependency from target servers |
| Image tag format | Git SHA / Semver / Timestamp | `YYYYMMDDHHMMSS` | Sortable, human-readable, unique |
| CLI scope | CI-side only / Also server-side | CI-side only | Server-side stays bash; CLI orchestrates via SSH |

## Acceptance Criteria

1. [ ] Deploy CLI compiles from TypeScript and produces a single JS file
2. [ ] `node deploy-cli.js prepare --env acceptance` builds images on all acceptance servers in parallel
3. [ ] `node deploy-cli.js switch --env acceptance` switches nginx on all acceptance servers in parallel
4. [ ] `node deploy-cli.js deploy --env acceptance` does prepare + switch (coordinated)
5. [ ] Version inconsistency window reduced from minutes to <5 seconds
6. [ ] Registry-based deployment works: build on CI → push → all servers pull → prepare → switch
7. [ ] All 5 workflow files simplified to call CLI commands
8. [ ] Scaffold generator offers deployment strategy choice
9. [ ] ScaffoldApp successfully migrated and tested on acc-01 + acc-02
10. [ ] All existing operations (restart, rollback, health-check, etc.) continue to work
11. [ ] Documentation updated
