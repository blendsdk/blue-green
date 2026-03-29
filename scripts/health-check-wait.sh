#!/bin/bash
# =============================================================================
# Health Check Wait Script
# =============================================================================
# Polls Docker Compose service health until all replicas are healthy.
# Used by switch-environment.sh to verify new replicas before switching traffic.
#
# Usage: ./scripts/health-check-wait.sh <service-name> [timeout-seconds] [poll-interval]
#
# Arguments:
#   service-name    Docker Compose service name (e.g., app_blue, app_green)
#   timeout-seconds Maximum seconds to wait (default: 120)
#   poll-interval   Seconds between polls (default: 2)
#
# Exit codes:
#   0 = All replicas healthy
#   1 = Timeout — not all replicas became healthy
# =============================================================================

set -eu

SERVICE="${1:?Usage: $0 <service-name> [timeout] [interval]}"
TIMEOUT="${2:-120}"
INTERVAL="${3:-2}"

ELAPSED=0

echo "Waiting for ${SERVICE} to be healthy (timeout: ${TIMEOUT}s)..."

while [[ "$ELAPSED" -lt "$TIMEOUT" ]]; do
    # Count total and healthy containers for this service
    TOTAL=$(docker compose ps --format json "${SERVICE}" 2>/dev/null | wc -l)
    HEALTHY=$(docker compose ps --format json "${SERVICE}" 2>/dev/null | grep -c '"healthy"' || true)

    if [[ "$TOTAL" -gt 0 && "$TOTAL" -eq "$HEALTHY" ]]; then
        echo "All ${TOTAL} replicas of ${SERVICE} are healthy (${ELAPSED}s elapsed)."
        exit 0
    fi

    echo "  ${HEALTHY}/${TOTAL} healthy (${ELAPSED}s elapsed)..."
    sleep "${INTERVAL}"
    ELAPSED=$((ELAPSED + INTERVAL))
done

echo "Timeout: Only ${HEALTHY:-0}/${TOTAL:-0} replicas of ${SERVICE} became healthy after ${TIMEOUT}s." >&2

# Print container logs for debugging
echo "--- Last 20 lines of ${SERVICE} logs ---" >&2
docker compose logs "${SERVICE}" --tail=20 2>&1 >&2 || true

exit 1
