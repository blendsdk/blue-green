#!/bin/bash
# =============================================================================
# {{PROJECT_NAME}} — Remote Operations Script
# =============================================================================
# Single server-side script handling all remote operations for the
# {{PROJECT_NAME}} deployment. Uploaded to the server by GitHub Actions
# and invoked via SSH subcommands.
#
# Location on server: ${DEPLOY_PATH}/scripts/remote-ops.sh
#
# Usage:
#   remote-ops.sh <command> [options]
#
# Deploy Commands:
#   setup-dirs             Create directory structure for deployment
#   receive-deploy         Copy tarball into Docker build context
#   blue-green-prepare     Build/pull + start + health check (no traffic switch)
#   blue-green-switch      Switch nginx to prepared color + stop old + cleanup
#   blue-green-deploy      Full deploy (prepare + switch in one step)
#   rebuild                Rebuild current active color containers
#
# Blue-Green Commands:
#   switch-color [color]   Manual blue↔green switch without rebuild
#   active-color           Print current active color
#
# Operations Commands:
#   restart-app            Restart current active color containers
#   restart-all            Down + up all containers
#   health-check           Full health check (containers + app + db)
#   wait-healthy [secs]    Loop health check until healthy (default: 120)
#   view-logs [lines]      Show last N app log lines (default: 200)
#   rollback               Revert to previous version (strategy-aware)
#
# Database Commands (PostgreSQL):
#   backup                 Trigger database backup
#   run-migrations         Restart app to trigger migrations + wait-healthy
#     --backup             Trigger backup before migrations
#   purge-database         Drop/recreate DB (acceptance only)
#   db-table-counts        Show row counts for all tables
#
# Environment:
#   DEPLOY_PATH is auto-detected from the script's own location.
#   The script expects to live at ${DEPLOY_PATH}/scripts/remote-ops.sh
#   with docker-compose.yml at ${DEPLOY_PATH}/docker-compose.yml.
# =============================================================================

set -euo pipefail

# ── Path Detection ───────────────────────────────────────────
# Auto-detect DEPLOY_PATH from where this script lives.
# Resolves symlinks so it works even if called via a symlink.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_PATH="${DEPLOY_PATH:-$(dirname "$SCRIPT_DIR")}"

# ── Shared Utility Functions ─────────────────────────────────

# Log an informational message with a green checkmark prefix.
log_info() {
  echo "✅ $1"
}

# Log an error message with a red cross prefix to stderr.
log_error() {
  echo "❌ $1" >&2
}

# Log a warning message with a warning prefix.
log_warn() {
  echo "⚠️  $1"
}

# Log a step progress message (for multi-step operations).
# Usage: log_step "1/11" "Doing something..."
log_step() {
  echo "$1 $2"
}

# Run docker compose with the correct compose file path.
# All arguments are passed through to docker compose.
# Usage: dc up -d
#        dc --profile blue up -d
dc() {
  docker compose -f "${DEPLOY_PATH}/docker-compose.yml" --env-file "${DEPLOY_PATH}/.env" "$@"
}

# Detect the current active color from the Nginx upstream config.
# Reads active-upstream.conf to determine if blue or green is active.
# Returns: "blue" or "green" via stdout
detect_active_color() {
  local upstream_file="${DEPLOY_PATH}/nginx/upstreams/active-upstream.conf"

  if [[ ! -f "$upstream_file" ]]; then
    log_error "active-upstream.conf not found at ${upstream_file}"
    return 1
  fi

  if grep -q "app_blue" "$upstream_file"; then
    echo "blue"
  elif grep -q "app_green" "$upstream_file"; then
    echo "green"
  else
    log_error "Cannot detect active color from ${upstream_file}"
    return 1
  fi
}

# Get the opposite color (blue→green, green→blue).
get_opposite_color() {
  if [[ "$1" == "blue" ]]; then
    echo "green"
  else
    echo "blue"
  fi
}

