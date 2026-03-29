#!/bin/bash
# =============================================================================
# multi-deploy.sh — Deployment Server Fan-Out Script
# =============================================================================
# Runs on a deployment server to deploy to 20+ target servers in parallel.
# Reads deploy-inventory.json, filters servers, and deploys in batches.
#
# Usage:
#   multi-deploy.sh --env production [--scope all|group|tag] [--filter value] [--max-parallel 10]
#
# Prerequisites:
#   - SSH key access from deployment server to all target servers
#   - deployment-latest.tgz and scripts already on deployment server
#   - deploy-inventory.json on deployment server
#   - Node.js available for resolve-servers.js (ESM — requires "type": "module" in package.json)
# =============================================================================

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

# ── Arguments ────────────────────────────────────────────────
ENV=""
SCOPE="all"
FILTER=""
MAX_PARALLEL=10

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)         ENV="$2"; shift 2 ;;
    --scope)       SCOPE="$2"; shift 2 ;;
    --filter)      FILTER="$2"; shift 2 ;;
    --max-parallel) MAX_PARALLEL="$2"; shift 2 ;;
    *)
      echo -e "${RED}Unknown argument: $1${RESET}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "Usage: multi-deploy.sh --env <environment> [--scope all|group|tag] [--filter value] [--max-parallel N]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_PATH="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo -e "${CYAN}━━━ Multi-Server Deployment ━━━${RESET}"
echo -e "  Environment:  ${ENV}"
echo -e "  Scope:        ${SCOPE}"
echo -e "  Filter:       ${FILTER:-all}"
echo -e "  Max parallel: ${MAX_PARALLEL}"
echo ""

# ── Resolve Servers ──────────────────────────────────────────
# Uses resolve-servers.js --format flag for clean shell consumption (no inline JS)
FILTER_ARGS=""
[[ -n "$FILTER" ]] && FILTER_ARGS="--filter ${FILTER}"

RESOLVE_CMD="node ${SCRIPT_DIR}/resolve-servers.js --env $ENV --scope $SCOPE $FILTER_ARGS"
SERVER_COUNT=$($RESOLVE_CMD --format count)
SERVERS=$($RESOLVE_CMD --format tsv)

echo -e "  Servers:      ${SERVER_COUNT}"
echo ""

if [[ "$SERVER_COUNT" -eq 0 ]]; then
  echo -e "${RED}No servers matched the criteria${RESET}"
  exit 1
fi

# ── Deploy in Batches ────────────────────────────────────────

SUCCESS=0
FAILED=0
RESULTS_FILE=$(mktemp)

deploy_to_server() {
  local name="$1"
  local host="$2"
  local start_time=$(date +%s)

  echo -e "  ${CYAN}→ ${name}${RESET} (${host})..."

  # Deploy tarball
  if ! scp -o StrictHostKeyChecking=no "${DEPLOY_PATH}/deployment-latest.tgz" "${host}:${DEPLOY_PATH}/" 2>/dev/null; then
    echo -e "  ${RED}✗ ${name}${RESET} — tarball copy failed"
    echo "FAIL ${name}" >> "$RESULTS_FILE"
    return 1
  fi

  # Upload scripts
  ssh -o StrictHostKeyChecking=no "${host}" "mkdir -p ${DEPLOY_PATH}/scripts" 2>/dev/null
  scp -o StrictHostKeyChecking=no "${SCRIPT_DIR}/remote-ops.sh" "${SCRIPT_DIR}/health-check-wait.sh" "${host}:${DEPLOY_PATH}/scripts/" 2>/dev/null
  ssh -o StrictHostKeyChecking=no "${host}" "chmod +x ${DEPLOY_PATH}/scripts/*.sh" 2>/dev/null

  # Run blue-green deploy
  if ssh -o StrictHostKeyChecking=no "${host}" "${DEPLOY_PATH}/scripts/remote-ops.sh blue-green-deploy" 2>/dev/null; then
    local elapsed=$(( $(date +%s) - start_time ))
    echo -e "  ${GREEN}✓ ${name}${RESET} — deployed (${elapsed}s)"
    echo "OK ${name} ${elapsed}s" >> "$RESULTS_FILE"
  else
    echo -e "  ${RED}✗ ${name}${RESET} — deploy failed"
    echo "FAIL ${name}" >> "$RESULTS_FILE"
    return 1
  fi
}

# Process servers in parallel batches
BATCH=0
RUNNING=0

while IFS=$'\t' read -r name host; do
  deploy_to_server "$name" "$host" &
  RUNNING=$((RUNNING + 1))

  if [[ "$RUNNING" -ge "$MAX_PARALLEL" ]]; then
    wait
    RUNNING=0
    BATCH=$((BATCH + 1))
    echo -e "${CYAN}  ── Batch ${BATCH} complete ──${RESET}"
  fi
done <<< "$SERVERS"

# Wait for remaining
if [[ "$RUNNING" -gt 0 ]]; then
  wait
fi

# ── Report ───────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━ Deployment Report ━━━${RESET}"

SUCCESS=$(grep -c "^OK" "$RESULTS_FILE" 2>/dev/null || echo 0)
FAILED=$(grep -c "^FAIL" "$RESULTS_FILE" 2>/dev/null || echo 0)

echo -e "  ${GREEN}Succeeded: ${SUCCESS}${RESET}"
[[ "$FAILED" -gt 0 ]] && echo -e "  ${RED}Failed:    ${FAILED}${RESET}"
echo -e "  Total:     ${SERVER_COUNT}"

if [[ "$FAILED" -gt 0 ]]; then
  echo ""
  echo -e "${RED}Failed servers:${RESET}"
  grep "^FAIL" "$RESULTS_FILE" | while read -r _ name; do
    echo -e "  ${RED}✗ ${name}${RESET}"
  done
fi

rm -f "$RESULTS_FILE"

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
