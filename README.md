# Blue-Green Deployment Template

A production-ready **blue-green deployment** scaffold for [BlendSDK](https://github.com/niceflag/niceflag-sdk) / WebAFX applications. One command installs complete deployment infrastructure — Docker Compose, Nginx, GitHub Actions CI/CD, and a TypeScript Deploy CLI — giving you zero-downtime deployments from day one.

Designed to run behind [ProxyBuilder](https://github.com/TrueSoftwareNL/nginx-proxy), which handles SSL termination. This template handles everything else: security headers, rate limiting, blue-green traffic routing, and multi-server orchestration.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [How Blue-Green Deployments Work](#how-blue-green-deployments-work)
- [Installation](#installation)
  - [Interactive Mode](#interactive-mode)
  - [Non-Interactive Mode](#non-interactive-mode)
  - [Pinning a Version](#pinning-a-version)
  - [Scaffold Flags Reference](#scaffold-flags-reference)
- [Deployment Strategies](#deployment-strategies)
  - [In-Place Strategy](#in-place-strategy)
  - [Registry Strategy](#registry-strategy)
  - [Strategy Comparison](#strategy-comparison)
- [Multi-Platform Builds](#multi-platform-builds)
  - [How It Works](#how-it-works)
  - [Supported Platforms](#supported-platforms)
  - [Mixed-Architecture Fleets](#mixed-architecture-fleets)
- [What Gets Generated](#what-gets-generated)
- [Tutorial: Your First Deployment](#tutorial-your-first-deployment)
  - [Step 1 — Install the Scaffold](#step-1--install-the-scaffold)
  - [Step 2 — Configure Environments](#step-2--configure-environments)
  - [Step 3 — Push Secrets to GitHub](#step-3--push-secrets-to-github)
  - [Step 4 — Set Infrastructure Secrets](#step-4--set-infrastructure-secrets)
  - [Step 5 — Build and Verify Locally](#step-5--build-and-verify-locally)
  - [Step 6 — Deploy](#step-6--deploy)
- [Architecture](#architecture)
  - [Network Flow](#network-flow)
  - [ProxyBuilder Integration](#proxybuilder-integration)
  - [Blue-Green Switching](#blue-green-switching)
- [Deploy CLI Reference](#deploy-cli-reference)
  - [Why a CLI?](#why-a-cli)
  - [Commands](#commands)
  - [Global Options](#global-options)
  - [Registry Options](#registry-options)
  - [Two-Phase Deploy (Barrier Pattern)](#two-phase-deploy-barrier-pattern)
  - [Workflow Examples](#workflow-examples)
  - [Server Inventory](#server-inventory)
- [Deployment Topologies](#deployment-topologies)
  - [Single Server](#single-server)
  - [Multi Server](#multi-server)
- [Remote Operations Reference](#remote-operations-reference)
- [Docker Compose Profiles](#docker-compose-profiles)
- [Security](#security)
- [Development](#development)
  - [Building the Deploy CLI](#building-the-deploy-cli)
  - [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [License](#license)

---

## Overview

**What it is:** A scaffold generator that adds complete blue-green deployment infrastructure to any Node.js / BlendSDK application. You run one `curl` command and answer a few questions — it generates everything you need: Docker configs, Nginx configs, GitHub Actions workflows, deployment scripts, and a TypeScript Deploy CLI.

**Who it's for:**

- Teams deploying BlendSDK/WebAFX applications
- Projects that need zero-downtime deployments
- Setups using ProxyBuilder for SSL termination
- Deployments ranging from a single server to 200+ servers

**What you get:**

- ✅ Zero-downtime blue-green deployments
- ✅ Two deployment strategies: **in-place** (build on server) or **registry** (build once, pull everywhere)
- ✅ Multi-platform Docker builds (amd64, arm64, or both) via buildx
- ✅ GitHub Actions workflows for CI/CD and operations
- ✅ TypeScript Deploy CLI with 57 unit tests
- ✅ Full security hardening (HSTS, CSP, rate limiting, GDPR-compliant logging)
- ✅ Single-server and multi-server topologies
- ✅ Dozzle web-based log viewer on every server

---

## Quick Start

Get running in 60 seconds:

```bash
# 1. Run from your project root — answer the interactive prompts
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash

# 2. Set up your environment
mkdir -p local_data/test
cp deployment/.env.example local_data/test/.env
# Edit local_data/test/.env with your values

# 3. Push secrets to GitHub
./scripts/push-secrets.sh test

# 4. Build locally to verify
cd deployment && docker compose --profile all build

# 5. Deploy — push to main or trigger the workflow manually
```

That's it. The generated GitHub Actions workflows handle the rest.

---

## How Blue-Green Deployments Work

Blue-green deployment maintains **two identical environments** — "blue" and "green". At any time, only one receives live traffic:

```
                    ┌──────────────────────┐
                    │       Nginx          │
                    │  (reverse proxy)     │
                    └──────────┬───────────┘
                               │
               active ─────────┤
               upstream        │
                               │
          ┌────────────────────┼────────────────────┐
          │                                         │
   ┌──────▼──────┐                          ┌───────▼─────┐
   │  🔵 Blue    │    ◄── LIVE traffic      │  🟢 Green   │    ◄── idle
   │  (v1.2.0)   │                          │  (standby)  │
   └─────────────┘                          └─────────────┘
```

When you deploy a new version:

1. **Prepare** — Build/pull the new version on the idle color (green), start it, run health checks
2. **Switch** — Swap Nginx upstream from blue → green (instant, zero downtime)
3. **Cleanup** — Stop the old color (blue), which becomes the new standby

If anything goes wrong during prepare, the switch never happens. Your users never see a broken deployment.

---

## Installation

### Interactive Mode

The installer downloads the scaffold repo and runs an interactive generator:

```bash
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash
```

You'll be asked about:

1. **Project basics** — name, port, replicas, entrypoint
2. **Infrastructure** — PostgreSQL, Redis
3. **Deployment strategy** — in-place or registry
4. **Platform** (registry only) — target architecture(s) for Docker builds
5. **Topology** — single-server or multi-server

### Non-Interactive Mode

Provide all answers via flags for CI or scripted setup:

```bash
# In-place strategy, single server, with PostgreSQL
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash -s -- \
  --name my-app \
  --port 3000 \
  --with-postgres \
  --single \
  --strategy in-place

# Registry strategy, multi server, with platform targeting
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash -s -- \
  --name my-api \
  --port 4000 \
  --with-postgres \
  --with-redis \
  --multi \
  --strategy registry \
  --registry-url registry.internal:5000 \
  --platform linux/amd64,linux/arm64

# Minimal — just the name (everything else uses defaults)
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash -s -- \
  --name my-service
```

### Pinning a Version

By default, the installer uses the `master` branch. Pin to a specific version with `BG_VERSION`:

```bash
BG_VERSION=v1.0.0 curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/v1.0.0/install.sh | bash
```

### Scaffold Flags Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--name <name>` | Project name (required for non-interactive) | Directory name |
| `--port <port>` | Application port | `3000` |
| `--nginx-port <port>` | Nginx HTTP port | `80` |
| `--replicas <count>` | App replicas per color | `2` |
| `--entry <command>` | App entrypoint command | `node server.js` |
| `--strategy <in-place\|registry>` | Deployment strategy | `in-place` |
| `--registry-url <url>` | Docker registry URL (registry strategy) | — |
| `--platform <platform>` | Target platform(s) for Docker builds (registry strategy) | Native arch |
| `--with-postgres` | Include PostgreSQL | Ask (interactive) |
| `--no-postgres` | Exclude PostgreSQL | — |
| `--with-redis` | Include Redis | `false` |
| `--no-redis` | Exclude Redis | — |
| `--single` | Single-server topology | Default |
| `--multi` | Multi-server topology | — |
| `--force` | Overwrite existing files | Skip existing |
| `--dry-run` | Preview without writing files | — |
| `--help`, `-h` | Show help message | — |

> **Note:** `--registry-url` is required when `--strategy registry` is used. `--platform` is only relevant for the registry strategy — in-place builds always use the server's native architecture.

---

## Deployment Strategies

The scaffold supports two deployment strategies. The strategy is **auto-detected at runtime** by `remote-ops.sh` — it checks whether `docker-compose.yml` uses `image:` (registry) or `build:` (in-place).

### In-Place Strategy

Source code is uploaded as a tarball to each server, where Docker builds the image locally.

```
CI Runner                         Server
┌────────────────┐               ┌────────────────────┐
│ Create tarball  │──── SCP ────►│ Unpack tarball      │
│ Upload to server│              │ docker compose build│
└────────────────┘               │ Start containers    │
                                 │ Health check        │
                                 └────────────────────┘
```

**Pros:**
- Simple — no registry infrastructure needed
- Works with any server setup
- No Docker login required on servers

**Cons:**
- Each server builds independently (slower for many servers)
- Build time multiplied by server count
- Requires build tools on every server

**Choose in-place when:** You have 1–3 servers per environment, or don't want to manage a registry.

### Registry Strategy

Docker images are built once on the CI runner and pushed to a private registry. Servers pull the pre-built image.

```
CI Runner                     Registry                     Servers
┌──────────────┐             ┌───────────┐               ┌─────────────────┐
│ docker buildx │── push ───►│  Private   │◄── pull ────│ docker compose  │
│ build --push  │            │  Registry  │              │ pull + up       │
└──────────────┘             └───────────┘               └─────────────────┘
```

**Pros:**
- Build once, deploy to many servers instantly
- Consistent images across all servers (same digest)
- Multi-platform support via buildx (build amd64 + arm64 in one command)
- Faster deployments at scale

**Cons:**
- Requires a Docker registry (e.g., `registry:2` with htpasswd auth)
- Servers need registry access (network + credentials in `.env`)
- Slightly more complex initial setup

**Choose registry when:** You have 3+ servers, need multi-platform builds, or want faster deploys.

### Strategy Comparison

| Feature | In-Place | Registry |
|---------|----------|----------|
| Build location | Each server | CI runner (once) |
| Requires registry | No | Yes |
| Multi-platform builds | No (native arch only) | Yes (via buildx + QEMU) |
| Deploy speed (10 servers) | ~10× build time | ~1× build + fast pull |
| Image consistency | Per-server build | Identical digest |
| Docker login on servers | Not needed | Required |
| Generated `docker-compose.yml` | Uses `build:` directive | Uses `image:` directive |
| Strategy detection | `build:` in compose | `image:` in compose |

---

## Multi-Platform Builds

> **Applies to the registry strategy only.** In-place builds always use the server's native architecture.

### How It Works

When using the registry strategy, Docker images are built using `docker buildx build --push`. This supports building for multiple CPU architectures in a single command:

```bash
# Build for ARM64 servers from an AMD64 CI runner
node deploy-cli.js registry \
  --registry-url registry.internal:5000 \
  --image-name my-app \
  --platform linux/arm64

# Build for both AMD64 and ARM64 (mixed fleet)
node deploy-cli.js registry \
  --registry-url registry.internal:5000 \
  --image-name my-app \
  --platform linux/amd64,linux/arm64
```

Behind the scenes:

1. **QEMU** is registered on the CI runner to emulate non-native architectures
2. **Docker Buildx** creates a builder instance that uses the `docker-container` driver
3. **buildx build --push** builds for each platform, creates a **manifest list**, and pushes directly to the registry
4. When a server pulls the image, Docker automatically selects the correct architecture from the manifest list

### Supported Platforms

| Platform | Description | Common Use |
|----------|-------------|------------|
| `linux/amd64` | x86-64 (Intel/AMD) | Most cloud VMs, traditional servers |
| `linux/arm64` | ARM 64-bit | AWS Graviton, Apple Silicon, Raspberry Pi 4 |
| `linux/amd64,linux/arm64` | Both architectures | Mixed fleets |

### Mixed-Architecture Fleets

If your servers have different CPU architectures (e.g., some amd64, some arm64), use a comma-separated platform list:

```bash
# Scaffold with multi-platform support
curl -fsSL .../install.sh | bash -s -- \
  --name my-app \
  --strategy registry \
  --registry-url registry.internal:5000 \
  --platform linux/amd64,linux/arm64 \
  --multi
```

The generated GitHub Actions workflow will:

1. Set up QEMU for cross-platform emulation
2. Create a buildx builder
3. Login to your registry
4. Build a multi-arch image and push a manifest list
5. Each server pulls the correct architecture automatically

> **CI Runner Requirement:** QEMU must be available on the CI runner for cross-platform builds. The generated workflow handles this automatically via `docker run --privileged multiarch/qemu-user-static --reset -p yes`.

---

## What Gets Generated

The scaffold creates a complete deployment infrastructure tailored to your choices:

```
your-project/
├── deployment/                      # Docker deployment directory
│   ├── docker-compose.yml           # Blue/green profiles, Nginx, Dozzle, optional services
│   ├── Dockerfile                   # Multi-stage Node.js build
│   ├── .env.example                 # Environment variable template
│   ├── pg-backup.sh                 # PostgreSQL backup script (if Postgres enabled)
│   ├── nginx/                       # Modular Nginx configuration
│   │   ├── nginx.conf               # Main config (behind ProxyBuilder)
│   │   ├── conf.d/                  # Server-level includes
│   │   ├── includes/                # Shared config (headers, proxy, security)
│   │   ├── locations/               # Location blocks (numbered for ordering)
│   │   └── upstreams/               # Blue/green upstream definitions
│   └── scripts/                     # Deployment scripts
│       ├── deploy-cli.js            # Deploy CLI — orchestrates deployments from CI
│       ├── remote-ops.sh            # Server-side operations (deploy, switch, rollback, etc.)
│       └── health-check-wait.sh     # Health check polling utility
├── scripts/
│   └── push-secrets.sh              # Push local config files → GitHub Secrets
├── deploy-config.json               # Declarative config file manifest
├── deploy-inventory.json            # Server inventory per environment (multi-server only)
├── deploy-package.sh                # Tarball builder for deployment artifacts
├── .github/
│   ├── SECRETS-SETUP.md             # Complete GitHub Secrets documentation
│   └── workflows/
│       ├── build-test.yml           # CI: build + test on every push/PR
│       ├── release.yml              # CD: full blue-green deploy pipeline
│       └── operations.yml           # Ops: health-check, restart, rollback, etc.
├── local_data/                      # Per-environment config (gitignored)
│   └── .gitkeep
└── .gitignore                       # Configured for deployment project
```

**What changes based on your choices:**

| Choice | Effect |
|--------|--------|
| **In-place strategy** | `docker-compose.yml` uses `build:` directive |
| **Registry strategy** | `docker-compose.yml` uses `image:` directive; `.env` includes registry vars; workflow includes buildx + QEMU steps |
| **PostgreSQL** | Adds postgres + pg-backup services, backup script, database operations, env vars |
| **Redis** | Adds redis service and env vars |
| **Single server** | Generates `release.yml` (single deploy job) |
| **Multi server** | Generates `release.yml` with three-job barrier pattern + `deploy-inventory.json` |
| **Platform** | Sets `--platform` in generated workflow registry steps |

---

## Tutorial: Your First Deployment

This tutorial walks through setting up a complete blue-green deployment for a BlendSDK application. We'll use the in-place strategy on a single server — the simplest setup to start with.

### Step 1 — Install the Scaffold

From your project root:

```bash
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash
```

Answer the prompts:

```
🚀 Blue-Green Deployment Scaffold Generator

── Project Configuration ──────────────────────
Project name [my-app]: my-app
Application port [3000]: 3000
Nginx HTTP port (ProxyBuilder forwards here) [80]: 80
App replicas per color (blue/green) [2]: 2
App entrypoint command [node server.js]: node server.js

── Infrastructure ─────────────────────────────
Include PostgreSQL? [Y/n]: Y
Include Redis? [y/N]: N

── Deployment Strategy ────────────────────────
Deployment strategy:
  ● 1) in-place — Build Docker image on each server
  ○ 2) registry — Build once, push to registry, all servers pull
Choice [1]: 1

── Deployment Topology ────────────────────────
Deployment topology:
  ● 1) Single server — one server per environment
  ○ 2) Multi server — multiple servers per environment
Choice [1]: 1
```

The scaffold generates ~40 files. Review what was created:

```bash
ls -la deployment/
ls -la .github/workflows/
```

### Step 2 — Configure Environments

Create environment-specific configuration:

```bash
# Create directories for each environment
mkdir -p local_data/{test,acceptance,production}

# Copy the template to each environment
cp deployment/.env.example local_data/test/.env
cp deployment/.env.example local_data/acceptance/.env
cp deployment/.env.example local_data/production/.env
```

Edit each `.env` with environment-specific values:

```bash
# local_data/test/.env
COMPOSE_PROJECT_NAME=my-app
APP_REPLICAS=1
ACTIVE_ENV=blue
DEPLOY_ENV=test
NGINX_HTTP_PORT=80
DOZZLE_PORT=9999
DOZZLE_USERNAME=admin
DOZZLE_PASSWORD=your-secure-password-here

# PostgreSQL (if enabled)
POSTGRES_USER=myapp
POSTGRES_PASSWORD=your-db-password-here
POSTGRES_DB=myapp_test
```

Also create your app config if needed:

```bash
# local_data/test/app-config.json
{
  "database": "postgresql://myapp:password@postgres:5432/myapp_test",
  "port": 3000
}
```

### Step 3 — Push Secrets to GitHub

The `push-secrets.sh` script reads files from `local_data/<env>/` and pushes them as GitHub Secrets:

```bash
# Push test environment secrets
./scripts/push-secrets.sh test

# Push all environments at once
./scripts/push-secrets.sh --all
```

> **Prerequisite:** The [GitHub CLI](https://cli.github.com/) (`gh`) must be installed and authenticated: `gh auth login`

### Step 4 — Set Infrastructure Secrets

Go to **GitHub → Settings → Secrets and variables → Actions** and add:

| Secret | Description | Example |
|--------|-------------|---------|
| `DEPLOY_PATH` | Remote deployment path (must be absolute) | `/opt/my-app` |
| `TEST_SERVER` | SSH address for test environment | `deploy@10.0.0.3` |
| `ACC_SERVER` | SSH address for acceptance environment | `deploy@10.0.0.4` |
| `PROD_SERVER` | SSH address for production environment | `deploy@10.0.0.5` |
| `SSH_PRIVATE_KEY` | SSH private key for server access | (contents of id_ed25519) |

> **⚠️ Important:** `DEPLOY_PATH` must be an absolute path like `/opt/my-app` — not `~/my-app` (tilde expands on the CI runner, not the remote server).

For registry strategy, also add:

| Secret | Description | Example |
|--------|-------------|---------|
| `REGISTRY_URL` | Docker registry URL | `registry.internal:5000` |
| `REGISTRY_USER` | Registry username | `deploy` |
| `REGISTRY_PASSWORD` | Registry password | (your password) |

See `.github/SECRETS-SETUP.md` in your generated project for complete documentation.

### Step 5 — Build and Verify Locally

Test that everything builds correctly:

```bash
cd deployment

# Build all Docker images
docker compose --profile all build

# Start core infrastructure + blue environment
docker compose --profile core --profile blue up -d

# Verify health endpoint
curl -sf http://localhost/health | jq .

# Check logs
docker compose logs -f app_blue
```

If everything looks good:

```bash
# Stop everything
docker compose --profile all down
cd ..
```

### Step 6 — Deploy

You have two options:

**Option A: Manual deploy via GitHub Actions**

1. Go to **Actions** → **Release** → **Run workflow**
2. Select the environment (test / acceptance / production)
3. Click **Run workflow**

**Option B: Automate on push** (modify the generated workflow)

Edit `.github/workflows/release.yml` to trigger on push:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    # ... keep manual trigger too
```

**What happens during deploy:**

1. Build & test your application
2. Create deployment tarball
3. Upload tarball + configs to the server via SSH
4. Deploy config files from GitHub Secrets
5. Run blue-green deploy: prepare (build + health) → switch (Nginx swap)

🎉 **Congratulations!** Your application is now deployed with zero-downtime blue-green switching.

---

## Architecture

### Network Flow

```
Internet
    │
    ▼
┌──────────────────────┐
│    ProxyBuilder       │  ◄── SSL termination only
│  (reverse proxy)      │      Adds: Host, X-Real-IP, X-Forwarded-*
└──────────┬───────────┘
           │ HTTP
           ▼
┌──────────────────────┐
│   Blue-Green Nginx   │  ◄── Security headers, rate limiting,
│  (your deployment)   │      blue/green upstream routing
└──────────┬───────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
┌─────────┐  ┌─────────┐
│  Blue   │  │  Green  │  ◄── Only ONE receives traffic
│ (N app  │  │ (N app  │
│ replicas│  │ replicas│
│  )      │  │  )      │
└────┬────┘  └────┬────┘
     │            │
     └─────┬──────┘
           ▼
     ┌───────────┐    ┌───────────┐
     │PostgreSQL │    │   Redis   │    ◄── Optional services
     └───────────┘    └───────────┘
```

### ProxyBuilder Integration

This template is designed to work behind ProxyBuilder in **passthrough mode**:

| Responsibility | ProxyBuilder | Blue-Green Nginx |
|---------------|-------------|------------------|
| SSL/TLS termination | ✅ | ❌ |
| Proxy headers (Host, X-Real-IP) | ✅ | ❌ |
| Security headers (HSTS, CSP, etc.) | ❌ | ✅ |
| Rate limiting | ❌ | ✅ |
| Gzip compression | ❌ | ✅ |
| Blue/green routing | ❌ | ✅ |

> **Key point:** ProxyBuilder is a "dumb passthrough" — it only terminates SSL and forwards traffic. All security hardening happens at the blue-green Nginx layer. This template never handles SSL/TLS directly.

### Blue-Green Switching

The switch is a simple Nginx config swap — it takes milliseconds:

```
Before switch:                      After switch:
┌────────────────────┐              ┌────────────────────┐
│ active-upstream.conf│             │ active-upstream.conf│
│                    │              │                    │
│ upstream active {  │              │ upstream active {  │
│   server app_blue; │  ────────►  │   server app_green;│
│ }                  │              │ }                  │
└────────────────────┘              └────────────────────┘
         +                                   +
    nginx reload                        nginx reload
    (zero downtime)                     (zero downtime)
```

Existing connections are drained gracefully — Nginx's reload mechanism ensures no requests are dropped.

---

## Deploy CLI Reference

The Deploy CLI (`deploy-cli.js`) is a TypeScript tool bundled into a single JavaScript file via esbuild. It runs on CI runners and orchestrates deployments to remote servers over SSH.

### Why a CLI?

Previously, GitHub Actions workflows contained complex inline bash for SSH commands, config resolution, server inventory parsing, and multi-server coordination. The Deploy CLI replaces all of that with:

- **Type-safe** — Full TypeScript with proper interfaces
- **Testable** — 57 unit tests covering config, inventory, and argument parsing
- **Readable** — One-liner CLI calls in workflow YAML instead of 50+ lines of bash
- **Debuggable** — Structured logging with emoji prefixes and operation summaries

### Commands

| Command | Description |
|---------|-------------|
| `prepare` | Run blue-green-prepare on all resolved servers |
| `switch` | Run blue-green-switch on all resolved servers |
| `deploy` | Full coordinated deploy (prepare → barrier → switch) |
| `upload` | Upload tarball, scripts, Docker/Nginx configs to servers |
| `deploy-config` | Deploy config files from GitHub Secrets to servers |
| `operate` | Run any remote-ops.sh subcommand on servers |
| `registry` | Build + push Docker image to registry (CI-side) |

### Global Options

| Option | Description | Default |
|--------|-------------|---------|
| `--env <environment>` | Target environment (test/acceptance/production) | — |
| `--scope <scope>` | Server scope (all/group/tag/server) | — |
| `--filter <value>` | Filter value for scope | — |
| `--deploy-path <path>` | Remote deployment path | `$DEPLOY_PATH` env |
| `--strategy <strategy>` | Deployment strategy (in-place/registry) | Auto-detected |
| `--max-parallel <n>` | Max parallel server operations | `10` |
| `--dry-run` | Show what would happen without executing | — |
| `--project-name <name>` | Project name for `COMPOSE_PROJECT_NAME` | — |

### Registry Options

These apply only to the `registry` command:

| Option | Description | Default |
|--------|-------------|---------|
| `--registry-url <url>` | Docker registry URL (required) | — |
| `--image-name <name>` | Docker image name (required) | — |
| `--tag <tag>` | Image tag | `latest` |
| `--platform <platform>` | Target platform(s) for Docker builds | Native arch |

**Examples:**

```bash
# Build and push for the server's native architecture
node deploy-cli.js registry \
  --registry-url registry.internal:5000 \
  --image-name my-app

# Build for ARM64 servers from an AMD64 CI runner
node deploy-cli.js registry \
  --registry-url registry.internal:5000 \
  --image-name my-app \
  --platform linux/arm64

# Build multi-arch manifest for mixed fleet
node deploy-cli.js registry \
  --registry-url registry.internal:5000 \
  --image-name my-app \
  --platform linux/amd64,linux/arm64
```

### Two-Phase Deploy (Barrier Pattern)

The deploy uses a **barrier pattern** for safety across multiple servers:

```
Server 1:  prepare ──────► ✅ ready
Server 2:  prepare ──────► ✅ ready     ─── ALL pass? ───► switch ALL
Server 3:  prepare ──────► ✅ ready

Server 1:  prepare ──────► ✅ ready
Server 2:  prepare ──────► ❌ FAILED    ─── ANY fails? ──► ABORT (no switch)
Server 3:  prepare ──────► ✅ ready
```

**Phase 1 — Prepare** (per server):

1. Detect deployment strategy (in-place or registry)
2. Identify active/target colors
3. Build Docker image (in-place) or pull from registry
4. Start target environment containers
5. Wait for health checks to pass
6. Write state file for switch phase

**Barrier** — If ANY server fails prepare, the entire deploy is aborted. No server switches.

**Phase 2 — Switch** (per server):

7. Read state from prepare phase
8. Switch Nginx upstream to target color
9. Reload Nginx (zero downtime)
10. Verify new environment responds
11. Stop old environment containers
12. Clean up Docker images and state files

### Workflow Examples

**Single-server release** (generated `release.yml`):

```yaml
steps:
  - run: node deployment/scripts/deploy-cli.js upload --env ${{ inputs.deploy_target }}
  - run: node deployment/scripts/deploy-cli.js deploy-config --env ${{ inputs.deploy_target }}
  - run: node deployment/scripts/deploy-cli.js deploy --env ${{ inputs.deploy_target }}
```

**Multi-server release** (three-job barrier pattern):

```yaml
jobs:
  deploy_prepare:              # Upload + prepare ALL servers
    steps:
      - run: node deploy-cli.js upload --env ${{ inputs.deploy_target }} --scope all
      - run: node deploy-cli.js deploy-config --env ${{ inputs.deploy_target }} --scope all
      - run: node deploy-cli.js prepare --env ${{ inputs.deploy_target }} --scope all

  deploy_switch:               # Switch ALL — only if prepare succeeded
    needs: [deploy_prepare]    # ◄── This is the barrier
    steps:
      - run: node deploy-cli.js switch --env ${{ inputs.deploy_target }} --scope all
```

**Registry strategy release** (single-server):

```yaml
steps:
  # QEMU + buildx setup (auto-generated for registry strategy)
  - run: docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
  - run: docker buildx create --name bluegreen --use 2>/dev/null || docker buildx use bluegreen
  - run: |
      echo "${{ secrets.REGISTRY_PASSWORD }}" | docker login ${{ secrets.REGISTRY_URL }} ...
      node deploy-cli.js registry --registry-url ${{ secrets.REGISTRY_URL }} --image-name my-app --platform linux/amd64
  - run: node deploy-cli.js upload --env ${{ inputs.deploy_target }} --strategy registry
  - run: node deploy-cli.js deploy-config --env ${{ inputs.deploy_target }}
  - run: node deploy-cli.js deploy --env ${{ inputs.deploy_target }}
```

**Operations** (run any remote-ops.sh subcommand):

```bash
# Health check
node deploy-cli.js operate --env production --op health-check

# Rollback to previous version
node deploy-cli.js operate --env production --op rollback

# Restart app containers
node deploy-cli.js operate --env test --op restart-app

# View logs
node deploy-cli.js operate --env acceptance --op view-logs
```

### Server Inventory

The `deploy-inventory.json` file defines your multi-server topology:

```json
{
  "ssh_key_secret": "DEPLOY_SSH_KEY",
  "environments": {
    "test": {
      "access": "direct",
      "servers": [
        { "name": "test-01", "host": "deploy@10.0.1.30", "group": "all" }
      ]
    },
    "production": {
      "access": "jump_host",
      "jump_host_secret": "JUMP_HOST",
      "servers": [
        { "name": "prod-01", "host": "deploy@10.0.3.10", "group": "all", "tags": ["eu-west"] },
        { "name": "prod-02", "host": "deploy@10.0.3.20", "group": "all", "tags": ["eu-west"] }
      ]
    }
  }
}
```

Deploy CLI resolves servers by scope:

| Scope | Example | Targets |
|-------|---------|---------|
| `all` | `--scope all` | All servers in the environment |
| `group` | `--scope group --filter web` | All servers in group "web" |
| `tag` | `--scope tag --filter eu-west` | All servers with tag "eu-west" |
| `server` | `--scope server --filter prod-01` | Single server by name |

---

## Deployment Topologies

### Single Server

One server per environment. The Deploy CLI connects directly via SSH.

```bash
curl -fsSL .../install.sh | bash -s -- --name my-app --single
```

GitHub Secrets for server addresses:

| Secret | Example |
|--------|---------|
| `TEST_SERVER` | `deploy@10.0.0.3` |
| `ACC_SERVER` | `deploy@10.0.0.4` |
| `PROD_SERVER` | `deploy@10.0.0.5` |

### Multi Server

Multiple servers per environment. The Deploy CLI handles parallel execution with configurable batching (`--max-parallel`).

```bash
curl -fsSL .../install.sh | bash -s -- --name my-app --multi
```

Supports:

- **Direct SSH** (2–200+ servers) — parallel operations via Deploy CLI
- **Jump host** — SSH through a bastion host (set `JUMP_HOST` secret and configure `deploy-inventory.json`)

Edit `deploy-inventory.json` to define your server topology. The generated workflow includes scope/filter inputs for targeted deployments.

---

## Remote Operations Reference

The `remote-ops.sh` script runs on each server and provides operational subcommands. Use the Deploy CLI `operate` command to invoke them from CI:

```bash
node deploy-cli.js operate --env <environment> --op <subcommand>
```

**Deploy Commands:**

| Subcommand | Description |
|------------|-------------|
| `setup-dirs` | Create directory structure for deployment |
| `receive-deploy` | Unpack deployment tarball into Docker build context |
| `blue-green-prepare` | Phase 1: build/pull + start + health check (no traffic switch) |
| `blue-green-switch` | Phase 2: switch Nginx to prepared color + stop old + cleanup |
| `blue-green-deploy` | Combined: prepare + switch in one step (backward compat) |
| `rebuild` | Rebuild current active color containers |

**Blue-Green Commands:**

| Subcommand | Description |
|------------|-------------|
| `switch-color [color]` | Manual blue↔green switch without rebuild |
| `active-color` | Print current active color |

**Operations Commands:**

| Subcommand | Description |
|------------|-------------|
| `restart-app` | Restart current active color containers |
| `restart-all` | Down + up all containers |
| `health-check` | Full health check (containers + app + database) |
| `wait-healthy [secs]` | Loop health check until healthy (default: 120s) |
| `view-logs [lines]` | Show last N app log lines (default: 200) |
| `rollback` | Revert to previous deployment (strategy-aware) |

**Database Commands** (if PostgreSQL is enabled):

| Subcommand | Description |
|------------|-------------|
| `backup` | Create PostgreSQL backup |
| `run-migrations` | Run database migrations |
| `purge-database` | Drop and recreate database |
| `health-check-all` | App + database health check |
| `db-table-counts` | Show row counts per table |

---

## Docker Compose Profiles

The generated `docker-compose.yml` uses Docker Compose profiles to group services:

| Profile | Services | Use Case |
|---------|----------|----------|
| `core` | nginx, dozzle, (postgres, redis) | Core infrastructure |
| `blue` | app_blue (N replicas) | Blue environment |
| `green` | app_green (N replicas) | Green environment |
| `all` | Everything | Full stack (local dev, initial build) |
| `db` | postgres | Database only |

**Examples:**

```bash
# Build everything
docker compose --profile all build

# Start core + blue (typical for first deploy)
docker compose --profile core --profile blue up -d

# Start just the database
docker compose --profile db up -d
```

---

## Security

Nginx provides comprehensive security hardening at the blue-green layer:

| Feature | Details |
|---------|---------|
| **HSTS** | Strict Transport Security (works because ProxyBuilder serves over HTTPS) |
| **CSP** | Content Security Policy |
| **X-Frame-Options** | Clickjacking protection |
| **X-Content-Type-Options** | MIME sniffing prevention |
| **Referrer-Policy** | Referrer information control |
| **Permissions-Policy** | Browser feature restrictions |
| **Rate limiting** | Per-client IP: 10 req/s API, 100 req/s health, 5 req/m auth |
| **Connection limiting** | Max 10 concurrent connections per IP |
| **Header sanitization** | Strips `X-Powered-By` |
| **IP anonymization** | GDPR-compliant log anonymization |
| **Dozzle auth** | Protected log viewer with username/password |

> **Note:** ProxyBuilder handles SSL termination only. All security headers are set at the blue-green Nginx layer and passed through to browsers over HTTPS.

---

## Development

This section is for contributing to the blue-green template itself, not for projects using it.

### Building the Deploy CLI

The Deploy CLI is written in TypeScript and bundled via esbuild into a single JavaScript file:

```bash
# Build the CLI bundle (outputs to scaffold/templates/deployment/scripts/deploy-cli.js)
npm run build:cli

# Type-check without emitting
npm run typecheck

# Run unit tests (57 tests)
npm run test:cli

# Full verification (typecheck + build)
npm run verify
```

### Project Structure

```
src/deploy-cli/                  # TypeScript source
├── index.ts                     # Entry point, argument parser, command dispatcher
├── types.ts                     # All interfaces and type definitions
├── lib/                         # Core libraries
│   ├── process.ts               # Spawn helper with timeout and stream capture
│   ├── logger.ts                # Structured output with emoji prefixes
│   ├── ssh.ts                   # SSH setup, exec, SCP upload, cleanup
│   ├── config.ts                # Config resolution ({ENV} placeholders)
│   └── inventory.ts             # Server inventory resolution (scope/filter)
├── commands/                    # Command implementations
│   ├── shared.ts                # Common infrastructure (parseDeployOptions, executeOnServers)
│   ├── upload.ts                # Multi-step file upload to servers
│   ├── deploy-config.ts         # Config file deployment from secrets
│   ├── operate.ts               # Generic remote-ops.sh subcommand runner
│   ├── prepare.ts               # Blue-green prepare (phase 1)
│   ├── switch.ts                # Blue-green switch (phase 2)
│   ├── deploy.ts                # Coordinated deploy with barrier
│   └── registry.ts              # Docker buildx build + push (CI-side)
└── __tests__/                   # Unit tests (57 tests)
    ├── config.test.ts           # Config resolution tests (13)
    ├── inventory.test.ts        # Server inventory tests (24)
    ├── parser.test.ts           # Argument parser tests (20)
    └── fixtures/                # Test fixture files

scaffold/                        # Scaffold generator system
├── scaffold.js                  # Interactive generator (~580 lines, zero deps)
├── templates/                   # Template files (42 files)
└── partials/                    # Conditional partial files (17 files)
```

---

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| [Node.js](https://nodejs.org/) | 18+ | Scaffold generator, Deploy CLI, BlendSDK apps |
| [Docker](https://docs.docker.com/get-docker/) | 20.10+ | Container runtime |
| [Docker Compose](https://docs.docker.com/compose/install/) | v2+ | Multi-container orchestration |
| [GitHub CLI](https://cli.github.com/) (`gh`) | Latest | Pushing secrets to GitHub |
| ProxyBuilder (or compatible reverse proxy) | — | SSL termination |

**For registry strategy additionally:**

| Requirement | Purpose |
|-------------|---------|
| Docker Registry (e.g., `registry:2`) | Image storage |
| Docker Buildx | Multi-platform builds (included with Docker 20.10+) |
| QEMU (on CI runner) | Cross-platform builds (auto-setup in generated workflow) |

---

## License

MIT