# Wait for the app containers to become healthy.
# Uses health-check-wait.sh for Docker-level health checks.
# Arguments:
#   $1 - service name (e.g., app_blue)
#   $2 - timeout in seconds (optional, default: 120)
wait_for_service() {
  local service="$1"
  local timeout="${2:-120}"

  local compose_file="${DEPLOY_PATH}/docker-compose.yml"

  if [[ -x "${SCRIPT_DIR}/health-check-wait.sh" ]]; then
    "${SCRIPT_DIR}/health-check-wait.sh" "$service" "$timeout" "$compose_file"
  else
    bash "${SCRIPT_DIR}/health-check-wait.sh" "$service" "$timeout" "$compose_file"
  fi
}

# ── Strategy Detection ───────────────────────────────────────

# Detect deployment strategy from docker-compose.yml.
# If app services use "image:" with registry/tag variables → registry strategy (pull).
# If app services use "build:" → in-place strategy (build from tarball).
# Returns: "registry" or "in-place" via stdout.
detect_strategy() {
  local compose_file="${DEPLOY_PATH}/docker-compose.yml"

  # Look for image references that use registry variables (IMAGE_TAG, REGISTRY_URL, etc.)
  if grep -q '^\s*image:.*\${\?\(IMAGE_TAG\|REGISTRY\)' "$compose_file" 2>/dev/null; then
    echo "registry"
  else
    echo "in-place"
  fi
}

# ── Deploy Commands ──────────────────────────────────────────

# Create the full directory structure needed for deployment.
# Called once during initial server setup to ensure all target
# directories exist and are owned by the deploy user.
cmd_setup_dirs() {
  echo "Creating deployment directory structure..."
  mkdir -p \
    "${DEPLOY_PATH}/nginx/conf.d" \
    "${DEPLOY_PATH}/nginx/includes" \
    "${DEPLOY_PATH}/nginx/locations" \
    "${DEPLOY_PATH}/nginx/upstreams" \
    "${DEPLOY_PATH}/scripts" \
    "${DEPLOY_PATH}/data" \
    "${DEPLOY_PATH}/backups"
  log_info "Directory structure created at ${DEPLOY_PATH}"
}

# Prepare the deployment tarball for Docker build.
# Copies deployment-latest.tgz into the Docker build context
# so the Dockerfile can COPY it during image build.
cmd_receive_deploy() {
  echo "Preparing deployment for Docker build..."

  # The tarball is expected at DEPLOY_PATH root (uploaded by GitHub Actions)
  if [[ ! -f "${DEPLOY_PATH}/deployment-latest.tgz" ]]; then
    log_error "deployment-latest.tgz not found at ${DEPLOY_PATH}"
    return 1
  fi

  # Ensure scripts are executable on the remote
  chmod +x "${DEPLOY_PATH}/scripts/"*.sh 2>/dev/null || true

  log_info "Deployment prepared at ${DEPLOY_PATH}"
}

# Two-phase blue-green deployment: PREPARE phase.
# Executes the slow, variable-time portion of deployment:
#   1. Detect current active color
#   2. Determine target color (opposite, or --force-color)
#   3. Detect strategy and build (in-place) or pull (registry)
#   4. Start core services + target replicas
#   5. Wait for health checks to pass
#   6. Write target color to state file for switch phase
#
# On failure, tears down target replicas and aborts — no traffic is switched.
# The CLI calls this via SSH on each server independently.
#
# Arguments:
#   --force-color <color>  Force deploy to a specific color
cmd_blue_green_prepare() {
  local force_color=""

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force-color)
        force_color="$2"
        shift 2
        ;;
      *)
        log_error "Unknown argument: $1"
        return 1
        ;;
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

  # Step 3: Detect strategy and build/pull the target image
  local strategy
  strategy=$(detect_strategy)
  log_step "3/6" "Strategy: ${strategy}"

  if [[ "$strategy" == "registry" ]]; then
    # Registry strategy: pull pre-built image from registry
    log_step "3/6" "Pulling app_${target_color} image..."
    if ! dc pull "app_${target_color}"; then
      log_error "Pull failed for app_${target_color}"
      return 2
    fi
  else
    # In-place strategy: build from tarball uploaded to server
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

  # Step 4: Start core services (nginx, postgres, redis) + target replicas
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

  # Step 6: Write target color to state file (for switch phase to read)
  # This is the coordination mechanism between prepare and switch phases.
  log_step "6/6" "Saving prepare state..."
  echo "${target_color}" > "${DEPLOY_PATH}/.prepared-color"

  echo ""
  echo "========================================="
  echo "  Prepare complete!"
  echo "  Ready to switch to: ${target_color}"
  echo "  Run 'remote-ops.sh blue-green-switch' to activate"
  echo "========================================="
}

