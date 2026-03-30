# Registry Command Refactor

> **Document**: 03-registry-command.md
> **Parent**: [Index](00-index.md)

## Overview

Refactor `src/deploy-cli/commands/registry.ts` to use `docker buildx build --push` instead of separate `docker build` + `docker push`. This enables multi-architecture image builds from a single command.

## Current Implementation

```typescript
// Current flow in registry.ts:
// 1. docker build --platform <single> -t <tag> <context>
// 2. docker push <tag>
```

## Proposed Changes

### 1. Replace docker build + push with buildx

```typescript
// New flow:
// 1. docker buildx create --name bluegreen --use (if not exists)
// 2. docker buildx build --platform <platforms> --tag <tag> --push <context>
// 3. docker rmi <tag> (cleanup, best-effort)
```

### 2. Buildx builder setup

Before building, ensure a buildx builder exists:
```typescript
// Create builder if it doesn't exist (idempotent)
await spawn('docker', ['buildx', 'create', '--name', 'bluegreen', '--use'], { timeout: 15_000 });
// Or use existing
await spawn('docker', ['buildx', 'use', 'bluegreen'], { timeout: 5_000 });
```

### 3. Multi-platform support

The `--platform` flag already exists. Change behavior:
- Single platform: `--platform linux/arm64` → `docker buildx build --platform linux/arm64 --push`
- Multi platform: `--platform linux/amd64,linux/arm64` → same command, buildx handles manifest list
- No platform: omit `--platform` flag entirely (buildx uses native arch)

### 4. Image cleanup after push

After successful push:
```typescript
// Best-effort cleanup — don't fail if image already gone
try {
  await spawn('docker', ['rmi', fullTag], { timeout: 30_000 });
} catch {
  // Ignore — image may not exist locally with buildx --push
}
// General dangling image prune
await spawn('docker', ['image', 'prune', '-f'], { timeout: 30_000 });
```

Note: With `buildx --push`, images may not exist locally (pushed directly from build cache). The `docker rmi` is best-effort.

### 5. Tag default

Change default tag from timestamp to `latest`:
```typescript
const tag = options.tag || 'latest';  // Changed from timestamp default
```

## Error Handling

| Error | Handling |
|-------|----------|
| buildx not available | Log clear error: "docker buildx required. Install Docker 20.10+" |
| QEMU not registered | Build fails with "exec format error" — log: "Run QEMU setup first" |
| Push fails (auth) | Existing behavior — docker login must happen before registry command |
| Cleanup fails | Ignore — best-effort, don't fail the command |

## Testing

- Existing unit tests verify argument parsing (parser.test.ts)
- Integration test on ScaffoldApp validates full flow
- No new unit tests needed (spawn calls are integration-level)
