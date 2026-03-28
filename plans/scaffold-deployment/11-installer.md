# Installer

> **Document**: 11-installer.md
> **Parent**: [Index](00-index.md)

## Overview

`install.sh` — thin bash wrapper at repo root. Entry point for `curl -fsSL .../install.sh | bash`.

## Usage

```bash
# Interactive:
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/master/install.sh | bash

# With flags (non-interactive):
curl -fsSL .../install.sh | bash -s -- --name myapp --port 8080

# Pinned version:
curl -fsSL https://raw.githubusercontent.com/blendsdk/blue-green/v1.0.0/install.sh | bash
```

## Flow

1. Check Node.js is available (required for BlendSDK apps)
2. Determine version (from `BG_VERSION` env var or default to `master`)
3. Download repo tarball from GitHub archive API
4. Extract to temp directory
5. Run `node scaffold/scaffold.js` (passing through all flags)
6. Cleanup temp directory

## Key Features

- **No git dependency** — uses GitHub's tarball API
- **Version pinning** — `BG_VERSION=v1.0.0` or `--version v1.0.0`
- **Passes all flags through** to scaffold.js
- **~30 lines of bash** — all logic is in scaffold.js
