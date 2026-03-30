# Requirements: Registry & Multi-Platform Backport

> **Document**: 01-requirements.md
> **Parent**: [Index](00-index.md)

## Feature Overview

Backport all registry deployment strategy learnings from ScaffoldApp testing into the blue-green-template scaffold system. Add multi-platform Docker build support so a single CI pipeline can produce images for mixed-architecture server fleets (e.g., x86 + ARM).

## Functional Requirements

### Must Have

- [ ] `registry.ts` uses `docker buildx build --push` instead of `docker build` + `docker push`
- [ ] `--platform` flag supports comma-separated values for multi-arch (e.g., `linux/amd64,linux/arm64`)
- [ ] Image cleanup after successful push (`docker rmi` the built image)
- [ ] Workflow templates conditionally include registry steps when strategy=registry
- [ ] QEMU setup step in workflow templates for cross-platform builds
- [ ] Docker buildx builder setup step in workflow templates
- [ ] `scaffold.js` prompts for target platform(s) when registry strategy is chosen
- [ ] `.env.example` template documents that REGISTRY_URL must NOT include `https://`
- [ ] Integration test: in-place strategy works end-to-end on ScaffoldApp
- [ ] Integration test: registry strategy works end-to-end on ScaffoldApp

### Should Have

- [ ] `docker image prune -f` workflow step after registry build (general cleanup)
- [ ] Platform presets in scaffold prompt (amd64, arm64, both, custom)
- [ ] Tag convention: always `latest` (configurable later)

### Won't Have (Out of Scope)

- Runtime platform auto-detection via SSH to servers
- Per-server platform field in `deploy-inventory.json`
- Changes to `remote-ops.sh` (already has `registry_login()`)
- ScaffoldApp inventory/configuration rewrites
- Multi-arch manifest inspection/verification tooling

## Technical Requirements

### Compatibility

- `docker buildx` must be available on CI runners (standard on modern Docker 20.10+)
- QEMU user-static required for cross-platform builds on CI
- Single-platform builds must still work (no forced multi-arch)

### Performance

- Multi-arch builds are slower (QEMU emulation) — acceptable trade-off
- Image cleanup prevents disk exhaustion on CI runners

## Scope Decisions

| Decision | Options Considered | Chosen | Rationale |
|----------|-------------------|--------|-----------|
| Build tool | `docker build`+`push` vs `docker buildx build --push` | buildx | Required for multi-arch; works for single-arch too |
| Tag convention | `latest` vs timestamp vs both | `latest` | Simple, user request |
| Platform config | Runtime detection vs scaffold-time | Scaffold-time | Simple, predictable, no SSH needed |
| Cleanup | CLI only vs workflow only vs both | Both | Defense in depth |
| Testing approach | Revert files vs separate branches | Separate branches | Clean, no revert risk |

## Acceptance Criteria

1. [ ] `npm run verify` passes on blue-green-template
2. [ ] ScaffoldApp in-place deploy succeeds on test + acceptance environments
3. [ ] ScaffoldApp registry deploy succeeds on test + acceptance environments
4. [ ] Scaffold generator correctly generates both strategies
5. [ ] Generated workflow templates are syntactically valid
6. [ ] All unit tests pass (57+ existing tests)
