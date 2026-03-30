# Registry & Multi-Platform Backport Plan

> **Feature**: Backport registry strategy support to scaffold templates with multi-platform Docker builds
> **Status**: Planning Complete
> **Created**: 2026-03-30

## Overview

During testing of the registry deployment strategy on ScaffoldApp, we discovered several gaps between the blue-green-template scaffold system and what's needed for production registry deployments. This plan backports those learnings into the scaffold templates and adds multi-platform Docker build support via `docker buildx`.

The work covers four areas:
1. **Registry command refactor** — switch from `docker build`+`push` to `docker buildx build --push` for multi-arch support
2. **Workflow template backport** — add conditional registry steps (QEMU, buildx, docker login, platform) to release templates
3. **Scaffold generator updates** — platform prompt, workflow partials for registry vs in-place
4. **Integration testing** — end-to-end testing on ScaffoldApp for both strategies across single/multi-server topologies

## Document Index

| # | Document | Description |
|---|----------|-------------|
| 00 | [Index](00-index.md) | This document — overview and navigation |
| 01 | [Requirements](01-requirements.md) | Feature requirements and scope |
| 02 | [Current State](02-current-state.md) | Analysis of current templates vs ScaffoldApp changes |
| 03 | [Registry Command](03-registry-command.md) | Refactor registry.ts → buildx + cleanup |
| 04 | [Workflow Templates](04-workflow-templates.md) | Backport registry steps to release templates |
| 05 | [Scaffold Generator](05-scaffold-generator.md) | Platform prompt, partials, scaffold.js updates |
| 06 | [Integration Testing](06-integration-testing.md) | Testing strategy on ScaffoldApp |
| 99 | [Execution Plan](99-execution-plan.md) | Phases, sessions, task checklist |

## Key Decisions

| Decision | Outcome |
|----------|---------|
| Tag convention | Always `latest` (simple, overwrites) |
| Platform config | Static at scaffold time (prompt with presets) |
| Build tool | `docker buildx build --push` (always, even single-platform) |
| Image cleanup | `docker rmi` in registry command + `docker image prune -f` in workflow |
| ScaffoldApp testing | Separate git branches per strategy, no inventory rewrites |
| Multi-arch support | Comma-separated `--platform` (e.g., `linux/amd64,linux/arm64`) |

## Related Files

### Blue-green-template (this repo)
- `src/deploy-cli/commands/registry.ts` — Registry command (refactor target)
- `src/deploy-cli/types.ts` — RegistryOptions type
- `scaffold/templates/.github/workflows/release-single.yml` — Single-server release template
- `scaffold/templates/.github/workflows/release-multi.yml` — Multi-server release template
- `scaffold/scaffold.js` — Interactive scaffold generator
- `scaffold/templates/deployment/.env.example` — Environment template
- `scaffold/partials/` — Conditional partial files

### ScaffoldApp (test target)
- `/home/gevik/workdir/github/ScaffoldApp` on branch `feature/deploy-cli`
- `deploy-inventory.json` — Server inventory (test-01, acc-01, acc-02)
- `deployment/docker-compose.yml` — Currently configured for registry strategy
- `.github/workflows/release.yml` — Currently configured for registry with QEMU