# Two-phase blue-green deployment: SWITCH phase.
# Executes the fast, near-instant traffic switch:
#   1. Switch Nginx upstream to the prepared color
#   2. Reload Nginx (graceful — no dropped connections)
#   3. Verify traffic reaches the new color
#   4. Stop old color replicas
#   5. Docker cleanup + remove state file
#
# Reads the target color from the state file written by prepare.
# If no state file exists (manual use), switches to opposite of current.
cmd_blue_green_switch() {
  echo "========================================="
  echo "  Blue-Green Switch"
  echo "========================================="

  # Read prepared color from state file (written by blue-green-prepare)
  local target_color
  local state_file="${DEPLOY_PATH}/.prepared-color"

  if [[ -f "$state_file" ]]; then
    target_color=$(cat "$state_file")
  else
    # Fallback: switch to opposite of current (for manual/standalone use)
    local fallback_current
    fallback_current=$(detect_active_color)
    target_color=$(get_opposite_color "$fallback_current")
    log_warn "No prepare state found — switching to ${target_color}"
  fi

  local current_color
  current_color=$(detect_active_color)

  # Step 1: Switch Nginx upstream config to target color
  log_step "1/5" "Switching Nginx upstream to ${target_color}..."
  local upstream_dir="${DEPLOY_PATH}/nginx/upstreams"
  cp "${upstream_dir}/${target_color}-upstream.conf" "${upstream_dir}/active-upstream.conf"

  # Step 2: Reload Nginx (graceful — zero-downtime)
  log_step "2/5" "Reloading Nginx..."
  if ! dc exec nginx nginx -s reload; then
    log_error "Nginx reload failed"
    return 4
  fi

  # Step 3: Verify traffic reaches the new color via health endpoint
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

  # Step 4: Stop old color replicas (only if different from target)
  if [[ "$current_color" != "$target_color" ]]; then
    log_step "4/5" "Stopping old ${current_color} replicas..."
    dc --profile "${current_color}" stop
  else
    log_step "4/5" "Same color restart — skipping stop step"
  fi

  # Step 5: Docker cleanup + remove state file
  log_step "5/5" "Docker cleanup..."
  docker system prune -f --filter "until=24h" 2>/dev/null || true
  rm -f "${DEPLOY_PATH}/.prepared-color"

  echo ""
  echo "========================================="
  echo "  Switch complete!"
  echo "  Active: ${target_color}"
  echo "========================================="
}

# Full zero-downtime blue-green deploy (backward-compatible convenience wrapper).
# Runs both phases sequentially: prepare → switch.
# For multi-server coordinated deploys, the CLI calls prepare and switch
# separately with a barrier in between (all servers prepare → all switch).
#
# Arguments:
#   --force-color <color>  Force deploy to a specific color
cmd_blue_green_deploy() {
  # Phase 1: Prepare (build/pull → start → health check)
  cmd_blue_green_prepare "$@" || return $?

  # Phase 2: Switch (nginx swap → stop old → cleanup)
  cmd_blue_green_switch
}

# Rebuild current active color containers.
# Strategy-aware: uses --build for in-place, or pull for registry.
cmd_rebuild() {
  local current_color
  current_color=$(detect_active_color)
  local strategy
  strategy=$(detect_strategy)

  echo "Rebuilding ${current_color} containers (strategy: ${strategy})..."

  if [[ "$strategy" == "registry" ]]; then
    # Registry strategy: pull latest image then recreate containers
    dc pull "app_${current_color}"
    dc --profile "${current_color}" up -d
  else
    # In-place strategy: rebuild from local tarball
    dc --profile "${current_color}" up --build -d
  fi

  log_info "Containers rebuilt and restarted (${current_color})"
}

# ── Blue-Green Commands ──────────────────────────────────────

