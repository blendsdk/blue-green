# Current State Analysis & Gap Report

> **Document**: 02-current-state.md
> **Last Updated**: 2026-02-15

## 1. Current File Structure

```
blue-green/
├── .env                              # Environment configuration
├── docker-compose.yml                # Service definitions
├── app/
│   ├── Dockerfile                    # ❌ BROKEN — references non-existent file
│   ├── healthcheck.sh                # ✅ Works (#!/bin/sh, Alpine-compatible)
│   ├── package.json                  # ✅ Express 5.1.0
│   ├── server.js                     # ⚠️ PORT hardcoded, no graceful shutdown
│   └── start.sh                      # ⚠️ Missing set -e, no trailing newline
├── data/
│   └── postgresql/.gitkeep           # ✅ PostgreSQL data directory
├── nginx/
│   ├── nginx.conf                    # ⚠️ Several issues (see below)
│   ├── conf.d/
│   │   ├── server-name.conf          # ✅ server_name _;
│   │   ├── server-ssl.conf           # ⚠️ Hardcoded example.com
│   │   └── server.ssl.conf           # ❌ DUPLICATE of server-ssl.conf
│   ├── includes/
│   │   ├── error_pages.conf          # ✅ JSON error pages
│   │   ├── file_cache.conf           # ✅ Open file cache
│   │   ├── proxy_headers.conf        # ✅ Standard proxy headers
│   │   ├── proxy_params.conf         # ✅ Proxy parameters
│   │   ├── proxy_timeouts.conf       # ✅ Standard timeouts
│   │   ├── proxy_timeouts_health.conf # ✅ Fast health check timeouts
│   │   ├── security_headers_enhanced.conf # ⚠️ CSP too permissive for API
│   │   └── ssl.conf                  # ✅ Strong SSL config
│   ├── locations/
│   │   ├── 10-health.conf            # ⚠️ Missing proxy_params.conf include
│   │   ├── 20-ping.conf              # ✅ Correct
│   │   ├── 30-nginx-status.conf      # ✅ Restricted to internal networks
│   │   └── 99-default.conf           # ✅ Catch-all with error handling
│   └── upstreams/
│       └── bluegreen-upstream.conf   # ⚠️ Hardcoded to app_green, no switching
├── scripts/
│   └── agent.sh                      # ✅ VS Code settings management (unrelated)
└── certbot/                          # Empty — not yet configured
```

---

## 2. Critical Bugs (Build-Breaking)

### Bug 1: Dockerfile references non-existent file
**File:** `app/Dockerfile`
```dockerfile
COPY start-application.sh .    # ← File doesn't exist! Actual file is start.sh
```
**Impact:** `docker compose build` fails immediately.

### Bug 2: Dockerfile COPY/CMD inconsistency
**File:** `app/Dockerfile`
```dockerfile
COPY start-application.sh .    # ← COPYs wrong name
CMD ["./start.sh"]             # ← Runs correct name (but file wasn't copied)
```
**Fix:** Change COPY to `COPY start.sh .`

### Bug 3: Missing chmod +x for scripts
**File:** `app/Dockerfile`
Scripts `healthcheck.sh` and `start.sh` are copied but never made executable.
```dockerfile
# Missing: RUN chmod +x healthcheck.sh start.sh
```
**Impact:** HEALTHCHECK and CMD will fail with "permission denied".

### Bug 4: Duplicate SSL config file
**Files:** `nginx/conf.d/server-ssl.conf` AND `nginx/conf.d/server.ssl.conf`
Identical content, different names (dash vs dot). Only `server-ssl.conf` is included. `server.ssl.conf` is dead code.

---

## 3. Significant Issues

### Issue 1: YAML anchor environment list replacement
**File:** `docker-compose.yml`
```yaml
x-app-base: &app-base
  environment:
    - PORT=3000         # ← This gets REPLACED, not merged

services:
  app_blue:
    <<: *app-base
    environment:
      - APP_ENV=blue    # ← Replaces entire environment list; PORT=3000 is lost
```
**Impact:** `PORT=3000` is never set. Works by accident because `server.js` hardcodes port 3000.

### Issue 2: No replica support
`.env` defines `APP_REPLICAS=5` but Docker Compose doesn't use `deploy.replicas`. Each color runs as a single container.

