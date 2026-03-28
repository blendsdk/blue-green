# Blue-Green Deployment Template

A production-ready **blue-green deployment** infrastructure template for `BlendSDK` applications. Provides zero-downtime deployments via Docker Compose, Nginx, GitHub Actions CI/CD, and declarative config management.

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
  --name my-app --port 3000 --with-postgres --single
```

```bash
# Pin to a specific version
BG_VERSION=v1.0.0 curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/v1.0.0/install.sh | bash
```

### Scaffold Flags

| Flag                  | Description                                 | Default           |
| --------------------- | ------------------------------------------- | ----------------- |
| `--name <name>`       | Project name (required for non-interactive) | Directory name    |
| `--port <port>`       | Application port                            | `3000`            |
| `--nginx-port <port>` | Nginx HTTP port                             | `80`              |
| `--replicas <count>`  | App replicas per color                      | `2`               |
| `--entry <command>`   | App entrypoint command                      | `node server.js`  |
| `--with-postgres`     | Include PostgreSQL                          | Ask (interactive) |
| `--no-postgres`       | Exclude PostgreSQL                          | —                 |
| `--with-redis`        | Include Redis                               | No                |
| `--no-redis`          | Exclude Redis                               | —                 |
| `--single`            | Single-server topology                      | Default           |
| `--multi`             | Multi-server topology                       | —                 |
| `--force`             | Overwrite existing files                    | Skip existing     |
| `--dry-run`           | Preview without writing                     | —                 |

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
│   └── scripts/                    # Server-side operational scripts
│       ├── remote-ops.sh           # 18 subcommands: deploy, switch, rollback, etc.
│       ├── health-check-wait.sh    # Health check polling utility
│       ├── deploy-config-files.sh  # GitHub Actions → server config deployment
│       └── resolve-config.js       # JSON config manifest parser
├── scripts/
│   └── push-secrets.sh             # Local files → GitHub Secrets (via gh CLI)
├── deploy-config.json              # Declarative config file manifest
├── deploy-package.sh               # Tarball builder for deployment artifacts
├── .github/
│   ├── SECRETS-SETUP.md            # GitHub Secrets documentation
│   └── workflows/
│       ├── build-test.yml          # CI: build + test on every push/PR
│       ├── release.yml             # CD: build → test → deploy → blue-green switch
│       └── operations.yml          # Ops: health-check, restart, backup, rollback
├── local_data/                     # Per-environment config (gitignored)
└── .gitignore                      # Configured for deployment project
```

**Multi-server topology** also includes:

- `deploy-inventory.json` — Server inventory per environment
- `deployment/scripts/resolve-servers.js` — Inventory → GitHub Actions matrix
- `deployment/scripts/multi-deploy.sh` — Deployment server fan-out script

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
- **Full security headers** (HSTS, CSP, X-Frame-Options, etc.)
- **Rate limiting** keyed on real client IP (X-Forwarded-For)
- **GDPR-compliant logging** with anonymized IP addresses
- **GitHub Actions CI/CD** with self-hosted runner cleanup
- **Declarative config management** (deploy-config.json + push-secrets.sh)
- **Multi-server support** (1 to 200+ servers)
- **Dozzle** web-based log viewer on every server

## Deployment Topologies

### Single Server

One server per environment (test, acceptance, production). Workflows deploy via SSH directly.

```bash
curl -fsSL .../install.sh | bash -s -- --name myapp --single
```

### Multi Server

Multiple servers per environment. Supports:

- **Direct SSH** (2-20 servers) — GitHub Actions matrix strategy
- **Jump host** — SSH through a bastion host
- **Deployment server** (20-200+ servers) — Fan-out from a central deployment node

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

- `DEPLOY_PATH` — Remote deployment path (e.g., `/opt/myapp`)
- `TEST_SERVER`, `ACC_SERVER`, `PROD_SERVER` — SSH addresses
- `JUMP_HOST` — Jump host address (if applicable)

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

The `remote-ops.sh blue-green-deploy` command performs an 11-step zero-downtime deployment:

1. Identify active/target colors
2. Load tarball to Docker image cache
3. Rebuild target environment
4. Start target containers
5. Wait for health checks
6. Switch Nginx upstream
7. Reload Nginx (zero downtime)
8. Verify new environment
9. Stop old environment
10. Update active color
11. Clean up Docker images

## Docker Compose Profiles

| Profile | Services                         | Use Case            |
| ------- | -------------------------------- | ------------------- |
| `core`  | nginx, dozzle, (postgres, redis) | Core infrastructure |
| `blue`  | app_blue                         | Blue environment    |
| `green` | app_green                        | Green environment   |
| `all`   | Everything                       | Full stack          |
| `db`    | postgres                         | Database only       |

## Remote Operations

The `remote-ops.sh` script provides 18 subcommands:

```bash
# Deployment
remote-ops.sh setup-dirs          # Create directory structure
remote-ops.sh receive-deploy      # Unpack deployment tarball
remote-ops.sh rebuild             # Docker compose build + up
remote-ops.sh blue-green-deploy   # Full zero-downtime deployment

# Environment
remote-ops.sh switch-color        # Toggle blue↔green
remote-ops.sh active-color        # Show current active color

# Operations
remote-ops.sh restart-app         # Restart app containers
remote-ops.sh restart-all         # Restart all services
remote-ops.sh health-check        # Check service health
remote-ops.sh wait-healthy        # Wait for containers to be healthy
remote-ops.sh view-logs           # Tail container logs
remote-ops.sh rollback            # Rollback to previous deployment

# Database (if PostgreSQL enabled)
remote-ops.sh backup              # Create PostgreSQL backup
remote-ops.sh run-migrations      # Run database migrations
remote-ops.sh purge-database      # Drop and recreate database
remote-ops.sh db-table-counts     # Show row counts per table
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

## Prerequisites

- [Node.js](https://nodejs.org/) (18+) — for scaffold generator and BlendSDK apps
- [Docker](https://docs.docker.com/get-docker/) (20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- [GitHub CLI](https://cli.github.com/) (`gh`) — for pushing secrets
- ProxyBuilder (or compatible reverse proxy) — for SSL termination

## License

MIT