# Manual blue↔green switch without rebuilding.
# Switches Nginx upstream and restarts profiles.
# Arguments:
#   $1 - target color (optional, defaults to opposite of current)
cmd_switch_color() {
  local current_color
  current_color=$(detect_active_color)

  local target_color="${1:-$(get_opposite_color "$current_color")}"

  if [[ "$target_color" != "blue" && "$target_color" != "green" ]]; then
    log_error "Invalid color: ${target_color}. Must be 'blue' or 'green'"
    return 1
  fi

  echo "Switching from ${current_color} to ${target_color}..."

  # Switch upstream config
  local upstream_dir="${DEPLOY_PATH}/nginx/upstreams"
  cp "${upstream_dir}/${target_color}-upstream.conf" "${upstream_dir}/active-upstream.conf"

  # Reload Nginx
  dc exec nginx nginx -s reload

  log_info "Switched to ${target_color}"
}

# Print the current active color.
cmd_active_color() {
  detect_active_color
}

# ── Operations Commands ──────────────────────────────────────

# Restart current active color containers (no rebuild).
cmd_restart_app() {
  local current_color
  current_color=$(detect_active_color)

  dc --profile "${current_color}" restart
  log_info "App containers restarted (${current_color})"
}

# Full restart of all containers (down + up).
# Does NOT rebuild — use 'rebuild' for that.
cmd_restart_all() {
  dc --profile all down
  dc --profile all up -d
  log_info "All containers restarted"
}

# Full health check — shows container status, app health, and database status.
cmd_health_check() {
  local current_color
  current_color=$(detect_active_color)

  echo "=== Container Status ==="
  dc ps

  echo ""
  echo "=== Active Color ==="
  echo "  ${current_color}"

  echo ""
  echo "=== App Health ==="
  dc exec -T "app_${current_color}" node -e \
    "fetch('http://localhost:{{APP_PORT}}/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2))).catch(e=>console.error('UNHEALTHY:',e.message))" \
    2>/dev/null || echo "  App health check failed"

  # {{HEALTH_CHECK_DB_PARTIAL}}
}

# Wait for the active app to be healthy.
# Arguments:
#   $1 - timeout in seconds (optional, default: 120)
cmd_wait_healthy() {
  local current_color
  current_color=$(detect_active_color)
  local timeout="${1:-120}"

  wait_for_service "app_${current_color}" "$timeout"
}

# Show the last N lines of app container logs.
# Arguments:
#   $1 - number of lines (optional, default: 200)
cmd_view_logs() {
  local current_color
  current_color=$(detect_active_color)
  local lines="${1:-200}"

  dc logs --tail="${lines}" "app_${current_color}"
}

# Strategy-aware rollback dispatcher.
# Detects the deployment strategy and delegates to the appropriate rollback method.
cmd_rollback() {
  local strategy
  strategy=$(detect_strategy)

  if [[ "$strategy" == "registry" ]]; then
    cmd_rollback_registry
  else
    cmd_rollback_inplace
  fi
}

# Rollback for in-place (tarball) strategy.
# Finds the second-most-recent tarball, re-links it as latest,
# then performs a full blue-green deploy with the old version.
cmd_rollback_inplace() {
  echo "Rolling back to previous deployment (in-place)..."

  cd "${DEPLOY_PATH}"

  # Find the current tarball (what the symlink points to)
  local current
  current=$(readlink deployment-latest.tgz 2>/dev/null || echo "deployment-latest.tgz")

  # Find the previous tarball (second-most-recent, excluding the 'latest' symlink).
  local previous
  previous=$(
    for f in deployment-*.tgz; do
      [ -f "$f" ] && [ "$f" != "deployment-latest.tgz" ] && echo "$f"
    done | sort -r | head -2 | tail -1
  )

  if [ -z "$previous" ] || [ "$previous" = "$current" ]; then
    log_error "No previous version available for rollback"
    return 1
  fi

  echo "Rolling back from ${current} to ${previous}"

  # Update the symlink to point to the previous tarball
  ln -sf "$previous" deployment-latest.tgz

  # Perform a full blue-green deploy with the rolled-back tarball
  cmd_blue_green_deploy
}

