# Current State: Registry & Multi-Platform

> **Document**: 02-current-state.md
> **Parent**: [Index](00-index.md)

## Existing Implementation

### What Exists

The scaffold system already supports registry strategy selection:
- `scaffold.js` asks strategy (in-place/registry) and registry URL
- `compose-build-registry.yml` partial: `image: ${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}`
- `compose-build-inplace.yml` partial: `build: context: . dockerfile: Dockerfile`
- `env-registry.txt` partial: env vars for registry (URL, user, pass, image name, tag)
- `registry.ts` CLI command: builds and pushes Docker images
- `remote-ops.sh`: has `registry_login()` and strategy auto-detection via docker-compose.yml

### What's Missing (Discovered During ScaffoldApp Testing)

| Gap | Impact | Fix |
|-----|--------|-----|
| Workflow templates are in-place only | Registry deploys fail — no build+push steps | Add conditional registry workflow steps |
| `registry.ts` uses `docker build`+`push` | No multi-arch support; exec format error on cross-arch | Refactor to `docker buildx build --push` |
| No QEMU setup in workflows | Cross-platform builds fail | Add QEMU + buildx setup steps |
| No `--platform` multi-value support | Can't target mixed-arch fleets | Support comma-separated platforms |
| No image cleanup | CI runner disk fills up | Add `docker rmi` + prune step |
| `.env.example` allows `https://` in REGISTRY_URL | Docker pull fails with "invalid reference" | Document the requirement |
| No platform prompt in scaffold.js | User must manually edit workflows | Add platform selection |
| `--tag` defaults to timestamp | Mismatch with `.env IMAGE_TAG=latest` | Default to `latest` tag |

## Relevant Files

| File | Purpose | Changes Needed |
|------|---------|----------------|
| `src/deploy-cli/commands/registry.ts` | Build+push Docker images | Refactor to buildx, add cleanup |
| `src/deploy-cli/types.ts` | RegistryOptions interface | Already has `platform?` field |
| `scaffold/templates/.github/workflows/release-single.yml` | Single-server release | Add conditional registry steps |
| `scaffold/templates/.github/workflows/release-multi.yml` | Multi-server release | Add conditional registry steps |
| `scaffold/scaffold.js` | Interactive generator | Add platform prompt, workflow partials |
| `scaffold/templates/deployment/.env.example` | Env template | Add REGISTRY_URL guidance |
| `scaffold/partials/` | Conditional content | Add workflow partials for registry |

## Dependencies

### Internal
- `registry.ts` refactor must complete before workflow templates (templates reference CLI flags)
- Scaffold generator updates depend on both registry command and workflow templates being finalized
- Integration tests depend on all code changes being complete

### External
- ScaffoldApp repo at `/home/gevik/workdir/github/ScaffoldApp`
- Self-hosted CI runner with Docker + buildx
- Private registry at `dr.truesoftware.net`
- Target servers: test-01 (10.0.0.3), acc-01 (10.0.0.3), acc-02 (10.0.0.4) — all arm64
