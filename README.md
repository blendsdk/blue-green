# Blue-Green Deployment Template

A production-ready **blue-green deployment** infrastructure template for `BlendSDK` applications. Provides zero-downtime deployments via Docker Compose, Nginx, GitHub Actions CI/CD, and a TypeScript Deploy CLI for orchestration.

Designed to operate behind [ProxyBuilder](https://github.com/TrueSoftwareNL/nginx-proxy) — an external reverse proxy that handles SSL termination.

## Quick Install

Add complete deployment infrastructure to your project with a single command:

```bash
# Interactive mode — answers questions about your project
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash
```

```bash
# Non-interactive mode — provide all answers via flags
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash -s -- \
  --name my-app --port 3000 --with-postgres --single --strategy in-place
```

```bash
# Pin to a specific version
BG_VERSION=v1.0.0 curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/v1.0.0/install.sh | bash
```

### Scaffold Flags

| Flag                         | Description                                 | Default           |
| ---------------------------- | ------------------------------------------- | ----------------- |
| `--name <name>`              | Project name (required for non-interactive) | Directory name    |
| `--port <port>`              | Application port                            | `3000`            |
| `--nginx-port <port>`        | Nginx HTTP port                             | `80`              |
| `--replicas <count>`         | App replicas per color                      | `2`               |
| `--entry <command>`          | App entrypoint command                      | `node server.js`  |
| `--strategy <in-place\|registry>` | Deployment strategy                    | Ask (interactive) |
| `--registry-url <url>`       | Docker registry URL (registry strategy)     | Ask (interactive) |
| `--with-postgres`            | Include PostgreSQL                          | Ask (interactive) |
| `--no-postgres`              | Exclude PostgreSQL                          | —                 |
| `--with-redis`               | Include Redis                               | No                |
| `--no-redis`                 | Exclude Redis                               | —                 |
| `--single`                   | Single-server topology                      | Default           |
| `--multi`                    | Multi-server topology                       | —                 |
| `--force`                    | Overwrite existing files                    | Skip existing     |
| `--dry-run`                  | Preview without writing                     | —                 |

## Deployment Strategies

The scaffold supports two deployment strategies:

### In-Place (default)

Source code is uploaded as a tarball to each server, where Docker builds the image locally.

- ✅ Simple — no registry infrastructure needed
- ✅ Works with any server setup
- ❌ Each server builds independently (slower for many servers)

### Registry

Docker images are built once on a CI runner (or build server) and pushed to a self-hosted registry. Servers pull the pre-built image.

- ✅ Build once, deploy to many servers instantly
- ✅ Faster deployments at scale
- ❌ Requires a Docker registry (e.g., `registry:3` with htpasswd auth)

The strategy is auto-detected at runtime by `remote-ops.sh` based on the presence of `REGISTRY_URL` in the `.env` file.

## What Gets Generated

The scaffold creates a complete deployment infrastructure tailored to your project:

```
your-project/
├── deployment/                     # Docker deployment directory
│   ├── docker-compose.yml          # Blue/green profiles, Nginx, Dozzle, (Postgres, Redis)
│   ├── Dockerfile                  # Multi-stage Node.js build (tarball-based)
│   ├── .env.example                # Environment variable template
│   ├── pg-backup.sh                # PostgreSQL backup script (if Postgres enabled)
│   ├── nginx/                      # Modular Nginx configuration
│   │   ├── nginx.conf              # Main config (behind ProxyBuilder)
│   │   ├── conf.d/                 # Server-level includes
│   │   ├── includes/               # Shared config (headers, proxy, security)
│   │   ├── locations/              # Location blocks (numbered for ordering)
│   │   └── upstreams/              # Blue/green upstream definitions
│   └── scripts/                    # Deployment scripts
│       ├── deploy-cli.js           # Deploy CLI — orchestrates all deployments from CI
│       ├── remote-ops.sh           # Server-side operations (deploy, switch, rollback, etc.)
│       └── health-check-wait.sh    # Health check polling utility
├── scripts/
│   └── push-secrets.sh             # Local files → GitHub Secrets (via gh CLI)
├── deploy-config.json              # Declarative config file manifest
├── deploy-inventory.json           # Server inventory per environment (multi-server)
├── deploy-package.sh               # Tarball builder for deployment artifacts
├── .github/
│   ├── SECRETS-SETUP.md            # GitHub Secrets documentation
│   └── workflows/
│       ├── release.yml             # CD: upload → deploy-config → prepare → switch
│       └── operations.yml          # Ops: health-check, restart, backup, rollback
├── local_data/                     # Per-environment config (gitignored)
└── .gitignore                      # Configured for deployment project
```

**Multi-server topology** generates `release-multi.yml` with a three-job barrier pattern and `operations-multi.yml` with scope support.

## Architecture

```
                     ┌──────────────┐
ProxyBuilder ──────► │    Nginx     │ ◄── Security headers, rate limiting
  (SSL term.)        │  (reverse    │     blue-green routing
                     │   proxy)     │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼                           ▼
     ┌────────────────┐         ┌────────────────┐
     │   App (Blue)   │         │  App (Green)   │   ◄── Only ONE active
     │  N replicas    │         │  N replicas    │       at a time
     └────────┬───────┘         └────────┬───────┘
              │                          │
       ┌──────┴──────────────────────────┴──────┐
       │                                        │
  ┌────▼───────┐                           ┌────▼─────┐
  │ PostgreSQL │                           │  Redis   │
  │   16       │                           │ 7-alpine │
  └────────────┘                           └──────────┘
```

**Key features:**

- **Zero-downtime deployments** via blue-green environment switching
- **Two-phase deploy** — prepare all servers, then switch all together (or abort)
- **Deploy CLI** — typed, testable TypeScript tool replacing inline bash in CI
- **Full security headers** (HSTS, CSP, X-Frame-Options, etc.)
- **Rate limiting** keyed on real client IP (X-Forwarded-For)
- **GDPR-compliant logging** with anonymized IP addresses
- **GitHub Actions CI/CD** with self-hosted runner support
- **Declarative config management** (deploy-config.json + push-secrets.sh)
- **Multi-server support** (1 to 200+ servers) with parallel execution
- **Dozzle** web-based log viewer on every server

## Deploy CLI

The Deploy CLI (`deploy-cli.js`) is a TypeScript tool bundled into a single JavaScript file via esbuild. It runs on CI runners and orchestrates deployments to remote servers over SSH.

### Why a CLI?

Previously, GitHub Actions workflows contained complex inline bash for SSH commands, config resolution, server inventory parsing, and multi-server coordination. The Deploy CLI replaces all of that with:

- **Type-safe** — Full TypeScript with proper interfaces
- **Testable** — 57 unit tests covering config, inventory, and argument parsing
- **Readable** — One-liner CLI calls in workflow YAML instead of 50+ lines of bash
- **Debuggable** — Structured logging with emoji prefixes and operation summaries

### Commands

```
deploy-cli v1.0.0

Usage:
  node deploy-cli.js <command> [options]

Commands:
  prepare        Run blue-green-prepare on all resolved servers
  switch         Run blue-green-switch on all resolved servers
  deploy         Full coordinated deploy (prepare → barrier → switch)
  upload         Upload tarball, scripts, Docker/Nginx configs to servers
  deploy-config  Deploy config files from secrets to servers
  operate        Run any remote-ops.sh subcommand on servers
  registry       Build + push Docker image to registry (CI-side)

Global options:
  --env <environment>      Target environment (test/acceptance/production)
  --scope <scope>          Server scope (all/group/tag/server)
  --filter <value>         Filter value for scope
  --deploy-path <path>     Remote deployment path
  --strategy <strategy>    Deployment strategy (in-place/registry)
  --max-parallel <n>       Max parallel operations (default: 10)
  --dry-run                Show what would happen without executing
  --project-name <name>    Project name for COMPOSE_PROJECT_NAME
```

### Workflow Examples

**Single-server release** (upload → config → two-phase deploy):

```yaml
steps:
  - run: node deployment/scripts/deploy-cli.js upload --env ${{ inputs.environment }}
  - run: node deployment/scripts/deploy-cli.js deploy-config --env ${{ inputs.environment }}
  - run: node deployment/scripts/deploy-cli.js prepare --env ${{ inputs.environment }} --strategy in-place
  - run: node deployment/scripts/deploy-cli.js switch --env ${{ inputs.environment }}
```

**Multi-server release** (three-job barrier pattern):

```yaml
jobs:
  upload:      # Upload to all servers in parallel
    run: node deployment/scripts/deploy-cli.js upload --env ${{ inputs.environment }} --scope all

  prepare:     # Prepare all servers → if ANY fails, abort (don't switch)
    needs: upload
    run: node deployment/scripts/deploy-cli.js prepare --env ${{ inputs.environment }} --scope all

  switch:      # All prepared successfully → switch all together
    needs: prepare
    run: node deployment/scripts/deploy-cli.js switch --env ${{ inputs.environment }} --scope all
```

**Operations** (run any remote-ops.sh subcommand):

```yaml
- run: node deployment/scripts/deploy-cli.js operate --env ${{ inputs.environment }} --op health-check
- run: node deployment/scripts/deploy-cli.js operate --env ${{ inputs.environment }} --op rollback
- run: node deployment/scripts/deploy-cli.js operate --env ${{ inputs.environment }} --op restart-app
```

### Two-Phase Deploy

The deploy uses a **barrier pattern** for safety across multiple servers:

1. **Prepare phase** — On each server: build/pull image → start new color → health check
2. **Barrier** — If ANY server fails prepare, the entire deploy is aborted
3. **Switch phase** — Only after ALL servers pass: swap Nginx upstream → reload

This prevents partial deployments where some servers run the new version and others don't.

### Server Inventory

The `deploy-inventory.json` file defines your server topology:

```json
{
  "environments": {
    "test": {
      "servers": [
        { "name": "test-01", "host": "deploy@10.0.0.3", "groups": ["test"], "tags": ["primary"] }
      ]
    },
    "acceptance": {
      "servers": [
        { "name": "acc-01", "host": "deploy@10.0.0.3", "groups": ["web"], "tags": ["primary"] },
        { "name": "acc-02", "host": "deploy@10.0.0.4", "groups": ["web"], "tags": [] }
      ]
    }
  }
}
```

Deploy CLI resolves servers by scope:

| Scope    | Example                         | Targets                    |
| -------- | ------------------------------- | -------------------------- |
| `all`    | `--scope all`                   | All servers in environment |
| `group`  | `--scope group --filter web`    | All servers in group "web" |
| `tag`    | `--scope tag --filter primary`  | All servers with tag       |
| `server` | `--scope server --filter acc-01`| Single server by name      |

## Deployment Topologies

### Single Server

One server per environment (test, acceptance, production). Workflows deploy via SSH directly.

```bash
curl -fsSL .../install.sh | bash -s -- --name myapp --single
```

### Multi Server

Multiple servers per environment. The Deploy CLI handles parallel execution with configurable batching (`--max-parallel`).

Supports:
- **Direct SSH** (2-20 servers) — parallel operations via Deploy CLI
- **Jump host** — SSH through a bastion host (set `JUMP_HOST` env var)

```bash
curl -fsSL .../install.sh | bash -s -- --name myapp --multi
```

Edit `deploy-inventory.json` to define your server topology.

## Post-Install Setup

### 1. Configure Environments

```bash
mkdir -p local_data/{test,acceptance,production}
cp deployment/.env.example local_data/test/.env
cp deployment/.env.example local_data/acceptance/.env
cp deployment/.env.example local_data/production/.env
# Edit each .env with environment-specific values
```

### 2. Push Secrets to GitHub

```bash
./scripts/push-secrets.sh test
./scripts/push-secrets.sh acceptance
./scripts/push-secrets.sh production
# Or all at once:
./scripts/push-secrets.sh --all
```

### 3. Set Infrastructure Secrets

Go to **GitHub → Settings → Secrets and variables → Actions** and add:

- `DEPLOY_PATH` — Remote deployment path (e.g., `/opt/myapp`). **Must be absolute path** (not `~/path`)
- `TEST_SERVER`, `ACC_SERVER`, `PROD_SERVER` — SSH addresses (single-server)
- `JUMP_HOST` — Jump host address (if applicable)
- `SSH_PRIVATE_KEY` — SSH private key for server access (if not using SSH agent)

See `.github/SECRETS-SETUP.md` for complete documentation.

### 4. Build and Verify Locally

```bash
cd deployment
docker compose --profile all build
docker compose --profile core --profile blue up -d
curl -sf http://localhost/health | jq .
```

### 5. Deploy

Push to the main branch — GitHub Actions handles the rest!

## Blue-Green Deploy Algorithm

The two-phase deployment provides zero-downtime releases:

### Prepare Phase (per server)

1. Detect deployment strategy (in-place or registry)
2. Identify active/target colors
3. Build Docker image (in-place) or pull from registry
4. Start target environment containers
5. Wait for health checks to pass
6. Write state file for switch phase

### Switch Phase (per server)

7. Read state from prepare phase
8. Switch Nginx upstream to target color
9. Reload Nginx (zero downtime)
10. Verify new environment responds
11. Stop old environment containers
12. Update active color marker
13. Clean up Docker images and state files

## Docker Compose Profiles

| Profile | Services                         | Use Case            |
| ------- | -------------------------------- | ------------------- |
| `core`  | nginx, dozzle, (postgres, redis) | Core infrastructure |
| `blue`  | app_blue                         | Blue environment    |
| `green` | app_green                        | Green environment   |
| `all`   | Everything                       | Full stack          |
| `db`    | postgres                         | Database only       |

## Remote Operations

The `remote-ops.sh` script runs on each server and provides subcommands:

```bash
# Deployment (two-phase)
remote-ops.sh blue-green-prepare   # Phase 1: build/pull + start + health check
remote-ops.sh blue-green-switch    # Phase 2: Nginx swap + cleanup
remote-ops.sh blue-green-deploy    # Combined (backward compat): prepare + switch

# Deployment (setup)
remote-ops.sh setup-dirs           # Create directory structure
remote-ops.sh receive-deploy       # Unpack deployment tarball
remote-ops.sh rebuild              # Docker compose build + up

# Environment
remote-ops.sh switch-color         # Toggle blue↔green
remote-ops.sh active-color         # Show current active color

# Operations
remote-ops.sh restart-app          # Restart app containers
remote-ops.sh restart-all          # Restart all services
remote-ops.sh health-check         # Check service health
remote-ops.sh wait-healthy         # Wait for containers to be healthy
remote-ops.sh view-logs            # Tail container logs
remote-ops.sh rollback             # Rollback to previous deployment

# Database (if PostgreSQL enabled)
remote-ops.sh backup               # Create PostgreSQL backup
remote-ops.sh run-migrations       # Run database migrations
remote-ops.sh purge-database       # Drop and recreate database
remote-ops.sh health-check-all     # App + database health check
remote-ops.sh db-table-counts      # Show row counts per table
```

## Security

Nginx provides comprehensive security hardening:

- **HSTS** — Strict Transport Security
- **CSP** — Content Security Policy
- **X-Frame-Options** — Clickjacking protection
- **X-Content-Type-Options** — MIME sniffing prevention
- **Referrer-Policy** — Referrer information control
- **Permissions-Policy** — Browser feature restrictions
- **Rate limiting** — Per-client IP (10 req/s API, 100 req/s health, 5 req/m auth)
- **Connection limiting** — Max 10 concurrent connections per IP
- **Header sanitization** — Strips `X-Powered-By`
- **IP anonymization** — GDPR-compliant log anonymization

> **Note:** ProxyBuilder handles SSL termination only. All security hardening is at the Nginx layer.

## Development

### Building the Deploy CLI

The Deploy CLI is written in TypeScript and bundled via esbuild into a single JavaScript file:

```bash
# Build the CLI bundle
npm run build:cli

# Type-check without emitting
npm run typecheck

# Run unit tests
npm run test:cli

# Full verification (typecheck + build)
npm run verify
```

The bundled output is placed at `scaffold/templates/deployment/scripts/deploy-cli.js` so it's included in generated projects automatically.

### Project Structure

```
src/deploy-cli/                 # TypeScript source
├── index.ts                    # Entry point, argument parser, command dispatcher
├── types.ts                    # All interfaces and type definitions
├── lib/                        # Core libraries
│   ├── process.ts              # Spawn helper with timeout and stream capture
│   ├── logger.ts               # Structured output with emoji prefixes
│   ├── ssh.ts                  # SSH setup, exec, SCP upload, cleanup
│   ├── config.ts               # Config resolution ({ENV} placeholders)
│   └── inventory.ts            # Server inventory resolution (scope/filter)
├── commands/                   # Command implementations
│   ├── shared.ts               # Common infrastructure (parseDeployOptions, executeOnServers)
│   ├── upload.ts               # Multi-step file upload to servers
│   ├── deploy-config.ts        # Config file deployment from secrets
│   ├── operate.ts              # Generic remote-ops.sh subcommand runner
│   ├── prepare.ts              # Blue-green prepare (phase 1)
│   ├── switch.ts               # Blue-green switch (phase 2)
│   ├── deploy.ts               # Coordinated deploy with barrier
│   └── registry.ts             # Docker build + push (CI-side)
└── __tests__/                  # Unit tests (57 tests)
    ├── config.test.ts           # Config resolution tests (13)
    ├── inventory.test.ts        # Server inventory tests (24)
    ├── parser.test.ts           # Argument parser tests (20)
    └── fixtures/                # Test fixture files
```

## Prerequisites

- [Node.js](https://nodejs.org/) (18+) — for scaffold generator, Deploy CLI, and BlendSDK apps
- [Docker](https://docs.docker.com/get-docker/) (20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- [GitHub CLI](https://cli.github.com/) (`gh`) — for pushing secrets
- ProxyBuilder (or compatible reverse proxy) — for SSL termination

## License

MIT
