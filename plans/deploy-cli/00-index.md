# Deploy CLI & Multi-Server Coordination

> **Feature**: TypeScript deployment CLI with two-phase coordinated multi-server deploys and registry-based deployment support
> **Status**: Planning Complete
> **Created**: 2026-03-29
> **Branch**: `feature/deploy-cli`

## Overview

This plan refactors the blue-green deployment system from bash-in-YAML orchestration to a TypeScript deployment CLI. The CLI replaces scattered bash scripts and inline shell in GitHub Actions workflows with a single, typed, testable orchestration tool.

The core problem being solved: when deploying to multiple servers in the same environment (e.g., two acceptance servers), the current system builds Docker images and switches blue/green independently per server. This creates an inconsistency window where some servers run the new version and others still run the old version, while ProxyBuilder load-balances across all of them.

The solution introduces:
1. **Two-phase deployment** — build all servers first (prepare), then switch all atomically (switch)
2. **TypeScript Deploy CLI** — replaces bash scripts with a typed, testable Node.js tool
3. **Registry-based deployment** — optional strategy where images are built once and pulled everywhere
4. **Simplified GitHub Actions workflows** — YAML becomes thin orchestration, CLI does the work

## Document Index

| #  | Document | Description |
|----|----------|-------------|
| 00 | [Index](00-index.md) | This document — overview and navigation |
| 01 | [Requirements](01-requirements.md) | Feature requirements and scope |
| 02 | [Current State](02-current-state.md) | Analysis of current architecture |
| 03 | [Deploy CLI Architecture](03-deploy-cli-architecture.md) | CLI design, commands, TypeScript structure |
| 04 | [Remote Ops Updates](04-remote-ops-updates.md) | remote-ops.sh changes (two-phase, registry) |
| 05 | [Registry Deployment](05-registry-deployment.md) | Registry-based deployment strategy |
| 06 | [Workflow Refactoring](06-workflow-refactoring.md) | GitHub Actions YAML simplification |
| 07 | [Scaffold Updates](07-scaffold-updates.md) | scaffold.js changes (new prompts, templates) |
| 08 | [ScaffoldApp Migration](08-scaffoldapp-migration.md) | ScaffoldApp migration & integration testing |
| 09 | [Testing Strategy](09-testing-strategy.md) | Testing approach |
| 99 | [Execution Plan](99-execution-plan.md) | Phases, sessions, task checklist |

## Quick Reference

### Architecture Layers

```
┌──────────────────────────────────┐
│  GitHub Actions YAML             │  ← Thin: triggers + calls deploy-cli
└──────────────┬───────────────────┘
               │
┌──────────────▼───────────────────┐
│  deploy-cli.js (TypeScript→JS)   │  ← Orchestration: SSH, config,
│                                   │     multi-server coordination,
│  CI-side only                    │     progress reporting
└──────────────┬───────────────────┘
               │ SSH
┌──────────────▼───────────────────┐
│  remote-ops.sh (Bash)            │  ← Server-side: docker compose,
│                                   │     nginx config, health checks
│  Server-side only                │
└──────────────────────────────────┘
```

### Deployment Strategies

| Strategy | Build | Transfer | Deploy |
|----------|-------|----------|--------|
| **In-place** | On each server | Tarball via SCP | `docker compose build` |
| **Registry** | On CI runner | Push to registry | `docker compose pull` |

### Key Decisions

| Decision | Outcome |
|----------|---------|
| CLI language | TypeScript, bundled to single JS via esbuild |
| CLI location | `deployment/scripts/deploy-cli.js` |
| TypeScript source | `src/deploy-cli/` in blue-green-template repo |
| Zero runtime deps | Yes — Node.js built-ins only |
| Old bash scripts | Replaced, not kept as fallback |
| Image tag format | `YYYYMMDDHHMMSS` |
| Registry | Self-hosted, TBD location (prerequisite for Phase 8) |
| `remote-ops.sh` | Updated with `blue-green-prepare` + `blue-green-switch` |

## Related Files

### Created/Modified in blue-green-template

```
src/deploy-cli/                    ← NEW: TypeScript source
  index.ts
  commands/*.ts
  lib/*.ts
  types.ts
tsconfig.json                      ← NEW: TypeScript config
package.json                       ← NEW: esbuild + build scripts
scaffold/templates/deployment/scripts/deploy-cli.js  ← NEW: bundled output
scaffold/templates/deployment/scripts/remote-ops.sh  ← MODIFIED: two-phase + registry
scaffold/templates/.github/workflows/*.yml           ← MODIFIED: simplified
scaffold/scaffold.js               ← MODIFIED: new prompts
```

### Files Removed from scaffold/templates

```
scaffold/templates/deployment/scripts/deploy-config-files.sh  ← absorbed into CLI
scaffold/templates/deployment/scripts/multi-deploy.sh          ← absorbed into CLI
scaffold/templates/deployment/scripts/resolve-config.js        ← absorbed into CLI
scaffold/templates/deployment/scripts/resolve-servers.js       ← absorbed into CLI
```
