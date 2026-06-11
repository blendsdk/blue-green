#!/bin/bash
# =============================================================================
# verify-scaffold-output.sh
# =============================================================================
# Validates the scaffold generator output for the inventory-env-substitution
# feature. Generates a project into a throwaway temp directory (single topology)
# and asserts:
#   1. deploy-inventory.json is generated for single topology (FR-6)
#   2. The single inventory uses ${VAR} hosts (FR-7)
#   3. deploy-config.json uses the new ${ENV}/${env} syntax (FR-9)
#   4. No old {ENV}/{env} bare syntax remains in generated config/inventory
#   5. The release workflow project-name carries the deploy target (FR-8)
#
# Usage: bash scripts/verify-scaffold-output.sh
# =============================================================================

set -euo pipefail

# Resolve repo root from this script's location so the script is runnable
# from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCAFFOLD_JS="$REPO_ROOT/scaffold/scaffold.js"

# Create an isolated temp dir and ensure it is removed on exit.
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

FAILURES=0

# Assert a file exists.
assert_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    echo "  ✅ exists: ${file#"$TMP_DIR/"}"
  else
    echo "  ❌ MISSING: ${file#"$TMP_DIR/"}"
    FAILURES=$((FAILURES + 1))
  fi
}

# Assert a file contains a fixed string.
assert_contains() {
  local file="$1" needle="$2"
  if grep -qF "$needle" "$file"; then
    echo "  ✅ contains '$needle': ${file#"$TMP_DIR/"}"
  else
    echo "  ❌ MISSING '$needle' in: ${file#"$TMP_DIR/"}"
    FAILURES=$((FAILURES + 1))
  fi
}

# Assert a file does NOT match a regex (used to catch old {ENV}/{env} syntax).
assert_not_matches() {
  local file="$1" pattern="$2"
  if grep -Eq "$pattern" "$file"; then
    echo "  ❌ should NOT match '$pattern' in: ${file#"$TMP_DIR/"}"
    FAILURES=$((FAILURES + 1))
  else
    echo "  ✅ no match for '$pattern': ${file#"$TMP_DIR/"}"
  fi
}

echo "── Generating single-topology scaffold into temp dir ──"
# Run the generator non-interactively from inside the temp dir so cwd-relative
# writes land there.
( cd "$TMP_DIR" && node "$SCAFFOLD_JS" --name verifyapp --single --no-postgres --no-redis >/dev/null )

echo ""
echo "── Asserting generated files ──"
CONFIG="$TMP_DIR/deploy-config.json"
INVENTORY="$TMP_DIR/deploy-inventory.json"
RELEASE="$TMP_DIR/.github/workflows/release.yml"

# 1. Inventory is generated even for single topology (FR-6).
assert_file "$INVENTORY"

# 2. Single inventory uses ${VAR} hosts (FR-7).
assert_contains "$INVENTORY" 'deploy@${TEST_HOST}'
assert_contains "$INVENTORY" 'deploy@${ACC_HOST}'
assert_contains "$INVENTORY" 'deploy@${PROD_HOST}'

# 3. Config uses new ${ENV}/${env} syntax (FR-9).
assert_file "$CONFIG"
assert_contains "$CONFIG" '${ENV}_ENV_FILE'
assert_contains "$CONFIG" 'local_data/${env}/.env'

# 4. No old bare {ENV}/{env} syntax remains (a brace NOT preceded by $).
#    [^$]\{ENV\} catches "{ENV}" but not "${ENV}".
assert_not_matches "$CONFIG" '[^$]\{ENV\}'
assert_not_matches "$CONFIG" '[^$]\{env\}'

# 5. Release workflow project-name carries the deploy target (FR-8).
assert_file "$RELEASE"
assert_contains "$RELEASE" 'verifyapp-${{ inputs.deploy_target }}'

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo "✅ verify-scaffold-output: all assertions passed"
  exit 0
else
  echo "❌ verify-scaffold-output: $FAILURES assertion(s) failed"
  exit 1
fi
