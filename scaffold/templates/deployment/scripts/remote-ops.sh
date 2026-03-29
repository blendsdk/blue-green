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
#   blue-green-deploy      Full zero-downtime deploy (build → health → switch)
#   rebuild                Rebuild current active color (docker compose up --build -d)
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
#   rollback               Revert to previous tarball + blue-green deploy
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

# Full zero-downtime blue-green deploy.
# This is the core deployment algorithm:
#   1. Detect current active color
#   2. Target = opposite color (or --force-color)
#   3. Ensure tarball is in build context
#   4. Build target color image
#   5. Start target replicas
#   6. Wait for all replicas to be healthy
#   7. Switch Nginx upstream to target color
#   8. Reload Nginx (graceful — no dropped connections)
#   9. Verify traffic reaches target color
#  10. Stop old color replicas
#  11. Docker cleanup
#
# Arguments:
#   --force-color <color>  Force deploy to a specific color
cmd_blue_green_deploy() {
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
  echo "  Blue-Green Deployment"
  echo "========================================="

  # Step 1: Detect current color
  log_step "1/11" "Detecting current active color..."
  local current_color
  current_color=$(detect_active_color)
  echo "  Current active: ${current_color}"

  # Step 2: Determine target color
  log_step "2/11" "Determining target color..."
  local target_color
  if [[ -n "$force_color" ]]; then
    target_color="$force_color"
  else
    target_color=$(get_opposite_color "$current_color")
  fi
  echo "  Target: ${target_color}"

  # Step 3: Ensure tarball is in build context
  log_step "3/11" "Verifying deployment tarball..."
  if [[ ! -f "${DEPLOY_PATH}/deployment-latest.tgz" ]]; then
    log_error "deployment-latest.tgz not found"
    return 1
  fi

  # Step 4: Build target color image
  log_step "4/11" "Building app_${target_color} image..."
  if ! dc build "app_${target_color}"; then
    log_error "Build failed for app_${target_color}"
    return 2
  fi

  # Step 5: Start core services (nginx) + target replicas
  log_step "5/11" "Starting core services and app_${target_color} replicas..."
  dc --profile core --profile "${target_color}" up -d

  # Step 6: Wait for health checks
  log_step "6/11" "Waiting for app_${target_color} health checks..."
  if ! wait_for_service "app_${target_color}" 120; then
    log_error "Health checks failed for app_${target_color}"
    echo "Aborting — tearing down ${target_color} replicas..." >&2
    dc --profile "${target_color}" stop
    return 3
  fi

  # Step 7: Switch Nginx upstream
  log_step "7/11" "Switching Nginx upstream to ${target_color}..."
  local upstream_dir="${DEPLOY_PATH}/nginx/upstreams"
  cp "${upstream_dir}/${target_color}-upstream.conf" "${upstream_dir}/active-upstream.conf"

  # Step 8: Reload Nginx (graceful — zero-downtime)
  log_step "8/11" "Reloading Nginx..."
  if ! dc exec nginx nginx -s reload; then
    log_error "Nginx reload failed"
    return 4
  fi

  # Step 9: Verify traffic reaches new color
  log_step "9/11" "Verifying traffic reaches ${target_color}..."
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

  # Step 10: Stop old color (only if different from target)
  if [[ "$current_color" != "$target_color" ]]; then
    log_step "10/11" "Stopping old ${current_color} replicas..."
    dc --profile "${current_color}" stop
  else
    log_step "10/11" "Same color restart — skipping stop step"
  fi

  # Step 11: Docker cleanup
  log_step "11/11" "Docker cleanup..."
  docker system prune -f --filter "until=24h" 2>/dev/null || true

  echo ""
  echo "========================================="
  echo "  Deployment complete!"
  echo "  Active: ${target_color}"
  echo "========================================="
}

# Rebuild current active color containers.
# Uses --build to force Docker to rebuild with the latest tarball.
cmd_rebuild() {
  local current_color
  current_color=$(detect_active_color)

  echo "Rebuilding ${current_color} containers..."
  dc --profile "${current_color}" up --build -d
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

# Rollback to the previous deployment tarball.
# Finds the second-most-recent tarball, re-links it as latest,
# then performs a full blue-green deploy with the old version.
cmd_rollback() {
  echo "Rolling back to previous deployment..."

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
  blue-green-deploy      Full zero-downtime deploy (build → health → switch)
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
  rollback               Revert to previous tarball + blue-green deploy

{{HELP_DATABASE_PARTIAL}}Environment:
  DEPLOY_PATH            Override base deployment path (default: auto-detected)

Examples:
  remote-ops.sh blue-green-deploy
  remote-ops.sh blue-green-deploy --force-color green
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
    setup-dirs)         cmd_setup_dirs "$@" ;;
    receive-deploy)     cmd_receive_deploy "$@" ;;
    blue-green-deploy)  cmd_blue_green_deploy "$@" ;;
    rebuild)            cmd_rebuild "$@" ;;

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
