# Integration Testing Strategy

> **Document**: 06-integration-testing.md
> **Parent**: [Index](00-index.md)

## Overview

End-to-end integration testing on ScaffoldApp for all strategy × topology combinations. Uses separate git branches on ScaffoldApp to avoid reverting files.

## Test Matrix

| # | Branch | Strategy | Topology | Target | Servers |
|---|--------|----------|----------|--------|---------|
| 1 | `test/inplace-single` | in-place | single | test | test-01 |
| 2 | `test/inplace-multi` | in-place | multi | acceptance | acc-01, acc-02 |
| 3 | `test/registry-single` | registry | single | test | test-01 |
| 4 | `test/registry-multi` | registry | multi | acceptance | acc-01, acc-02 |

## Branch Setup

Each branch is created from `feature/deploy-cli` and gets the appropriate workflow generated from the updated blue-green-template.

### In-place branches
- `docker-compose.yml`: `build: context: . dockerfile: Dockerfile` (in-place partial)
- `release.yml`: tarball creation + upload without `--strategy registry`
- `.env`: no REGISTRY_URL/USER/PASSWORD needed

### Registry branches  
- `docker-compose.yml`: `image: ${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}` (registry partial)
- `release.yml`: QEMU + buildx + build+push + upload with `--strategy registry`
- `.env`: includes REGISTRY_URL, REGISTRY_USER, REGISTRY_PASSWORD, IMAGE_NAME, IMAGE_TAG

### Single vs Multi topology
- Single: uses `release-single.yml` template (no scope/filter inputs, `deploy` command instead of prepare+switch)
- Multi: uses `release-multi.yml` template (3-job barrier pattern)

## Test Procedure (Per Branch)

1. Create branch from `feature/deploy-cli`
2. Copy appropriate generated files (workflow, docker-compose)
3. Commit and push
4. Trigger workflow via `gh workflow run`
5. Monitor with `gh run view`
6. Verify: all jobs pass, app is accessible on target servers
7. Document result

## Success Criteria

- [ ] All 4 test combinations pass end-to-end
- [ ] In-place: tarball uploaded, Docker build on server, health check passes, nginx switches
- [ ] Registry: image built+pushed, servers pull image, health check passes, nginx switches
- [ ] Single-server: `deploy` command handles full flow in one job
- [ ] Multi-server: 3-job barrier pattern works (prepare all → switch all)
- [ ] No regressions in existing functionality

## Cleanup

After testing:
- Delete test branches on ScaffoldApp: `git push origin --delete test/*`
- ScaffoldApp `feature/deploy-cli` branch remains on registry strategy (current working state)
