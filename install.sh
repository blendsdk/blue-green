#!/bin/bash
# =============================================================================
# Blue-Green Deployment Scaffold — Installer
# =============================================================================
# Thin bash wrapper that downloads the scaffold repo and runs scaffold.js.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --name myapp --port 8080
#   BG_VERSION=v1.0.0 curl -fsSL .../install.sh | bash
# =============================================================================
set -e

# --- Configuration ---
REPO="blendsdk/blue-green"
VERSION="${BG_VERSION:-master}"
ARCHIVE_URL="https://github.com/${REPO}/archive/refs/heads/${VERSION}.tar.gz"

# If version looks like a tag (v*), use tags endpoint
if [[ "$VERSION" == v* ]]; then
  ARCHIVE_URL="https://github.com/${REPO}/archive/refs/tags/${VERSION}.tar.gz"
fi

# --- Preflight checks ---
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is required but not found. Install it first:" >&2
  echo "   https://nodejs.org/" >&2
  exit 1
fi

if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
  echo "❌ curl or wget is required but neither was found." >&2
  exit 1
fi

# --- Download and extract ---
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "📥 Downloading blue-green scaffold (${VERSION})..."

if command -v curl &>/dev/null; then
  curl -fsSL "$ARCHIVE_URL" -o "$TMPDIR/scaffold.tar.gz"
else
  wget -q "$ARCHIVE_URL" -O "$TMPDIR/scaffold.tar.gz"
fi

# Extract — GitHub archives contain a single top-level directory
tar -xzf "$TMPDIR/scaffold.tar.gz" -C "$TMPDIR"

# Find the extracted directory (e.g., blue-green-master/)
SCAFFOLD_DIR=$(find "$TMPDIR" -maxdepth 1 -type d -name "blue-green-*" | head -1)

if [ -z "$SCAFFOLD_DIR" ] || [ ! -f "$SCAFFOLD_DIR/scaffold/scaffold.js" ]; then
  echo "❌ Failed to extract scaffold. Archive may be corrupted." >&2
  exit 1
fi

# --- Run scaffold generator ---
echo "🚀 Running scaffold generator..."
echo ""

node "$SCAFFOLD_DIR/scaffold/scaffold.js" "$@" < /dev/tty
