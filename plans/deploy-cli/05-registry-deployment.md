# Registry-Based Deployment

> **Document**: 05-registry-deployment.md
> **Parent**: [Index](00-index.md)

## Overview

Registry-based deployment is an alternative to in-place deployment where Docker images are built once on the CI server (GitHub Actions runner), pushed to a private Docker registry, and pulled by all target servers. This eliminates redundant builds and makes deployments faster and more consistent.

## Architecture

### In-Place (Current)

```
CI Runner                    Server (each)
┌────────────┐               ┌───────────────────┐
│ Build app  │──── SCP ────→ │ deployment.tgz    │
│ (yarn)     │  tarball      │   ↓               │
│            │               │ docker build      │  ← Slow, per-server
│            │               │   ↓               │
│            │               │ docker compose up │
└────────────┘               └───────────────────┘
```

### Registry (New)

```
CI Runner                    Registry           Server (each)
┌────────────┐               ┌──────────┐       ┌─────────────────┐
│ Build app  │               │          │       │                 │
│ (yarn)     │               │ registry │       │ docker pull     │  ← Fast
│   ↓        │── push ────→ │  :3      │← pull─│   ↓             │
│ docker     │               │          │       │ docker compose  │
│  build     │               └──────────┘       │   up            │
│   ↓        │                                  └─────────────────┘
│ docker     │
│  push      │
└────────────┘
```

### Key Differences

| Aspect | In-Place | Registry |
|--------|----------|----------|
| Docker build location | On each server | On CI runner (once) |
| Transfer method | SCP tarball | Docker push/pull |
| Build count | N times (one per server) | 1 time |
| Server requirements | Docker + enough RAM to build | Docker + registry access |
| Rollback | Symlink previous tarball | Pull previous image tag |
| Offline capability | Works if tarball is on server | Needs registry access |

## Registry Setup (Prerequisite for Phase 8)

### Self-Hosted Registry

```bash
# On registry host (TBD — one of the servers or dedicated)
docker run -d \
  -p 5000:5000 \
  --restart=always \
  --name registry \
  -v /opt/registry-data:/var/run/registry \
  registry:3
```

### Docker Daemon Configuration

All Docker hosts (CI runner + target servers) need to trust the registry:

**Option A: Insecure registry (internal network, no TLS)**

`/etc/docker/daemon.json` on each host:
```json
{
  "insecure-registries": ["REGISTRY_HOST:5000"]
}
```

Then restart Docker: `sudo systemctl restart docker`

**Option B: TLS with self-signed cert** (more secure, more setup)

Not covered in this plan — Option A is sufficient for internal networks.

### Verification

```bash
# From CI runner
docker pull alpine:latest
docker tag alpine:latest REGISTRY_HOST:5000/test:latest
docker push REGISTRY_HOST:5000/test:latest

# From each target server
docker pull REGISTRY_HOST:5000/test:latest
```

## Docker Compose Changes (Registry Strategy)

### In-Place docker-compose.yml (Current)

```yaml
x-app-base: &app-base
  build:
    context: .
    dockerfile: Dockerfile
  # ...
```

### Registry docker-compose.yml (New)

```yaml
x-app-base: &app-base
  image: ${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}
  # No build: section — image is pre-built and pulled
  # ...
```

### Key Differences in Compose

| Aspect | In-Place | Registry |
|--------|----------|----------|
| `build:` section | Present | Absent |
| `image:` section | Absent (auto-generated) | Required (with env vars) |
| Dockerfile | Required on server | Not needed on server |
| `.env` additions | None | `REGISTRY_URL`, `IMAGE_NAME`, `IMAGE_TAG` |

## Dockerfile Changes (Registry Strategy)

### In-Place Dockerfile (Current)

```dockerfile
FROM node:22-slim
# ... install procps
WORKDIR /app
COPY deployment-latest.tgz /tmp/deployment-latest.tgz
RUN tar -xzf /tmp/deployment-latest.tgz -C /app && \
    rm /tmp/deployment-latest.tgz && \
    yarn install --production --no-lockfile
# ...
```

### Registry Dockerfile (New)

Same Dockerfile — but it's built on the CI runner, not on the server. The only change is that the CI runner needs the tarball in its build context:

```dockerfile
# Identical Dockerfile — just built in a different location
FROM node:22-slim
# ... same as before
COPY deployment-latest.tgz /tmp/deployment-latest.tgz
RUN tar -xzf /tmp/deployment-latest.tgz -C /app && \
    rm /tmp/deployment-latest.tgz && \
    yarn install --production --no-lockfile
# ...

# Additional label for traceability
LABEL git.sha="${GIT_SHA}"
LABEL build.timestamp="${BUILD_TIMESTAMP}"
```

The Dockerfile stays the same; the difference is WHERE it's built (CI vs server) and that the built image gets pushed to a registry instead of being built locally.

## .env Additions (Registry Strategy)

```bash
# Registry deployment settings
REGISTRY_URL=registry.internal:5000
IMAGE_NAME={{PROJECT_NAME_LOWER}}
IMAGE_TAG=20260329220000
```

These are set by the CLI during deployment:
- `REGISTRY_URL` — set once during initial setup
- `IMAGE_NAME` — set once during scaffold
- `IMAGE_TAG` — updated on each deploy by the CLI

## CLI `registry` Command

Build and push the image on the CI runner:

```bash
node deploy-cli.js registry \
  --registry-url registry.internal:5000 \
  --image-name scaffoldapp \
  --deploy-path .
```

**Steps:**
1. Generate tag: `YYYYMMDDHHMMSS` format
2. Build: `docker build -t registry.internal:5000/scaffoldapp:20260329220000 --build-arg GIT_SHA=$(git rev-parse --short HEAD) .`
3. Push: `docker push registry.internal:5000/scaffoldapp:20260329220000`
4. Output tag for downstream use

## Image Tag State Management

For rollback support, the CLI tracks image tags:

**During deploy (on each server via SSH):**
```bash
# Save current tag as previous (for rollback)
grep '^IMAGE_TAG=' .env | cut -d= -f2 > .previous-image-tag

# Update to new tag
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${NEW_TAG}/" .env
```

**During rollback:**
```bash
# Read previous tag
PREV_TAG=$(cat .previous-image-tag)
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${PREV_TAG}/" .env
# Then blue-green-deploy (which does docker compose pull)
```

## Workflow Differences (Registry vs In-Place)

### Release Workflow — In-Place

```yaml
- name: Upload and deploy
  run: node deploy-cli.js upload --env ${{ inputs.deploy_target }} --strategy in-place ...
- name: Prepare (build on servers)
  run: node deploy-cli.js prepare --env ${{ inputs.deploy_target }} --strategy in-place ...
- name: Switch
  run: node deploy-cli.js switch --env ${{ inputs.deploy_target }} ...
```

### Release Workflow — Registry

```yaml
- name: Build and push image
  run: node deploy-cli.js registry --registry-url ... --image-name ... ...
- name: Upload configs (no tarball)
  run: node deploy-cli.js upload --env ${{ inputs.deploy_target }} --strategy registry --image-tag ${{ steps.registry.outputs.tag }} ...
- name: Prepare (pull on servers)
  run: node deploy-cli.js prepare --env ${{ inputs.deploy_target }} --strategy registry ...
- name: Switch
  run: node deploy-cli.js switch --env ${{ inputs.deploy_target }} ...
```

## Scaffold Template Selection

The scaffold generates different templates based on strategy choice:

| File | In-Place | Registry |
|------|----------|----------|
| `docker-compose.yml` | Has `build:` section | Has `image:` with `${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}` |
| `Dockerfile` | Same | Same (built on CI for registry, on server for in-place) |
| `.env.example` | No registry vars | Includes `REGISTRY_URL`, `IMAGE_NAME`, `IMAGE_TAG` |
| `release-*.yml` | Upload tarball step | Build+push step |
| `remote-ops.sh` | Same | Same (auto-detects strategy) |
| `deploy-cli.js` | Same | Same (strategy passed as flag) |

## Testing

### Prerequisites
- Private Docker registry running and accessible
- All Docker daemons configured with `insecure-registries`
- Network connectivity: CI runner → registry, target servers → registry

### Test Cases
1. Build and push image from CI runner
2. Pull image from target server
3. Full registry deploy: build → push → upload configs → prepare → switch
4. Rollback: switch back to previous image tag
5. Health check after registry deploy
