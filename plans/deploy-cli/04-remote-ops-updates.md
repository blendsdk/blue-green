# Remote Ops Updates

> **Document**: 04-remote-ops-updates.md
> **Parent**: [Index](00-index.md)

## Overview

`remote-ops.sh` is the server-side script that handles all Docker Compose and Nginx operations. It stays as bash (these are inherently shell operations) but needs updates to support:

1. **Two-phase deployment** — split `blue-green-deploy` into `prepare` + `switch`
2. **Registry-based deployment** — `docker compose pull` instead of `docker compose build`
3. **Strategy detection** — auto-detect whether to build or pull based on docker-compose.yml

## Changes Required

### New Commands

| Command | Purpose | Phase |
|---------|---------|-------|
| `blue-green-prepare` | Steps 1-6: build/pull + start + health check (no traffic switch) | Slow |
| `blue-green-switch` | Steps 7-11: switch nginx + stop old + cleanup | Fast |

### Modified Commands

| Command | Change |
|---------|--------|
| `blue-green-deploy` | Refactored to call `prepare` then `switch` (backward compat) |

### Unchanged Commands

All other commands remain identical:
- `setup-dirs`, `receive-deploy`, `rebuild`
- `switch-color`, `active-color`
- `restart-app`, `restart-all`, `health-check`, `wait-healthy`, `view-logs`
- `rollback`
- Database commands (partials)

## Implementation Details

### Strategy Detection

Rather than passing a `--strategy` flag, `remote-ops.sh` auto-detects the deployment strategy by inspecting the docker-compose.yml:

```bash
# Detect deployment strategy from docker-compose.yml
# If services use "image:" → registry strategy (pull)
# If services use "build:" → in-place strategy (build)
detect_strategy() {
  local compose_file="${DEPLOY_PATH}/docker-compose.yml"
  if grep -q "^\s*image:.*\${IMAGE_TAG\|REGISTRY" "$compose_file" 2>/dev/null; then
    echo "registry"
  else
    echo "in-place"
  fi
}
```

### `cmd_blue_green_prepare` — New Command

Executes the slow, variable-time portion of deployment:

```bash
cmd_blue_green_prepare() {
  local force_color=""
  
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force-color) force_color="$2"; shift 2 ;;
      *) log_error "Unknown argument: $1"; return 1 ;;
    esac
  done

  echo "========================================="
  echo "  Blue-Green Prepare"
  echo "========================================="

  # Step 1: Detect current color
  log_step "1/6" "Detecting current active color..."
  local current_color
  current_color=$(detect_active_color)
  echo "  Current active: ${current_color}"

  # Step 2: Determine target color
  log_step "2/6" "Determining target color..."
  local target_color
  if [[ -n "$force_color" ]]; then
    target_color="$force_color"
  else
    target_color=$(get_opposite_color "$current_color")
  fi
  echo "  Target: ${target_color}"

  # Step 3: Detect strategy and build/pull
  local strategy
  strategy=$(detect_strategy)
  log_step "3/6" "Strategy: ${strategy}"

  if [[ "$strategy" == "registry" ]]; then
    log_step "3/6" "Pulling app_${target_color} image..."
    if ! dc pull "app_${target_color}"; then
      log_error "Pull failed for app_${target_color}"
      return 2
    fi
  else
    log_step "3/6" "Verifying deployment tarball..."
    if [[ ! -f "${DEPLOY_PATH}/deployment-latest.tgz" ]]; then
      log_error "deployment-latest.tgz not found"
      return 1
    fi
    log_step "3/6" "Building app_${target_color} image..."
    if ! dc build "app_${target_color}"; then
      log_error "Build failed for app_${target_color}"
      return 2
    fi
  fi

  # Step 4: Start core services + target replicas
  log_step "4/6" "Starting core services and app_${target_color} replicas..."
  dc --profile core --profile "${target_color}" up -d

  # Step 5: Wait for health checks
  log_step "5/6" "Waiting for app_${target_color} health checks..."
  if ! wait_for_service "app_${target_color}" 120; then
    log_error "Health checks failed for app_${target_color}"
    echo "Aborting — tearing down ${target_color} replicas..." >&2
    dc --profile "${target_color}" stop
    return 3
  fi

  # Step 6: Write target color to state file (for switch to read)
  log_step "6/6" "Saving prepare state..."
  echo "${target_color}" > "${DEPLOY_PATH}/.prepared-color"

  echo ""
  echo "========================================="
  echo "  Prepare complete!"
  echo "  Ready to switch to: ${target_color}"
  echo "  Run 'remote-ops.sh blue-green-switch' to activate"
  echo "========================================="
}
```

### `cmd_blue_green_switch` — New Command

Executes the fast, near-instant traffic switch:

