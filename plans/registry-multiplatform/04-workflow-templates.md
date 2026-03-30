# Workflow Templates Backport

> **Document**: 04-workflow-templates.md
> **Parent**: [Index](00-index.md)

## Overview

Update `release-single.yml` and `release-multi.yml` templates to conditionally support both in-place and registry deployment strategies using the scaffold partial system.

## Strategy: Conditional Workflow Partials

Create workflow partial files that the scaffold generator injects based on strategy choice.

### New Partials

| Partial File | Purpose | Injected When |
|-------------|---------|---------------|
| `workflow-release-registry-steps.yml` | QEMU + buildx setup + docker login + build+push + cleanup | strategy=registry |
| `workflow-release-upload-inplace.yml` | Upload with tarball (current behavior) | strategy=in-place |
| `workflow-release-upload-registry.yml` | Upload with `--strategy registry` (no tarball) | strategy=registry |

### Template Placeholders

In `release-single.yml` and `release-multi.yml`:
```yaml
      # --- Strategy-specific: build ---
      {{WORKFLOW_REGISTRY_STEPS}}

      # --- Strategy-specific: upload ---
      {{WORKFLOW_UPLOAD_STEPS}}
```

### Registry Steps Partial Content

```yaml
      # Enable cross-platform builds (QEMU for non-native architectures)
      - name: Set up QEMU for cross-platform builds
        run: docker run --rm --privileged multiarch/qemu-user-static --reset -p yes

      # Set up Docker Buildx for multi-platform builds
      - name: Set up Docker Buildx
        run: docker buildx create --name bluegreen --use 2>/dev/null || docker buildx use bluegreen

      # Build and push Docker image to private registry
      - name: Build and push image to registry
        run: |
          echo "${{ secrets.REGISTRY_PASSWORD }}" | docker login ${{ secrets.REGISTRY_URL }} -u ${{ secrets.REGISTRY_USER }} --password-stdin
          node deployment/scripts/deploy-cli.js registry \
            --registry-url ${{ secrets.REGISTRY_URL }} \
            --image-name {{PROJECT_NAME_LOWER}} \
            --tag latest \
            --platform {{DOCKER_PLATFORM}} \
            --deploy-path deployment

      # Cleanup Docker images to prevent disk exhaustion
      - name: Cleanup Docker build artifacts
        if: always()
        run: docker image prune -f
```

### In-Place Upload Partial

```yaml
      - name: Upload to all servers
        run: |
          node deployment/scripts/deploy-cli.js upload \
            --env ${{ inputs.deploy_target }} \
            ...
            --project-name {{PROJECT_NAME_LOWER}}
```

### Registry Upload Partial

Same as in-place but with `--strategy registry` flag appended.

## Changes to Both Templates

1. Replace hardcoded tarball creation + upload steps with `{{WORKFLOW_REGISTRY_STEPS}}` and `{{WORKFLOW_UPLOAD_STEPS}}` placeholders
2. Keep common steps unchanged: checkout, install, deploy-config, prepare, switch
3. The "Create deployment package" step stays for both strategies (Dockerfile needs tarball even for registry)

## Template Structure (release-multi.yml after changes)

```
jobs:
  build_and_test:        # unchanged
  deploy_prepare:
    steps:
      - Clean workspace  # unchanged
      - Checkout          # unchanged
      - Install + build   # unchanged
      - Create deployment package  # unchanged (both strategies need tarball)
      {{WORKFLOW_REGISTRY_STEPS}}  # empty for in-place, QEMU+buildx+push for registry
      {{WORKFLOW_UPLOAD_STEPS}}    # with or without --strategy registry
      - Deploy config     # unchanged
      - Prepare all       # unchanged
  deploy_switch:         # unchanged
```
