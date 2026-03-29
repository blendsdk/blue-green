# Scaffold Updates

> **Document**: 07-scaffold-updates.md
> **Parent**: [Index](00-index.md)

## Overview

`scaffold/scaffold.js` needs updates to support the new deployment strategy choice, generate the correct templates based on the choice, and ship the bundled `deploy-cli.js` instead of the old bash scripts.

## New Prompts

### Deployment Strategy Prompt

Added after the existing prompts (project name, app port, nginx port, entrypoint, replicas):

```
Deployment strategy:
  ❯ in-place    — Build Docker image on each server (simple, no registry needed)
    registry    — Build once, push to registry, all servers pull (faster, consistent)
```

### Registry URL Prompt (Conditional)

Only shown if strategy is `registry`:

```
Docker registry URL (e.g., registry.internal:5000): 
```

## Configuration Variables

### New Variables

| Variable | Source | Used In |
|----------|--------|---------|
| `{{DEPLOY_STRATEGY}}` | Prompt choice | docker-compose.yml, workflow files |
| `{{REGISTRY_URL}}` | Prompt (if registry) | docker-compose.yml, .env.example, workflows |
| `{{IMAGE_NAME}}` | Derived from `{{PROJECT_NAME_LOWER}}` | docker-compose.yml, .env.example |

### Existing Variables (Unchanged)

| Variable | Source |
|----------|--------|
| `{{PROJECT_NAME}}` | Prompt |
| `{{PROJECT_NAME_LOWER}}` | Derived |
| `{{APP_PORT}}` | Prompt |
| `{{NGINX_PORT}}` | Prompt |
| `{{ENTRYPOINT}}` | Prompt |
| `{{APP_REPLICAS}}` | Prompt |

## Template Strategy: Conditional Sections vs Separate Templates

**Decision: Use conditional sections within single templates, not separate template files.**

The differences between in-place and registry are small (a few lines in docker-compose.yml and .env.example). Creating entirely separate template trees would create massive duplication. Instead, we use the existing `{{PARTIAL_*}}` mechanism:

### docker-compose.yml Template

```yaml
x-app-base: &app-base
  {{APP_BUILD_SECTION}}
  restart: always
  # ...
```

Where `{{APP_BUILD_SECTION}}` resolves to:

**In-place:**
```yaml
  build:
    context: .
    dockerfile: Dockerfile
```

**Registry:**
```yaml
  image: ${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}
```

### New Partials

| Partial File | Injected When | Content |
|-------------|---------------|---------|
| `scaffold/partials/compose-build-inplace.yml` | strategy = in-place | `build:` section |
| `scaffold/partials/compose-build-registry.yml` | strategy = registry | `image:` section |
| `scaffold/partials/env-registry.txt` | strategy = registry | `REGISTRY_URL`, `IMAGE_NAME`, `IMAGE_TAG` vars |

## File Generation Changes

### New Files in Scaffold Output

| File | Always | Condition |
|------|--------|-----------|
| `deployment/scripts/deploy-cli.js` | ✅ | Always (replaces old scripts) |
| `deployment/scripts/remote-ops.sh` | ✅ | Always (updated with two-phase) |
| `deployment/scripts/health-check-wait.sh` | ✅ | Always (unchanged) |

### Removed Files from Scaffold Output

| File | Reason |
|------|--------|
| `deployment/scripts/deploy-config-files.sh` | Absorbed into deploy-cli.js |
| `deployment/scripts/multi-deploy.sh` | Absorbed into deploy-cli.js |
| `deployment/scripts/resolve-config.js` | Absorbed into deploy-cli.js |
| `deployment/scripts/resolve-servers.js` | Absorbed into deploy-cli.js |

### Modified Files

| File | Change |
|------|--------|
| `docker-compose.yml` | Uses `{{APP_BUILD_SECTION}}` partial |
| `.env.example` | Conditionally includes registry vars |
| `.github/workflows/release-single.yml` | Refactored to use CLI |
| `.github/workflows/release-multi.yml` | Refactored to use CLI |
| `.github/workflows/operations-single.yml` | Refactored to use CLI |
| `.github/workflows/operations-multi.yml` | Refactored to use CLI |
| `remote-ops.sh` | New commands: `blue-green-prepare`, `blue-green-switch` |

## scaffold.js Code Changes

### New Prompt in Interactive Flow

```javascript
// After replicas prompt, before postgres/redis/backup
const strategy = await choose('Deployment strategy', [
  { label: 'in-place — Build Docker image on each server', value: 'in-place' },
  { label: 'registry — Build once, push to registry, all servers pull', value: 'registry' },
]);

let registryUrl = '';
if (strategy === 'registry') {
  registryUrl = await ask('Docker registry URL (e.g., registry.internal:5000)');
}
```

### Partial Resolution Updates

```javascript
// Add new partial mappings
const partials = {
  // Existing
  'PARTIAL_POSTGRES': usePostgres ? readPartial('docker-compose-postgres.yml') : '',
  'PARTIAL_REDIS': useRedis ? readPartial('docker-compose-redis.yml') : '',
  // ...
  
  // New
  'APP_BUILD_SECTION': strategy === 'registry' 
    ? readPartial('compose-build-registry.yml')
    : readPartial('compose-build-inplace.yml'),
  'PARTIAL_ENV_REGISTRY': strategy === 'registry'
    ? readPartial('env-registry.txt')
    : '',
};

// Add new variables
const variables = {
  // Existing
  'PROJECT_NAME': projectName,
  // ...
  
  // New
  'DEPLOY_STRATEGY': strategy,
  'REGISTRY_URL': registryUrl,
  'IMAGE_NAME': projectNameLower,
};
```

### Flag-Based (Non-Interactive) Mode

```javascript
// New flags
// --strategy in-place|registry
// --registry-url <url>
```

## Summary Output Updates

After scaffold completion, the summary message should include:

```
Deployment strategy: in-place (build on each server)
  or
Deployment strategy: registry (build once, push to registry.internal:5000)
```

And for registry strategy, add a note:

```
⚠️  Registry setup required:
  1. Run Docker registry on your registry host
  2. Add "insecure-registries": ["registry.internal:5000"] to /etc/docker/daemon.json on all hosts
  3. Restart Docker on all hosts
```

## Testing

- Run scaffold with `--strategy in-place` → verify no registry vars in output
- Run scaffold with `--strategy registry --registry-url test:5000` → verify registry vars present
- Verify docker-compose.yml uses correct build/image section per strategy
- Verify .env.example includes/excludes registry vars correctly
- Verify workflow files are generated with CLI calls
- Verify old scripts (deploy-config-files.sh, multi-deploy.sh, resolve-*.js) are NOT generated