```bash
cmd_blue_green_switch() {
  echo "========================================="
  echo "  Blue-Green Switch"
  echo "========================================="

  # Read prepared color (set by prepare command)
  local target_color
  local state_file="${DEPLOY_PATH}/.prepared-color"
  
  if [[ -f "$state_file" ]]; then
    target_color=$(cat "$state_file")
  else
    # Fallback: switch to opposite of current (for manual use)
    local current_color
    current_color=$(detect_active_color)
    target_color=$(get_opposite_color "$current_color")
    log_warn "No prepare state found — switching to ${target_color}"
  fi

  local current_color
  current_color=$(detect_active_color)

  # Step 1: Switch Nginx upstream
  log_step "1/5" "Switching Nginx upstream to ${target_color}..."
  local upstream_dir="${DEPLOY_PATH}/nginx/upstreams"
  cp "${upstream_dir}/${target_color}-upstream.conf" "${upstream_dir}/active-upstream.conf"

  # Step 2: Reload Nginx
  log_step "2/5" "Reloading Nginx..."
  if ! dc exec nginx nginx -s reload; then
    log_error "Nginx reload failed"
    return 4
  fi

  # Step 3: Verify traffic
  log_step "3/5" "Verifying traffic reaches ${target_color}..."
  local max_attempts=5
  local attempt=0
  local verified=false

  while [[ "$attempt" -lt "$max_attempts" ]]; do
    local response
    response=$(dc exec nginx curl -sf http://localhost:80/health 2>/dev/null || true)
    if echo "$response" | grep -q "${target_color}"; then
      verified=true
      break
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  if [[ "$verified" == "true" ]]; then
    echo "  Traffic verified on ${target_color}"
  else
    log_warn "Could not verify traffic on ${target_color} (may still be working)"
  fi

  # Step 4: Stop old color
  if [[ "$current_color" != "$target_color" ]]; then
    log_step "4/5" "Stopping old ${current_color} replicas..."
    dc --profile "${current_color}" stop
  else
    log_step "4/5" "Same color restart — skipping stop step"
  fi

  # Step 5: Cleanup
  log_step "5/5" "Docker cleanup..."
  docker system prune -f --filter "until=24h" 2>/dev/null || true
  rm -f "${DEPLOY_PATH}/.prepared-color"

  echo ""
  echo "========================================="
  echo "  Switch complete!"
  echo "  Active: ${target_color}"
  echo "========================================="
}
```

### `cmd_blue_green_deploy` — Refactored (Backward Compat)

The existing command becomes a convenience wrapper:

```bash
cmd_blue_green_deploy() {
  # Full deploy: prepare + switch (for single-server or standalone use)
  cmd_blue_green_prepare "$@" || return $?
  cmd_blue_green_switch
}
```

### Dispatcher Updates

Add new commands to the case statement:

```bash
case "$command" in
  # Deploy commands
  setup-dirs)             cmd_setup_dirs "$@" ;;
  receive-deploy)         cmd_receive_deploy "$@" ;;
  blue-green-prepare)     cmd_blue_green_prepare "$@" ;;    # NEW
  blue-green-switch)      cmd_blue_green_switch "$@" ;;     # NEW
  blue-green-deploy)      cmd_blue_green_deploy "$@" ;;     # REFACTORED
  rebuild)                cmd_rebuild "$@" ;;
  # ... rest unchanged
esac
```

### Help Command Updates

Add the new commands to help output:

```
Deploy Commands:
  setup-dirs             Create directory structure for deployment
  receive-deploy         Copy tarball into Docker build context
  blue-green-prepare     Build/pull + start + health check (no switch)
  blue-green-switch      Switch nginx to prepared color + cleanup
  blue-green-deploy      Full deploy (prepare + switch in one step)
  rebuild                Rebuild current active color
```

## State File: `.prepared-color`

The prepare and switch commands communicate via a simple state file:

- **Created by:** `blue-green-prepare` — writes the target color name
- **Read by:** `blue-green-switch` — reads which color to switch to
- **Deleted by:** `blue-green-switch` — cleanup after successful switch
- **Fallback:** If state file doesn't exist, `blue-green-switch` switches to opposite of current (for manual use)
- **Location:** `${DEPLOY_PATH}/.prepared-color`

This is the simplest coordination mechanism that works reliably across SSH sessions.

## Registry Strategy: `cmd_rebuild` Update

When using registry strategy, rebuild should pull instead of build:

```bash
cmd_rebuild() {
  local current_color
  current_color=$(detect_active_color)
  local strategy
  strategy=$(detect_strategy)

  echo "Rebuilding ${current_color} containers (strategy: ${strategy})..."
  
  if [[ "$strategy" == "registry" ]]; then
    dc pull "app_${current_color}"
    dc --profile "${current_color}" up -d
  else
    dc --profile "${current_color}" up --build -d
  fi
  
  log_info "Containers rebuilt and restarted (${current_color})"
}
```

## Rollback with Registry Strategy

Rollback for registry mode works differently — instead of reverting a tarball symlink, it uses the previous image tag:

```bash
cmd_rollback() {
  local strategy
  strategy=$(detect_strategy)

  if [[ "$strategy" == "registry" ]]; then
    cmd_rollback_registry
  else
    cmd_rollback_inplace
  fi
}

cmd_rollback_inplace() {
  # Current implementation — unchanged
  # Find previous tarball, re-link, blue-green-deploy
  ...
}

cmd_rollback_registry() {
  echo "Rolling back to previous image..."
  
  # Read previous image tag from state file
  local prev_tag_file="${DEPLOY_PATH}/.previous-image-tag"
  if [[ ! -f "$prev_tag_file" ]]; then
    log_error "No previous image tag recorded. Cannot rollback."
    return 1
  fi
  
  local prev_tag
  prev_tag=$(cat "$prev_tag_file")
  echo "Rolling back to image tag: ${prev_tag}"
  
  # Update .env with previous tag
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${prev_tag}/" "${DEPLOY_PATH}/.env"
  
  # Perform blue-green deploy with the previous image
  cmd_blue_green_deploy
}
```

## Testing

- `bash -n` must pass on the updated `remote-ops.sh` template
- Manual test: `blue-green-prepare` followed by `blue-green-switch` on a running server
- Integration test: full two-phase deploy via CLI on ScaffoldApp (Phase 8)
