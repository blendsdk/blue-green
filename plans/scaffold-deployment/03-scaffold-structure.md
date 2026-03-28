# Scaffold Structure

> **Document**: 03-scaffold-structure.md
> **Parent**: [Index](00-index.md)

## Repository Layout (blue-green)

```
blue-green/
├── install.sh                       ← Curl entry point (thin bash wrapper)
├── scaffold/
│   ├── scaffold.js                  ← Node.js interactive generator (zero deps)
│   ├── templates/                   ← Template files with {{PLACEHOLDER}} markers
│   │   ├── deployment/
│   │   │   ├── docker-compose.yml
│   │   │   ├── Dockerfile
│   │   │   ├── .env.example
│   │   │   ├── pg-backup.sh
│   │   │   ├── nginx/              ← Full modular config (14 files)
│   │   │   └── scripts/
│   │   │       ├── remote-ops.sh
│   │   │       ├── health-check-wait.sh
│   │   │       ├── deploy-config-files.sh
│   │   │       └── resolve-config.js
│   │   ├── .github/
│   │   │   ├── workflows/
│   │   │   │   ├── release-single.yml
│   │   │   │   ├── release-multi.yml
│   │   │   │   ├── operations-single.yml
│   │   │   │   ├── operations-multi.yml
│   │   │   │   └── build-test.yml
│   │   │   └── SECRETS-SETUP.md
│   │   ├── deploy-package.sh
│   │   ├── deploy-config.json
│   │   ├── deploy-inventory.json    ← Only for multi-server
│   │   └── scripts/
│   │       └── push-secrets.sh
│   └── partials/                    ← Conditional sections (postgres, redis, etc.)
│       ├── docker-compose-postgres.yml
│       ├── docker-compose-redis.yml
│       ├── docker-compose-pgbackup.yml
│       └── env-postgres.txt
├── app/                             ← Demo app (for local testing)
├── docker-compose.yml               ← Dev compose (testing the template)
├── nginx/                           ← Dev nginx config
├── scripts/                         ← Template dev scripts
└── plans/                           ← Implementation plans
```

## Target App Layout (after scaffolding)

```
my-blendsdk-app/
├── packages/                        ← BlendSDK monorepo packages
├── package.json                     ← Root monorepo config
├── tsconfig.json
├── deploy-package.sh                ← Tarball builder (root — needs packages/)
├── deploy-config.json               ← Config manifest (committed, no secrets)
├── deploy-inventory.json            ← Server inventory (if multi-server)
├── local_data/                      ← gitignored — actual secret files
│   ├── test/
│   │   ├── .env
│   │   └── app-config.json
│   ├── acceptance/
│   └── production/
├── scripts/
│   └── push-secrets.sh              ← Push local configs → GitHub Secrets
├── .github/
│   ├── workflows/
│   │   ├── build-test.yml
│   │   ├── release.yml
│   │   └── operations.yml
│   └── SECRETS-SETUP.md
└── deployment/                      ← All deployment infrastructure
    ├── docker-compose.yml
    ├── Dockerfile
    ├── .env.example
    ├── pg-backup.sh                 ← If PostgreSQL selected
    ├── nginx/
    │   ├── nginx.conf
    │   ├── conf.d/server-name.conf
    │   ├── includes/ (6 files)
    │   ├── locations/ (4 files)
    │   └── upstreams/ (3 files)
    └── scripts/
        ├── remote-ops.sh
        ├── health-check-wait.sh
        ├── deploy-config-files.sh
        └── resolve-config.js
```

## Template Placeholder System

Template files use `{{PLACEHOLDER}}` syntax. The `scaffold.js` generator replaces them:

| Placeholder | Source | Example Value |
|-------------|--------|---------------|
| `{{PROJECT_NAME}}` | Interactive Q1 | `logixcontrol` |
| `{{APP_PORT}}` | Interactive Q2 | `8080` |
| `{{NGINX_PORT}}` | Interactive Q3 | `80` |
| `{{ENTRYPOINT}}` | Interactive Q4 | `node dist/main.js` |
| `{{APP_REPLICAS}}` | Interactive Q10 | `2` |

## Conditional Generation

The generator includes/excludes sections based on user answers:

| Condition | Files Affected |
|-----------|---------------|
| PostgreSQL = yes | docker-compose postgres service, .env postgres vars, pg-backup.sh, remote-ops backup/purge commands |
| PostgreSQL = no | Exclude all above |
| Redis = yes | docker-compose redis service, .env redis vars |
| Redis = no | Exclude all above |
| Multi-server | release-multi.yml instead of release-single.yml, deploy-inventory.json, resolve-servers.js, multi-deploy.sh |
| Single-server | release-single.yml, operations-single.yml, no inventory |

## Workflow Template Selection

| Topology | release.yml source | operations.yml source |
|----------|-------------------|----------------------|
| Single server (any access) | `release-single.yml` | `operations-single.yml` |
| Multi-server (any access) | `release-multi.yml` | `operations-multi.yml` |
