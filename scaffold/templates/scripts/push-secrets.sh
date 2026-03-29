#!/bin/bash
# =============================================================================
# push-secrets.sh — Push Local Config Files to GitHub Secrets
# =============================================================================
# Reads deploy-config.json and pushes local config files to GitHub Secrets.
# Each config entry's local file is base64-encoded and stored as a secret,
# keyed by environment prefix (TEST_, ACC_, PROD_).
#
# Usage:
#   ./scripts/push-secrets.sh <environment> [--dry-run] [--all]
#
# Arguments:
#   environment  - Target environment (test, acceptance, production)
#   --dry-run    - Show what would be pushed without actually pushing
#   --all        - Push all environments at once
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - Run from the project root (gh detects repo from git remote)
#   - deploy-config.json exists in project root
#   - Local config files exist in local_data/<env>/
#
# Examples:
#   ./scripts/push-secrets.sh test
#   ./scripts/push-secrets.sh production --dry-run
#   ./scripts/push-secrets.sh --all
# =============================================================================

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

# ── Arguments ────────────────────────────────────────────────
ENVIRONMENT=""
DRY_RUN=false
ALL_ENVS=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --all)     ALL_ENVS=true ;;
    --help|-h)
      echo "Usage: $0 <environment> [--dry-run] [--all]"
      echo ""
      echo "Push local config files to GitHub Secrets based on deploy-config.json."
      echo ""
      echo "Arguments:"
      echo "  environment  Target: test, acceptance, production"
      echo "  --dry-run    Preview without pushing"
      echo "  --all        Push all environments"
      echo ""
      echo "Examples:"
      echo "  $0 test"
      echo "  $0 production --dry-run"
      echo "  $0 --all"
      exit 0
      ;;
    -*)
      echo -e "${RED}Unknown option: ${arg}${RESET}" >&2
      exit 1
      ;;
    *)
      ENVIRONMENT="$arg"
      ;;
  esac
done

if [[ "$ALL_ENVS" == "false" && -z "$ENVIRONMENT" ]]; then
  echo -e "${RED}Error: Environment required. Usage: $0 <environment> [--dry-run]${RESET}" >&2
  exit 1
fi

# ── Preflight Checks ────────────────────────────────────────
echo -e "${CYAN}━━━ Push Secrets to GitHub ━━━${RESET}"
echo ""

# Check gh CLI
if ! command -v gh &>/dev/null; then
  echo -e "${RED}✗ gh CLI is not installed${RESET}"
  echo "  Install: https://cli.github.com/"
  exit 1
fi

# Check gh auth
if ! gh auth status &>/dev/null 2>&1; then
  echo -e "${RED}✗ gh CLI is not authenticated${RESET}"
  echo "  Run: gh auth login"
  exit 1
fi

# Check git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  echo -e "${RED}✗ Not inside a git repository${RESET}"
  exit 1
fi

# Check Node.js (needed for JSON parsing)
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js is not installed (needed for JSON parsing)${RESET}"
  exit 1
fi

# Check manifest
MANIFEST="deploy-config.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo -e "${RED}✗ ${MANIFEST} not found${RESET}"
  echo "  Run from the project root directory."
  exit 1
fi

# Detect repo
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
if [[ -z "$REPO" ]]; then
  echo -e "${RED}✗ Could not detect GitHub repository${RESET}"
  exit 1
fi

echo -e "  Repository: ${GREEN}${REPO}${RESET}"
echo -e "  Manifest:   ${GREEN}${MANIFEST}${RESET}"
if $DRY_RUN; then
  echo -e "  Mode:       ${YELLOW}DRY RUN${RESET}"
else
  echo -e "  Mode:       ${CYAN}LIVE${RESET}"
fi
echo ""

# ── Determine environments to process ────────────────────────
if [[ "$ALL_ENVS" == "true" ]]; then
  # Extract all environment names from the manifest using Node.js
  ENVS=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('${MANIFEST}', 'utf-8'));
    console.log(Object.keys(m.environments).join(' '));
  ")
else
  ENVS="$ENVIRONMENT"
fi

# ── Process each environment ─────────────────────────────────
TOTAL_SUCCESS=0
TOTAL_FAILED=0

for env in $ENVS; do
  echo -e "${CYAN}━━━ Environment: ${env} ━━━${RESET}"

  # Resolve config entries for this environment using Node.js
  # Output: secret_key\tlocal_file\tname (modified for push-secrets)
  ENTRIES=$(node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('${MANIFEST}', 'utf-8'));
    const entry = m.environments['${env}'];
    if (!entry) { console.error('Unknown env: ${env}'); process.exit(1); }
    const prefix = typeof entry === 'string' ? entry : entry.prefix;
    for (const c of m.configs) {
      const key = c.secret_key.replace('{ENV}', prefix);
      const file = c.local_file.replace('{env}', '${env}');
      console.log(key + '\t' + file + '\t' + c.name);
    }
  " 2>/dev/null) || {
    echo -e "  ${RED}✗ Failed to resolve config for: ${env}${RESET}"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
    continue
  }

  while IFS=$'\t' read -r secret_key local_file name; do
    # Check if local file exists
    if [[ ! -f "$local_file" ]]; then
      echo -e "  ${YELLOW}⚠ ${name}${RESET} — file not found: ${local_file}"
      TOTAL_FAILED=$((TOTAL_FAILED + 1))
      continue
    fi

    FILE_SIZE=$(wc -c < "$local_file" | tr -d ' ')

    if $DRY_RUN; then
      echo -e "  ${CYAN}○ ${secret_key}${RESET} — would push ${local_file} (${FILE_SIZE} bytes)"
    else
      if gh secret set "$secret_key" < "$local_file" 2>/dev/null; then
        echo -e "  ${GREEN}✓ ${secret_key}${RESET} — pushed (${FILE_SIZE} bytes)"
        TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
      else
        echo -e "  ${RED}✗ ${secret_key}${RESET} — failed to push"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
      fi
    fi
  done <<< "$ENTRIES"

  echo ""
done

# ── Summary ──────────────────────────────────────────────────
echo -e "${CYAN}━━━ Summary ━━━${RESET}"
if $DRY_RUN; then
  echo -e "  ${YELLOW}Dry run — no secrets were modified${RESET}"
else
  echo -e "  ${GREEN}Pushed:  ${TOTAL_SUCCESS}${RESET}"
  [[ $TOTAL_FAILED -gt 0 ]] && echo -e "  ${RED}Failed:  ${TOTAL_FAILED}${RESET}"
fi

# Show current secrets
echo ""
echo -e "${CYAN}━━━ Current repository secrets ━━━${RESET}"
gh secret list 2>/dev/null || echo -e "  ${DIM}(could not list secrets)${RESET}"

if [[ $TOTAL_FAILED -gt 0 ]]; then
  exit 1
fi