### Issue 3: Redis has no health check
Violates coding standard Rule 6 (all stateful services must have health checks).

### Issue 4: Nginx has no health check
Same violation as above.

### Issue 5: No `depends_on` for service ordering
Nginx starts before app is healthy. No startup dependency chain defined.

### Issue 6: Unused `postgres_data` named volume
Bottom of `docker-compose.yml` defines a named volume that's never used (PostgreSQL uses a bind mount).

### Issue 7: `data/config` volume mount doesn't exist
```yaml
volumes:
  - ./data/config:/app/config    # ← data/config/ directory doesn't exist
```

### Issue 8: No network isolation
All services share the default network. Nginx can directly access PostgreSQL.

---

## 4. Nginx Issues

### Nginx Issue 1: Hardcoded upstream (no switching)
`nginx/upstreams/bluegreen-upstream.conf` hardcodes `app_green:3000`. No mechanism to switch between blue and green.

### Nginx Issue 2: Only internet-facing mode
Current config assumes SSL termination, HTTPS redirect, certbot. No internal (behind proxy) mode.

### Nginx Issue 3: `$loggable` map defined but unused
The map variable `$loggable` is defined to suppress health check logging but never used in the `access_log` directive.

### Nginx Issue 4: `proxy_params.conf` not included in health location
`10-health.conf` doesn't include `proxy_params.conf`, so `proxy_http_version 1.1` isn't set for health checks (needed for keepalive).

### Nginx Issue 5: Security headers stripped in location blocks
Location blocks with `add_header` directives (like `10-health.conf` with Cache-Control) clear server-level headers. Security headers from `security_headers_enhanced.conf` don't get sent for proxied health/ping responses.

### Nginx Issue 6: CSP too permissive
`unsafe-inline` and `unsafe-eval` in Content-Security-Policy is unnecessary for a JSON API template.

### Nginx Issue 7: Dual resolver without documentation
Docker resolver (`127.0.0.11`) at http level and Google resolver (`8.8.8.8`) in `ssl.conf` — confusing without comments.

### Nginx Issue 8: HTTP block doesn't serve health checks
The HTTP server block redirects everything to HTTPS (except ACME challenges). Infrastructure health checks that can't follow redirects get a 301 instead of 200.

### Nginx Issue 9: SSL cert paths hardcoded to `example.com`
`server-ssl.conf` hardcodes `/etc/letsencrypt/live/example.com/`. Should be parameterized via `.env`.

---

## 5. Application Issues

### App Issue 1: PORT hardcoded
```javascript
const PORT = 3000;    // Should be: process.env.PORT || 3000
```

### App Issue 2: No graceful shutdown
No `SIGTERM`/`SIGINT` handler. Connections dropped when Docker stops the container.

### App Issue 3: `start.sh` missing error handling
```bash
#!/bin/bash
yarn start    # No set -e, no trailing newline
```

---

## 6. Missing Functionality

| Feature | Status |
|---------|--------|
| Blue-green switching script | ❌ Not implemented |
| Multi-replica support | ❌ Not implemented |
| Internal (behind proxy) Nginx mode | ❌ Not implemented |
| Certbot integration | ❌ Commented out |
| Self-signed SSL for development | ❌ Not implemented |
| `.gitignore` | ❌ Missing |
| `README.md` | ❌ Missing |
| Docker network isolation | ❌ Not implemented |

---

## 7. What Works Well

| Component | Assessment |
|-----------|------------|
| Modular Nginx structure | ✅ Excellent — `includes/`, `locations/`, `upstreams/` pattern |
| SSL configuration | ✅ Strong — TLS 1.2+, good ciphers, OCSP stapling |
| Security headers | ✅ Comprehensive (just needs CSP tightening) |
| Error pages | ✅ JSON format, proper status codes |
| Rate limiting zones | ✅ Well-defined (health vs API limits) |
| PostgreSQL health check | ✅ Correct `pg_isready` pattern |
| Docker Compose YAML anchors | ✅ Good DRY pattern (just needs environment fix) |
| Location file numbering | ✅ Clear ordering (10-, 20-, 30-, 99-) |

---

## Cross-References

- **[01-requirements.md](./01-requirements.md)** — What we need to implement
- **[99-execution-plan.md](./99-execution-plan.md)** — How we'll fix everything
