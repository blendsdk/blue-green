# Deployment Infrastructure

> **Document**: 04-deployment-infra.md
> **Parent**: [Index](00-index.md)

## Overview

Template files for the Docker deployment infrastructure: docker-compose, Dockerfile, .env, nginx, pg-backup, and dozzle.

## docker-compose.yml Template

Based on current blue-green compose, enhanced with:
- `{{PROJECT_NAME}}` as compose project name
- `{{APP_PORT}}` for app service port
- Tarball-based build context (Dockerfile in `deployment/`)
- Dozzle service (always included)
- Conditional postgres, redis, pg-backup services (via scaffold.js partials)
- Blue/green profiles with `x-app-base` YAML anchor (DRY pattern from current compose)
- Health checks using `{{APP_PORT}}` for the app, standard for postgres/redis
- Network isolation: frontend (nginx ↔ app) + backend (app ↔ db/cache)

## Dockerfile Template

Based on LogixControl's tarball-based pattern:
```dockerfile
FROM node:22-slim
WORKDIR /app
COPY deployment-latest.tgz /tmp/
RUN tar -xzf /tmp/deployment-latest.tgz -C /app && rm /tmp/deployment-latest.tgz && yarn install --production --no-lockfile
RUN mkdir -p /app/data /app/temp
EXPOSE {{APP_PORT}}
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD node -e "fetch('http://localhost:{{APP_PORT}}/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
ENTRYPOINT [{{ENTRYPOINT_ARRAY}}]
```

## .env.example Template

Combines both sources, generalized:
- `COMPOSE_PROJECT_NAME={{PROJECT_NAME}}`
- `APP_REPLICAS={{APP_REPLICAS}}`
- `ACTIVE_ENV=blue`
- `NGINX_HTTP_PORT={{NGINX_PORT}}`
- Health check config
- Conditional: POSTGRES_*, REDIS_* sections
- Conditional: BACKUP_*, DOZZLE_* sections
- `TZ=Europe/Amsterdam`

## Nginx Config

Copy existing modular config from `nginx/` as-is with minimal changes:
- `upstreams/*.conf` — replace port `3000` with `{{APP_PORT}}`
- `locations/10-health.conf` — ensure health endpoint works with app port
- All other files unchanged (security headers, proxy params, etc.)

## pg-backup.sh Template

Based on LogixControl's `docker/pg-backup.sh`, generalized:
- Replace `logixcontrol` with `{{PROJECT_NAME}}` in backup filenames
- Keep: cron setup, retention pruning, initial backup, env var export for cron
- Keep: `pg-backup-run.sh` inner script pattern

## Dozzle Service

Always included in docker-compose:
```yaml
dozzle:
  image: amir20/dozzle:latest
  restart: unless-stopped
  profiles: ["core", "all"]
  ports:
    - "${DOZZLE_PORT:-9999}:8080"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  environment:
    DOZZLE_USERNAME: ${DOZZLE_USERNAME:-admin}
    DOZZLE_PASSWORD: ${DOZZLE_PASSWORD}
```
