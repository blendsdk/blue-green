# Workflow Refactoring

> **Document**: 06-workflow-refactoring.md
> **Parent**: [Index](00-index.md)

## Overview

All 5 GitHub Actions workflow files are refactored to call `deploy-cli.js` commands instead of containing inline bash. The YAML becomes thin orchestration (when/what), the CLI does implementation (how).

## Principles

1. **YAML = orchestration** — triggers, inputs, concurrency, job dependencies, conditional steps
2. **CLI = implementation** — SSH, SCP, config resolution, multi-server coordination
3. **One-liner steps** — each workflow step calls a single CLI command
4. **Environment variables** — secrets passed via `env:` block, CLI reads from `process.env`

## Workflow: `build-test.yml`

**Changes: Minimal** — this file has no deployment logic. Only change is ensuring it uses the same build commands.

```yaml
name: Build & Test

on:
  push:
    branches: ['*']
  pull_request:
    branches: ['*']

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build_and_test:
    name: Build & Test
    runs-on: self-hosted
    timeout-minutes: 20
    steps:
      - name: Clean workspace
        run: find . -mindepth 1 -delete 2>/dev/null || true

      - name: Checkout
        uses: actions/checkout@v4

      - name: Install dependencies
        run: |
          npm install -g yarn
          yarn install --frozen-lockfile

      - name: Build
        run: yarn clean && yarn build

      - name: Test
        run: yarn test
```

**No changes from current version.**

## Workflow: `release-single.yml`

**Changes: Major** — inline bash for SSH setup, config deployment, env setup all replaced with CLI calls.

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      deploy_target:
        description: 'Deployment target'
        required: true
        type: choice
        options:
          - test
          - acceptance
          - production
      skip_tests:
        description: 'Skip tests'
        type: boolean
        default: false

concurrency:
  group: release-${{ inputs.deploy_target }}
  cancel-in-progress: false

jobs:
  build_and_test:
    name: Build & Test
    runs-on: self-hosted
    timeout-minutes: 20
    steps:
      - name: Clean workspace
        run: find . -mindepth 1 -delete 2>/dev/null || true

      - name: Checkout
        uses: actions/checkout@v4

      - name: Install dependencies
        run: |
          npm install -g yarn
          yarn install --frozen-lockfile

      - name: Build
        run: yarn clean && yarn build

      - name: Test
        if: ${{ !inputs.skip_tests }}
        run: yarn test

  deploy:
    name: Deploy to ${{ inputs.deploy_target }}
    runs-on: self-hosted
    timeout-minutes: 20
    needs: [build_and_test]
    steps:
      - name: Clean workspace
        run: find . -mindepth 1 -delete 2>/dev/null || true

      - name: Checkout
        uses: actions/checkout@v4

      - name: Install dependencies + build
        run: |
          npm install -g yarn
          yarn install --frozen-lockfile
          yarn clean && yarn build

      - name: Create deployment package
        run: ./deploy-package.sh

      - name: Upload to server
        run: |
          node deployment/scripts/deploy-cli.js upload \
            --env ${{ inputs.deploy_target }} \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.deploy_target }} \
            --project-name {{PROJECT_NAME_LOWER}}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}

      - name: Deploy config files
        run: |
          node deployment/scripts/deploy-cli.js deploy-config \
            --env ${{ inputs.deploy_target }} \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.deploy_target }}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}
          ALL_SECRETS: ${{ toJSON(secrets) }}

      - name: Blue-green deploy
        run: |
          node deployment/scripts/deploy-cli.js deploy \
            --env ${{ inputs.deploy_target }} \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.deploy_target }}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}
```

**Before: ~180 lines, ~120 lines inline bash**
**After: ~80 lines, 0 lines inline bash (all CLI calls)**

## Workflow: `release-multi.yml`

**Changes: Major** — most significant refactoring. Three-job structure: build → upload+prepare → switch.

```yaml
name: Release (Multi-Server)

