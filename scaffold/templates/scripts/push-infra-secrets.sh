#!/bin/bash
# =============================================================================
# push-infra-secrets.sh — Push Infrastructure Secrets to GitHub
# =============================================================================
# Reads a declarative `infra-secrets.env` file (KEY=VALUE lines) and pushes
# each entry to GitHub Secrets via `gh secret set`. This covers the scalar /
# infrastructure secrets (SSH key, host addresses, jump host, deploy path,
# registry credentials) — as opposed to push-secrets.sh, which pushes the
# per-environment CONFIG FILES described in deploy-config.json.
#
# Two kinds of secrets, two scripts:
#   push-infra-secrets.sh  → scalar key=value secrets (this script)
#   push-secrets.sh        → config-file secrets (file contents per environment)
#
# Usage:
#   ./scripts/push-infra-secrets.sh [--dry-run] [--file <path>]
#
# Options:
#   --dry-run        Show what would be pushed without actually pushing
#   --file <path>    Override the secrets file (default: local_data/infra-secrets.env)
#   --help, -h       Show this help message
#
# File format (local_data/infra-secrets.env):
#   # Comments and blank lines are ignored
#   DEPLOY_PATH=/opt/deployments
#   PROD_HOST=10.0.3.10
#   SSH_PRIVATE_KEY=@deploy_key      # @ prefix = read value from a file path
#
# The `@path` convention reads the secret value from a file. This is intended
# for multiline values like SSH private keys, which must never be inlined.
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - Run from the project root (gh detects repo from git remote)
#   - local_data/infra-secrets.env exists (copy from the .example template)
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
DRY_RUN=false
SECRETS_FILE="local_data/infra-secrets.env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --file)
      SECRETS_FILE="${2:-}"
      if [[ -z "$SECRETS_FILE" ]]; then
        echo -e "${RED}Error: --file requires a path argument${RESET}" >&2
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--dry-run] [--file <path>]"
      echo ""
      echo "Push infrastructure secrets (KEY=VALUE) to GitHub Secrets."
      echo ""
      echo "Options:"
      echo "  --dry-run        Preview without pushing"
      echo "  --file <path>    Secrets file (default: local_data/infra-secrets.env)"
      echo "  --help, -h       Show this help"
      echo ""
      echo "File format:"
      echo "  DEPLOY_PATH=/opt/deployments"
      echo "  PROD_HOST=10.0.3.10"
      echo "  SSH_PRIVATE_KEY=@deploy_key   (@ prefix reads value from a file)"
      exit 0
      ;;
    -*)
      echo -e "${RED}Unknown option: $1${RESET}" >&2
      exit 1
      ;;
    *)
      echo -e "${RED}Unexpected argument: $1${RESET}" >&2
      exit 1
      ;;
  esac
done

# ── Preflight Checks ────────────────────────────────────────
echo -e "${CYAN}━━━ Push Infrastructure Secrets to GitHub ━━━${RESET}"
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

# Check secrets file
if [[ ! -f "$SECRETS_FILE" ]]; then
  echo -e "${RED}✗ ${SECRETS_FILE} not found${RESET}"
  echo "  Copy the template and fill it in:"
  echo "    cp local_data/infra-secrets.env.example local_data/infra-secrets.env"
  exit 1
fi

# Detect repo
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
if [[ -z "$REPO" ]]; then
  echo -e "${RED}✗ Could not detect GitHub repository${RESET}"
  exit 1
fi

echo -e "  Repository: ${GREEN}${REPO}${RESET}"
echo -e "  File:       ${GREEN}${SECRETS_FILE}${RESET}"
if $DRY_RUN; then
  echo -e "  Mode:       ${YELLOW}DRY RUN${RESET}"
else
  echo -e "  Mode:       ${CYAN}LIVE${RESET}"
fi
echo ""

