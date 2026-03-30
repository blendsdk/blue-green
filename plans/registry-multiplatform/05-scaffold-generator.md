# Scaffold Generator Updates

> **Document**: 05-scaffold-generator.md
> **Parent**: [Index](00-index.md)

## Overview

Update `scaffold.js` to prompt for target platform when registry strategy is chosen, and inject the appropriate workflow partials.

## New Prompt (After Registry URL)

```
── Deployment Strategy ────────────────────────
Deployment strategy: registry
Docker registry URL: dr.truesoftware.net

Target platform(s) for Docker builds:
  1. linux/amd64              (x86 servers)
  2. linux/arm64              (ARM servers)
  3. linux/amd64,linux/arm64  (mixed fleet — builds both architectures)
  4. Custom
> _
```

### CLI Flag

```bash
node scaffold.js --name my-app --strategy registry --registry-url reg.io --platform linux/arm64
```

Flag: `--platform <value>` (default: native architecture, skip prompt if provided)

## New Template Variables

| Variable | Source | Example |
|----------|--------|---------|
| `DOCKER_PLATFORM` | Platform prompt answer | `linux/arm64` or `linux/amd64,linux/arm64` |
| `WORKFLOW_REGISTRY_STEPS` | Registry partial (empty for in-place) | QEMU + buildx + build+push + cleanup |
| `WORKFLOW_UPLOAD_STEPS` | Upload partial (strategy-specific) | Upload with or without `--strategy registry` |

## New Partial Files

| File | Content |
|------|---------|
| `scaffold/partials/workflow-release-registry-steps.yml` | QEMU + buildx + docker login + registry push + cleanup |
| `scaffold/partials/workflow-release-upload-inplace.yml` | Upload step without `--strategy` flag |
| `scaffold/partials/workflow-release-upload-registry.yml` | Upload step with `--strategy registry` flag |

## scaffold.js Changes

### 1. Add platform to interactive prompts (after registryUrl)

```javascript
let platform = '';
if (strategy === 'registry') {
  const platformChoice = await choose(rl, 'Target platform(s) for Docker builds:', [
    'linux/amd64              (x86 servers)',
    'linux/arm64              (ARM servers)',
    'linux/amd64,linux/arm64  (mixed fleet)',
    'Custom',
  ], 0);
  const presets = ['linux/amd64', 'linux/arm64', 'linux/amd64,linux/arm64'];
  platform = platformChoice < 3 ? presets[platformChoice] : await ask(rl, 'Custom platform(s)');
}
```

### 2. Add to answers and flags

- `answers.platform` field in interactive mode
- `flags.platform` from `--platform` CLI flag
- Return in `answersFromFlags()` and interactive prompt

### 3. Add template variables in `resolveVars()`

```javascript
vars.DOCKER_PLATFORM = answers.platform || '';
vars.WORKFLOW_REGISTRY_STEPS = isRegistry
  ? readPartial('workflow-release-registry-steps.yml') : '';
vars.WORKFLOW_UPLOAD_STEPS = isRegistry
  ? readPartial('workflow-release-upload-registry.yml')
  : readPartial('workflow-release-upload-inplace.yml');
```

### 4. Update `.env.example` template

Add comment to registry section:
```
# REGISTRY_URL must NOT include https:// — use hostname:port only (e.g., dr.example.net)
REGISTRY_URL={{REGISTRY_URL}}
```
