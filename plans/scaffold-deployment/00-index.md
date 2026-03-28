# Blue-Green Deployment Scaffold — Implementation Plan

> **Feature**: Curl-installable scaffold that adds blue-green deployment infrastructure to any BlendSDK application
> **Status**: Planning Complete
> **Created**: 2026-03-28

## Overview

Transform the `blue-green` repository into a **scaffold source** that can be installed into any BlendSDK application via a single `curl | bash` command. The scaffold generates a complete deployment infrastructure including:

- **Zero-downtime blue-green deployments** via Docker Compose profiles + Nginx upstream switching
- **GitHub Actions CI/CD** pipelines (build-test, release with blue-green deploy, operations panel)
- **Declarative config management** via `deploy-config.json` manifest (secrets → server)
- **Multi-server support** (single server, jump host, deployment server fan-out for 200+ clients)
- **Security hardening** at the Nginx layer (behind ProxyBuilder for SSL termination)
- **Interactive Node.js generator** with non-interactive flag support for automation

### Architecture

```
Internet → ProxyBuilder (SSL termination, passthrough mode)
         → HTTP → Blue-Green Nginx (security hardening, rate limiting, routing)
         → App replicas (blue or green, BlendSDK/WebAFX)
```

### Deployment Flow

```
Developer machine:
  1. curl -fsSL .../install.sh | bash        ← Scaffold the infrastructure
  2. ./scripts/push-secrets.sh acceptance    ← Push configs to GitHub Secrets

GitHub Actions (release.yml):
  3. Build → Test → deploy-package.sh → tarball
  4. SSH → upload tarball + configs → remote-ops.sh blue-green-deploy

On server:
  5. Build new color → health check → switch Nginx → stop old color
```

## Document Index

| #  | Document | Description |
|----|----------|-------------|
| 00 | [Index](00-index.md) | This document — overview and navigation |
| 01 | [Requirements](01-requirements.md) | Requirements, scope, topology matrix |
| 02 | [Current State](02-current-state.md) | Current blue-green + LogixControl analysis |
| 03 | [Scaffold Structure](03-scaffold-structure.md) | Directory layout, template placeholder system |
| 04 | [Deployment Infra](04-deployment-infra.md) | docker-compose, Dockerfile, .env, nginx, pg-backup, dozzle |
| 05 | [Remote Ops](05-remote-ops.md) | remote-ops.sh: blue-green deploy + operations + health-check-all |
| 06 | [Config Management](06-config-management.md) | deploy-config.json, push-secrets.sh, deploy-config-files.sh |
| 07 | [Deploy Package](07-deploy-package.md) | deploy-package.sh: generalized tarball builder |
| 08 | [GitHub Actions](08-github-actions.md) | release.yml, operations.yml, build-test.yml, SECRETS-SETUP.md |
| 09 | [Multi-Server](09-multi-server.md) | deploy-inventory.json, resolve-servers.js, multi-deploy.sh |
| 10 | [Scaffold Generator](10-scaffold-generator.md) | scaffold.js: Node.js interactive generator |
| 11 | [Installer](11-installer.md) | install.sh: curl one-liner wrapper |
| 12 | [Testing Strategy](12-testing-strategy.md) | Verification approach for the scaffold |
| 99 | [Execution Plan](99-execution-plan.md) | Phases, sessions, task checklist |

## Key Decisions

| Decision | Outcome |
|----------|---------|
| Scaffold install method | `curl -fsSL .../install.sh \| bash` (like Docker, NVM) |
| Scaffold generator language | Node.js (zero external deps, built-in readline) |
| Deployment files location in app repo | `deployment/` parent directory |
| Config management | Declarative `deploy-config.json` manifest |
| JSON parsing (no jq) | Node.js (`resolve-config.js`, `resolve-servers.js`) |
| Secret pushing | `push-secrets.sh` using `gh secret set` + manifest |
| Multi-server (20+) | Deployment server fan-out pattern |
| Multi-server (<20) | GitHub Actions matrix strategy |
| Monitoring (small scale) | Dozzle per server |
| Monitoring (large scale) | health-check-all aggregator + docs recommending Grafana |

## Related Files / Inspirational Sources

- **LogixControl**: `/home/gevik/workdir/github/LogixControl/LogixControl/`
  - `scripts/remote-ops.sh` — subcommand dispatch pattern
  - `scripts/gh-secrets-sync.sh` — secret pushing with preflight checks
  - `deploy-package.sh` — tarball builder for monorepos
  - `.github/workflows/release.yml` — SSH deployment pipeline
  - `.github/workflows/operations.yml` — operations panel
  - `docker/pg-backup.sh` — backup sidecar pattern
- **Blue-green** (this repo):
  - `scripts/switch-environment.sh` — 11-step blue-green switcher
  - `nginx/` — modular security-hardened config
  - `docker-compose.yml` — profile-based blue/green services