# Rollback for registry strategy.
# Reads the previous image tag from a state file (.previous-image-tag),
# updates .env with it, then performs a full blue-green deploy.
# The state file is written by the CLI's registry command before each deploy.
cmd_rollback_registry() {
  echo "Rolling back to previous image (registry)..."

  local prev_tag_file="${DEPLOY_PATH}/.previous-image-tag"

  if [[ ! -f "$prev_tag_file" ]]; then
    log_error "No previous image tag recorded. Cannot rollback."
    log_error "File not found: ${prev_tag_file}"
    return 1
  fi

  local prev_tag
  prev_tag=$(cat "$prev_tag_file")
  echo "Rolling back to image tag: ${prev_tag}"

  # Update .env with the previous image tag
  if grep -q "^IMAGE_TAG=" "${DEPLOY_PATH}/.env" 2>/dev/null; then
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${prev_tag}/" "${DEPLOY_PATH}/.env"
  else
    echo "IMAGE_TAG=${prev_tag}" >> "${DEPLOY_PATH}/.env"
  fi

  # Perform a full blue-green deploy with the rolled-back image
  cmd_blue_green_deploy
}

# ── Database Commands ────────────────────────────────────────

# {{DATABASE_COMMANDS_PARTIAL}}

# ── Help / Usage ─────────────────────────────────────────────

# Print usage information for all available subcommands.
cmd_help() {
  cat << 'EOF'
{{PROJECT_NAME}} Remote Operations Script

Usage: remote-ops.sh <command> [options]

Deploy Commands:
  setup-dirs             Create directory structure for deployment
  receive-deploy         Copy tarball into Docker build context
  blue-green-prepare     Build/pull + start + health check (no traffic switch)
    --force-color COLOR  Force deploy to a specific color (blue or green)
  blue-green-switch      Switch nginx to prepared color + stop old + cleanup
  blue-green-deploy      Full deploy (prepare + switch in one step)
    --force-color COLOR  Force deploy to a specific color (blue or green)
  rebuild                Rebuild current active color containers

Blue-Green Commands:
  switch-color [color]   Manual blue↔green switch without rebuild
  active-color           Print current active color

Operations Commands:
  restart-app            Restart current active color containers
  restart-all            Down + up all containers
  health-check           Full health check (containers + app + db)
  wait-healthy [secs]    Loop health check until healthy (default: 120)
  view-logs [lines]      Show last N app log lines (default: 200)
  rollback               Revert to previous version (strategy-aware)

{{HELP_DATABASE_PARTIAL}}Environment:
  DEPLOY_PATH            Override base deployment path (default: auto-detected)

Strategy Detection:
  The script auto-detects whether to build (in-place) or pull (registry)
  based on the docker-compose.yml configuration. No flags needed.

Examples:
  remote-ops.sh blue-green-deploy
  remote-ops.sh blue-green-deploy --force-color green
  remote-ops.sh blue-green-prepare
  remote-ops.sh blue-green-switch
  remote-ops.sh health-check
  remote-ops.sh active-color
  remote-ops.sh switch-color green
  remote-ops.sh view-logs 500
  remote-ops.sh wait-healthy 300
  remote-ops.sh rollback
EOF
}

# ── Subcommand Dispatcher ────────────────────────────────────

# Dispatch to the appropriate subcommand function based on the
# first argument. Remaining arguments are passed through.
main() {
  local command="${1:-help}"
  shift || true

  case "$command" in
    # Deploy commands
    setup-dirs)            cmd_setup_dirs "$@" ;;
    receive-deploy)        cmd_receive_deploy "$@" ;;
    blue-green-prepare)    cmd_blue_green_prepare "$@" ;;
    blue-green-switch)     cmd_blue_green_switch "$@" ;;
    blue-green-deploy)     cmd_blue_green_deploy "$@" ;;
    rebuild)               cmd_rebuild "$@" ;;

    # Blue-green commands
    switch-color)       cmd_switch_color "$@" ;;
    active-color)       cmd_active_color "$@" ;;

    # Operations commands
    restart-app)        cmd_restart_app "$@" ;;
    restart-all)        cmd_restart_all "$@" ;;
    health-check)       cmd_health_check "$@" ;;
    wait-healthy)       cmd_wait_healthy "$@" ;;
    view-logs)          cmd_view_logs "$@" ;;
    rollback)           cmd_rollback "$@" ;;

    # {{DISPATCHER_DATABASE_PARTIAL}}

    # Help
    help|--help|-h)     cmd_help ;;

    *)
      log_error "Unknown command: ${command}"
      echo "Run 'remote-ops.sh help' for usage information."
      exit 1
      ;;
  esac
}

main "$@"