on:
  workflow_dispatch:
    inputs:
      deploy_target:
        description: 'Deployment target environment'
        required: true
        type: choice
        options:
          - test
          - acceptance
          - production
      deploy_scope:
        description: 'Deploy scope'
        required: true
        type: choice
        default: 'all'
        options:
          - all
          - group
          - tag
          - server
      deploy_filter:
        description: 'Filter value (required when scope is not "all")'
        required: false
        type: string
        default: ''
      skip_tests:
        description: 'Skip tests'
        type: boolean
        default: false

concurrency:
  group: release-${{ inputs.deploy_target }}
  cancel-in-progress: false

jobs:
  build_and_test:
    name: Build & Test
    runs-on: self-hosted
    timeout-minutes: 20
    steps:
      - name: Clean workspace
        run: find . -mindepth 1 -delete 2>/dev/null || true

      - name: Checkout
        uses: actions/checkout@v4

      - name: Install dependencies
        run: |
          npm install -g yarn
          yarn install --frozen-lockfile

      - name: Build
        run: yarn clean && yarn build

      - name: Test
        if: ${{ !inputs.skip_tests }}
        run: yarn test

  deploy_prepare:
    name: Upload & Prepare
    runs-on: self-hosted
    timeout-minutes: 30
    needs: [build_and_test]
    steps:
      - name: Clean workspace
        run: find . -mindepth 1 -delete 2>/dev/null || true

      - name: Checkout
        uses: actions/checkout@v4

      - name: Install dependencies + build
        run: |
          npm install -g yarn
          yarn install --frozen-lockfile
          yarn clean && yarn build

      - name: Create deployment package
        run: ./deploy-package.sh

      - name: Upload to all servers
        run: |
          node deployment/scripts/deploy-cli.js upload \
            --env ${{ inputs.deploy_target }} \
            --scope ${{ inputs.deploy_scope }} \
            --filter "${{ inputs.deploy_filter }}" \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.deploy_target }} \
            --project-name {{PROJECT_NAME_LOWER}}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}

      - name: Deploy config files to all servers
        run: |
          node deployment/scripts/deploy-cli.js deploy-config \
            --env ${{ inputs.deploy_target }} \
            --scope ${{ inputs.deploy_scope }} \
            --filter "${{ inputs.deploy_filter }}" \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.deploy_target }}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}
          ALL_SECRETS: ${{ toJSON(secrets) }}

      - name: Prepare all servers (build + health, no switch)
        run: |
          node deployment/scripts/deploy-cli.js prepare \
            --env ${{ inputs.deploy_target }} \
            --scope ${{ inputs.deploy_scope }} \
            --filter "${{ inputs.deploy_filter }}" \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.deploy_target }}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}

  deploy_switch:
    name: Switch all servers
    runs-on: self-hosted
    timeout-minutes: 5
    needs: [deploy_prepare]
    steps:
      - name: Clean workspace
        run: find . -mindepth 1 -delete 2>/dev/null || true

      - name: Checkout
        uses: actions/checkout@v4

      - name: Switch all servers (fast — nginx swap only)
        run: |
          node deployment/scripts/deploy-cli.js switch \
            --env ${{ inputs.deploy_target }} \
            --scope ${{ inputs.deploy_scope }} \
            --filter "${{ inputs.deploy_filter }}" \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.deploy_target }}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}
```

**Before: ~280 lines, ~180 lines inline bash, matrix strategy with duplicated SSH/config/env bash**
**After: ~120 lines, 0 lines inline bash. CLI handles multi-server parallelism internally.**

**Key architectural change:** No more GitHub Actions matrix strategy for deployment. The CLI handles parallel execution internally. This means:
- No duplicated build per matrix job
- CLI provides the prepare→switch barrier naturally
- Single job for prepare, single job for switch
- `deploy_switch` depends on `deploy_prepare` — GitHub Actions provides the job barrier

## Workflow: `operations-single.yml`

```yaml
name: Operations

on:
  workflow_dispatch:
    inputs:
      target:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - test
          - acceptance
          - production
      operation:
        description: 'Operation to perform'
        required: true
        type: choice
        options:
          - deploy-config
          - restart-app
          - restart-all
          - health-check
          - view-logs
          - switch-color
          - rollback
          {{OPERATIONS_DATABASE_OPTIONS}}

concurrency:
  group: ops-${{ inputs.target }}
  cancel-in-progress: false