# ── Drift check ──────────────────────────────────────────────
# Warn about ${VAR} placeholders referenced in deploy-inventory.json and
# deploy-config.json that are NOT present in the secrets file, so the operator
# notices missing infrastructure secrets before a deploy fails.
PROVIDED_KEYS=$(grep -vE '^[[:space:]]*(#|$)' "$SECRETS_FILE" | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\1/' | sort -u || true)

if command -v node &>/dev/null; then
  REFERENCED_KEYS=$(node -e "
    const fs = require('fs');
    const keys = new Set();
    for (const f of ['deploy-inventory.json', 'deploy-config.json']) {
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf-8');
      // Match braced placeholders like \${PROD_HOST}; skip the lowercase
      // \${env} and uppercase \${ENV} config templating tokens.
      const re = /\\\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const name = m[1];
        if (name === 'env' || name === 'ENV') continue;
        keys.add(name);
      }
    }
    console.log([...keys].sort().join(' '));
  " 2>/dev/null || true)

  if [[ -n "$REFERENCED_KEYS" ]]; then
    MISSING=""
    for key in $REFERENCED_KEYS; do
      if ! grep -qx "$key" <<< "$PROVIDED_KEYS"; then
        MISSING="${MISSING} ${key}"
      fi
    done
    if [[ -n "$MISSING" ]]; then
      echo -e "${YELLOW}⚠ Referenced in config but missing from ${SECRETS_FILE}:${RESET}"
      for key in $MISSING; do
        echo -e "    ${YELLOW}- ${key}${RESET}"
      done
      echo ""
    fi
  fi
fi

# ── Process each KEY=VALUE entry ─────────────────────────────
TOTAL_SUCCESS=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0

while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip blank lines and comments
  [[ -z "${line//[[:space:]]/}" ]] && continue
  [[ "${line#"${line%%[![:space:]]*}"}" == \#* ]] && continue

  # Split on the first '='
  if [[ "$line" != *"="* ]]; then
    echo -e "  ${YELLOW}⚠ skipping malformed line: ${line}${RESET}"
    continue
  fi
  key="${line%%=*}"
  value="${line#*=}"

  # Trim surrounding whitespace from key
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"

  # Trim leading whitespace from value (preserve internal content)
  value="${value#"${value%%[![:space:]]*}"}"

  if [[ -z "$key" ]]; then
    echo -e "  ${YELLOW}⚠ skipping line with empty key${RESET}"
    continue
  fi

  # Resolve @path values: read the secret from a file
  from_file=""
  if [[ "$value" == @* ]]; then
    from_file="${value#@}"
    if [[ ! -f "$from_file" ]]; then
      echo -e "  ${RED}✗ ${key}${RESET} — file not found: ${from_file}"
      TOTAL_FAILED=$((TOTAL_FAILED + 1))
      continue
    fi
  fi

  if [[ -z "$value" ]]; then
    echo -e "  ${DIM}○ ${key} — empty value, skipping${RESET}"
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + 1))
    continue
  fi

  if $DRY_RUN; then
    if [[ -n "$from_file" ]]; then
      echo -e "  ${CYAN}○ ${key}${RESET} — would push from file ${from_file}"
    else
      echo -e "  ${CYAN}○ ${key}${RESET} — would push (inline value)"
    fi
  else
    if [[ -n "$from_file" ]]; then
      if gh secret set "$key" < "$from_file" 2>/dev/null; then
        echo -e "  ${GREEN}✓ ${key}${RESET} — pushed from ${from_file}"
        TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
      else
        echo -e "  ${RED}✗ ${key}${RESET} — failed to push"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
      fi
    else
      if gh secret set "$key" --body "$value" 2>/dev/null; then
        echo -e "  ${GREEN}✓ ${key}${RESET} — pushed"
        TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
      else
        echo -e "  ${RED}✗ ${key}${RESET} — failed to push"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
      fi
    fi
  fi
done < "$SECRETS_FILE"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━ Summary ━━━${RESET}"
if $DRY_RUN; then
  echo -e "  ${YELLOW}Dry run — no secrets were modified${RESET}"
else
  echo -e "  ${GREEN}Pushed:  ${TOTAL_SUCCESS}${RESET}"
  [[ $TOTAL_SKIPPED -gt 0 ]] && echo -e "  ${DIM}Skipped: ${TOTAL_SKIPPED} (empty values)${RESET}"
  [[ $TOTAL_FAILED -gt 0 ]] && echo -e "  ${RED}Failed:  ${TOTAL_FAILED}${RESET}"
fi

# Show current secrets
echo ""
echo -e "${CYAN}━━━ Current repository secrets ━━━${RESET}"
gh secret list 2>/dev/null || echo -e "  ${DIM}(could not list secrets)${RESET}"

if [[ $TOTAL_FAILED -gt 0 ]]; then
  exit 1
fi
