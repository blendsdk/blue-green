#!/bin/bash
set -e

# =============================================================================
# {{PROJECT_NAME}} — Deployment Package Builder
# =============================================================================
# Builds a deployment tarball from a BlendSDK monorepo and optionally deploys
# it to a remote server. The tarball contains pre-built packages and manifests
# needed by the production Docker container.
#
# Usage:
#   ./deploy-package.sh                                    # Build locally only
#   ./deploy-package.sh user@server                        # Build + deploy
#   ./deploy-package.sh user@server user@jump-host         # Deploy via jump host
#
# Environment Variables:
#   DEPLOYMENT_DIR    Local build directory (default: ./build/deployment)
#   DEPLOY_PATH       Remote deployment path (default: /opt/{{PROJECT_NAME}})
#
# Steps:
#   1. Pack all packages from ./packages/ into .tgz files
#   2. Create a deployment package.json with resolutions
#   3. Copy optional resources (database, static files)
#   4. Install dependencies into deployment/
#   5. Create versioned tarball (deployment-X.Y.Z.tgz)
#   6. Optionally deploy to remote server with symlink
# =============================================================================

echo "Building Deployment Package"

# ── Configuration ────────────────────────────────────────────
APP_NAME="{{PROJECT_NAME}}"

# TODO: Uncomment if your app has database resources to include
# COPY_DATABASE_RESOURCES=true

# TODO: Uncomment if your app has static files or other resources
# COPY_STATIC_FILES=true

# TODO: Define custom resource copy function if needed
# copy_extra_resources() {
#   echo "Copying extra resources..."
#   # Example: cp -r ./resources/templates ${DEPLOYMENT_DIR}/resources/
#   # Example: cp -r ./resources/static ${DEPLOYMENT_DIR}/resources/
# }

# ── Arguments ────────────────────────────────────────────────
REMOTE_HOST=$1
JUMP_HOST=${2:-$JUMP_HOST}
REMOTE_PATH="${DEPLOY_PATH:-/opt/${APP_NAME}}"

# ── SSH Options ──────────────────────────────────────────────
# Disable strict host key checking for CI/CD environments.
# When using a jump host, ProxyCommand applies the same settings to both hops.
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
SCP_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
if [ -n "$JUMP_HOST" ]; then
  PROXY_CMD="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -W %h:%p ${JUMP_HOST}"
  SSH_OPTS+=(-o "ProxyCommand=${PROXY_CMD}")
  SCP_OPTS+=(-o "ProxyCommand=${PROXY_CMD}")
  echo "Using jump host: ${JUMP_HOST}"
fi

# ── Local Build Directory ────────────────────────────────────
# Use a dedicated, git-ignored staging dir so the build never clobbers the
# source ./deployment/ folder (scripts/deploy-cli.js, Dockerfile, nginx/),
# which later workflow steps (upload, deploy-config, deploy) depend on.
DEPLOYMENT_DIR="${DEPLOYMENT_DIR:-./build/deployment}"

# Cleanup previous build artifacts
rm -rf "${DEPLOYMENT_DIR}"
mkdir -p "${DEPLOYMENT_DIR}/packages"
rm -f ./*.tgz

# ── Validate Prerequisites ───────────────────────────────────
if [ ! -d "./packages" ]; then
  echo "Error: ./packages directory not found"
  exit 1
fi

# Extract version from root package.json
VERSION=$(node -p "require('./package.json').version")
if [ -z "$VERSION" ]; then
  echo "Error: Failed to extract version from package.json"
  exit 1
fi

echo "Building version: ${VERSION}"
DEPLOYMENT_FILE="./deployment-${VERSION}.tgz"

# ── Create Deployment package.json ───────────────────────────
PACKAGE_TEMPLATE='{
  "name": "'"${APP_NAME}"'-deployment",
  "version": "'"${VERSION}"'",
  "private": true,
  "scripts": {},
  "dependencies": {}
}'

echo "$PACKAGE_TEMPLATE" > "${DEPLOYMENT_DIR}/package.json"

# ── Pack Monorepo Packages ───────────────────────────────────
for package_dir in ./packages/*/; do
  if [ -d "$package_dir" ]; then
    package_name=$(basename "$package_dir")
    echo "Packing ${package_name}..."
    (cd "$package_dir" && yarn pack --prod --filename "../../${DEPLOYMENT_DIR}/packages/${package_name}.tgz")
  fi
done