jobs:
  operate:
    name: "${{ inputs.operation }} on ${{ inputs.target }}"
    runs-on: self-hosted
    timeout-minutes: 15
    steps:
      - name: Safety check — block destructive ops on production
        if: inputs.target == 'production' && inputs.operation == 'purge-database'
        run: |
          echo "❌ BLOCKED: purge-database is NEVER allowed on production"
          exit 1

      - name: Clean workspace
        run: find . -mindepth 1 -delete 2>/dev/null || true

      - name: Checkout
        uses: actions/checkout@v4
        with:
          sparse-checkout: |
            deployment/scripts
            deploy-config.json
            deploy-inventory.json
          sparse-checkout-cone-mode: false

      - name: Execute operation
        run: |
          node deployment/scripts/deploy-cli.js operate \
            --env ${{ inputs.target }} \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.target }} \
            --op ${{ inputs.operation }}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}
          ALL_SECRETS: ${{ toJSON(secrets) }}
```

**Before: ~150 lines with duplicated SSH setup + per-operation bash blocks**
**After: ~55 lines. Single `operate` command handles everything.**

## Workflow: `operations-multi.yml`

```yaml
name: Operations (Multi-Server)

on:
  workflow_dispatch:
    inputs:
      target:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - test
          - acceptance
          - production
      operation:
        description: 'Operation to perform'
        required: true
        type: choice
        options:
          - health-check-all
          - deploy-config
          - restart-app
          - restart-all
          - health-check
          - view-logs
          - switch-color
          - rollback
          {{OPERATIONS_DATABASE_OPTIONS}}
      server_scope:
        description: 'Server scope'
        required: true
        type: choice
        default: 'all'
        options:
          - all
          - group
          - server
      server_filter:
        description: 'Filter value (required when scope is not "all")'
        required: false
        type: string
        default: ''

concurrency:
  group: ops-${{ inputs.target }}
  cancel-in-progress: false

jobs:
  operate:
    name: "${{ inputs.operation }} on ${{ inputs.target }}"
    runs-on: self-hosted
    timeout-minutes: 15
    steps:
      - name: Safety check — block destructive ops on production
        if: inputs.target == 'production' && inputs.operation == 'purge-database'
        run: |
          echo "❌ BLOCKED: purge-database is NEVER allowed on production"
          exit 1

      - name: Clean workspace
        run: find . -mindepth 1 -delete 2>/dev/null || true

      - name: Checkout
        uses: actions/checkout@v4
        with:
          sparse-checkout: |
            deployment/scripts
            deploy-config.json
            deploy-inventory.json
          sparse-checkout-cone-mode: false

      - name: Execute operation on servers
        run: |
          node deployment/scripts/deploy-cli.js operate \
            --env ${{ inputs.target }} \
            --scope ${{ inputs.server_scope }} \
            --filter "${{ inputs.server_filter }}" \
            --deploy-path ${{ secrets.DEPLOY_PATH }}/${{ inputs.target }} \
            --op ${{ inputs.operation }}
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          JUMP_HOST: ${{ secrets.JUMP_HOST }}
          ALL_SECRETS: ${{ toJSON(secrets) }}
```

**Before: ~140 lines with matrix strategy + inline SSH + case statement**
**After: ~65 lines. CLI handles multi-server and operation dispatch.**

## Summary: Lines of Code

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| `build-test.yml` | 30 | 30 | 0% |
| `release-single.yml` | 180 | 80 | **56%** |
| `release-multi.yml` | 280 | 120 | **57%** |
| `operations-single.yml` | 150 | 55 | **63%** |
| `operations-multi.yml` | 140 | 65 | **54%** |
| **Total** | **780** | **350** | **55%** |

And the remaining lines are YAML structure (triggers, inputs, job definitions) — zero inline bash logic.

## Template Considerations

- The `{{OPERATIONS_DATABASE_OPTIONS}}` partial still works — it's just YAML choice options
- The `{{DEPLOY_PGBACKUP_STEP}}` partial is no longer needed — the CLI `upload` command handles it
- Database operations are passed through to `remote-ops.sh` via the CLI `operate` command