# ── Add Resolutions for Local Packages ───────────────────────
# Ensures yarn resolves monorepo packages from local .tgz files
# instead of trying to find them on the npm registry
echo "Adding resolutions for local packages..."
RESOLUTIONS="{}"
for package_dir in ./packages/*/; do
  if [ -d "$package_dir" ] && [ -f "$package_dir/package.json" ]; then
    pkg_name=$(node -p "require('$package_dir/package.json').name")
    tgz_name=$(basename "$package_dir")
    RESOLUTIONS=$(echo "$RESOLUTIONS" | node -e "
      const fs = require('fs');
      const input = fs.readFileSync('/dev/stdin', 'utf8');
      const obj = JSON.parse(input);
      obj['$pkg_name'] = 'file:packages/${tgz_name}.tgz';
      console.log(JSON.stringify(obj));
    ")
  fi
done

# Merge resolutions into the deployment package.json
node -e "
  const fs = require('fs');
  const pkgPath = '${DEPLOYMENT_DIR}/package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.resolutions = JSON.parse('$RESOLUTIONS');
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
"
echo "✅ Resolutions added to deployment package.json"

# ── Copy Optional Resources ──────────────────────────────────

# TODO: Uncomment to copy database resources (schema, functions, migrations)
# if [ "${COPY_DATABASE_RESOURCES:-false}" = "true" ] && [ -d "./resources/database" ]; then
#   echo "Copying database resources..."
#   mkdir -p "${DEPLOYMENT_DIR}/resources/database"
#   cp -r ./resources/database/schema "${DEPLOYMENT_DIR}/resources/database/" 2>/dev/null || true
#   cp -r ./resources/database/functions "${DEPLOYMENT_DIR}/resources/database/" 2>/dev/null || true
#   cp -r ./resources/database/migrations "${DEPLOYMENT_DIR}/resources/database/" 2>/dev/null || true
#   echo "✅ Database resources copied"
# fi

# TODO: Uncomment to copy static files
# if [ "${COPY_STATIC_FILES:-false}" = "true" ] && [ -d "./resources/static" ]; then
#   echo "Copying static files..."
#   mkdir -p "${DEPLOYMENT_DIR}/resources/static"
#   cp -r ./resources/static/* "${DEPLOYMENT_DIR}/resources/static/"
#   echo "✅ Static files copied"
# fi

# TODO: Uncomment to run custom resource copy function
# if type copy_extra_resources &>/dev/null; then
#   copy_extra_resources
# fi

# ── Install Dependencies ─────────────────────────────────────
echo "Installing packages..."
PACKAGE_FILES=()
for package_file in "${DEPLOYMENT_DIR}"/packages/*.tgz; do
  if [ -f "$package_file" ]; then
    PACKAGE_FILES+=("file:${package_file#${DEPLOYMENT_DIR}/}")
  fi
done

if [ ${#PACKAGE_FILES[@]} -eq 0 ]; then
  echo "Error: No packages found to install"
  exit 1
fi

(cd "${DEPLOYMENT_DIR}" && yarn add "${PACKAGE_FILES[@]}")

# ── Create Tarball ───────────────────────────────────────────
echo "Creating ${DEPLOYMENT_FILE}..."
tar -czf "${DEPLOYMENT_FILE}" --exclude='node_modules' -C "${DEPLOYMENT_DIR}" .

if [ ! -f "${DEPLOYMENT_FILE}" ]; then
  echo "Error: Failed to create ${DEPLOYMENT_FILE}"
  exit 1
fi

echo "✅ Build completed successfully!"
echo "✅ Deployment package: ${DEPLOYMENT_FILE}"
ls -lh "${DEPLOYMENT_FILE}"

# ── Optional: Deploy to Remote Server ────────────────────────
if [ -n "$REMOTE_HOST" ]; then
  echo ""
  echo "Deploying to ${REMOTE_HOST}..."

  # Create remote directory
  echo "Creating remote directory: ${REMOTE_PATH}"
  ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "mkdir -p ${REMOTE_PATH}"

  # Copy deployment package
  echo "Copying ${DEPLOYMENT_FILE} to remote server..."
  scp "${SCP_OPTS[@]}" "${DEPLOYMENT_FILE}" "${REMOTE_HOST}:${REMOTE_PATH}/"

  # Create/update symlink so deployment-latest.tgz always points to newest
  echo "Creating symlink deployment-latest.tgz..."
  ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "cd ${REMOTE_PATH} && ln -sf $(basename "${DEPLOYMENT_FILE}") deployment-latest.tgz"

  echo ""
  echo "✅ Deployed successfully!"
  echo "✅ Remote: ${REMOTE_HOST}:${REMOTE_PATH}/deployment-latest.tgz"
fi
