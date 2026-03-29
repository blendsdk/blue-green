# Deploy CLI Architecture

> **Document**: 03-deploy-cli-architecture.md
> **Parent**: [Index](00-index.md)

## Overview

The Deploy CLI is a TypeScript application compiled to a single JavaScript file via esbuild. It runs on the CI server (GitHub Actions self-hosted runner) and orchestrates deployments across one or more remote servers via SSH.

It replaces four separate scripts (`deploy-config-files.sh`, `multi-deploy.sh`, `resolve-config.js`, `resolve-servers.js`) and ~200 lines of inline bash in workflow YAML with a single, typed, testable tool.

## Architecture

### Design Principles

1. **Zero runtime dependencies** — only Node.js built-in modules (`child_process`, `fs`, `path`, `os`)
2. **CLI orchestrates, bash executes** — CLI handles coordination, SSH, config; `remote-ops.sh` handles Docker/Nginx
3. **Single bundled file** — esbuild produces one `deploy-cli.js` that runs anywhere Node.js 18+ exists
4. **Configuration-driven** — reads `deploy-config.json` and `deploy-inventory.json` for all environment-specific logic
5. **Deployment strategy agnostic** — same CLI commands work for both in-place and registry deployment

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  deploy-cli.js                                                │
│                                                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐              │
│  │  Commands   │  │    Lib     │  │   Types    │              │
│  │             │  │            │  │            │              │
│  │ prepare     │  │ ssh        │  │ Config     │              │
│  │ switch      │  │ config     │  │ Inventory  │              │
│  │ deploy      │  │ inventory  │  │ Server     │              │
│  │ upload      │  │ logger     │  │ Options    │              │
│  │ deploy-cfg  │  │ process    │  │ Result     │              │
│  │ operate     │  │            │  │            │              │
│  │ registry    │  │            │  │            │              │
│  └────────────┘  └────────────┘  └────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

## TypeScript Project Structure

```
src/deploy-cli/
├── index.ts                    # Entry point — argument parser + command dispatcher
├── types.ts                    # Shared interfaces and types
├── commands/
│   ├── prepare.ts              # blue-green-prepare on all servers
│   ├── switch.ts               # blue-green-switch on all servers
│   ├── deploy.ts               # Full deploy (prepare → switch, coordinated)
│   ├── upload.ts               # Upload tarball + scripts + configs to servers
│   ├── deploy-config.ts        # Deploy config files from secrets to servers
│   ├── operate.ts              # Run remote-ops.sh operations (restart, health, etc.)
│   └── registry.ts             # Build + push image to registry (CI-side)
└── lib/
    ├── ssh.ts                  # SSH/SCP operations via child_process
    ├── config.ts               # deploy-config.json reader + resolver
    ├── inventory.ts            # deploy-inventory.json reader + server resolver
    ├── logger.ts               # Structured output (progress, success, error)
    └── process.ts              # child_process helpers (spawn, exec with timeout)
```

### Build Output

```
scaffold/templates/deployment/scripts/deploy-cli.js   # ~50-100KB bundled file
```

### Build Configuration

```
tsconfig.json                   # TypeScript config (strict, ESNext target)
package.json                    # esbuild dev dependency + build scripts
```

## Type Definitions (`types.ts`)

```typescript
// ── Configuration Types ─────────────────────────────────

/** deploy-config.json structure */
export interface DeployConfig {
  configs: ConfigEntry[];
  environments: Record<string, EnvironmentConfig>;
}

export interface ConfigEntry {
  name: string;
  secret_key: string;        // Pattern: "{ENV}_KEY_NAME"
  local_file: string;        // Local path pattern: "local_data/{env}/.env"
  deploy_path: string;       // Remote relative path: ".env"
}

export interface EnvironmentConfig {
  prefix: string;            // "TEST", "ACC", "PROD"
  env_defaults: Record<string, string>;
}

// ── Inventory Types ─────────────────────────────────────

/** deploy-inventory.json structure */
export interface DeployInventory {
  ssh_key_secret: string;
  environments: Record<string, EnvironmentInventory>;
}

export interface EnvironmentInventory {
  access: 'direct' | 'jump_host' | 'deploy_server';
  jump_host_secret?: string;
  deploy_server_secret?: string;
  servers: ServerEntry[];
}

export interface ServerEntry {
  name: string;
  host: string;              // "deploy@10.0.0.3"
  group: string;
  tags?: string[];
}

// ── Deployment Types ────────────────────────────────────

export type DeployStrategy = 'in-place' | 'registry';

export interface DeployOptions {
  environment: string;       // "test", "acceptance", "production"
  scope: 'all' | 'group' | 'tag' | 'server';
  filter?: string;           // Group name, tag, or server name
  strategy: DeployStrategy;
  maxParallel: number;
  dryRun: boolean;
  deployPath: string;        // Remote base path
  projectName: string;       // For COMPOSE_PROJECT_NAME
}

export interface RegistryOptions {
  registryUrl: string;       // "registry.internal:5000"
  imageName: string;         // "scaffoldapp"
  imageTag: string;          // "20260329220000"
}

// ── SSH Types ───────────────────────────────────────────

export interface SSHConfig {
  configPath: string;        // Path to generated SSH config file
  keyPath?: string;          // Path to written SSH key file
}

export interface SSHOptions {
  privateKey?: string;       // SSH key content (from env var)
  jumpHost?: string;         // Jump host address
}

// ── Result Types ────────────────────────────────────────

export interface ServerResult {
  server: ServerEntry;
  success: boolean;
  duration: number;          // milliseconds
  error?: string;
  output?: string;
}

export interface OperationResult {
  operation: string;
  results: ServerResult[];
  totalDuration: number;
  successCount: number;
  failCount: number;
}
```

## CLI Commands

### Command: `prepare`

Runs `blue-green-prepare` on all resolved servers in parallel. This builds the Docker image (in-place) or pulls from registry, starts the new color, and waits for health checks — but does NOT switch traffic.

```
node deploy-cli.js prepare \
  --env acceptance \
  --scope all \
  --deploy-path /opt/scaffoldapp \
  --strategy in-place
```

**Implementation:**
1. Resolve servers from `deploy-inventory.json` (env + scope + filter)
2. Setup SSH config (from `SSH_PRIVATE_KEY` + `JUMP_HOST` env vars)
3. For each server in parallel:
   a. `ssh server "remote-ops.sh blue-green-prepare"`
4. Wait for all servers to complete
5. Report results (success/fail per server)
6. Exit 0 if all succeeded, exit 1 if any failed

### Command: `switch`

Runs `blue-green-switch` on all resolved servers in parallel. This is the fast phase — just nginx config swap + reload.

```
node deploy-cli.js switch \
  --env acceptance \
  --scope all \
  --deploy-path /opt/scaffoldapp
```

**Implementation:**
1. Resolve servers
2. Setup SSH
3. For each server in parallel:
   a. `ssh server "remote-ops.sh blue-green-switch"`
4. Report results
5. Exit code based on success/fail

### Command: `deploy`

Full coordinated deployment: prepare all → barrier → switch all.

```
node deploy-cli.js deploy \
  --env acceptance \
  --scope all \
  --deploy-path /opt/scaffoldapp \
  --strategy in-place
```

**Implementation:**
1. Run `prepare` on all servers (parallel, wait for all)
2. If any prepare failed → report and exit 1 (do NOT switch)
3. Run `switch` on all servers (parallel)
4. Report combined results

### Command: `upload`

Uploads tarball, scripts, Docker/Nginx configs, and sets environment variables on all servers.

```
node deploy-cli.js upload \
  --env acceptance \
  --scope all \
  --deploy-path /opt/scaffoldapp \
  --project-name scaffoldapp
```

**Implementation:**
1. Resolve servers
2. Setup SSH
3. For each server in parallel:
   a. SCP `remote-ops.sh`, `health-check-wait.sh` → server scripts dir
   b. SSH `remote-ops.sh setup-dirs`
   c. SCP tarball (if in-place) → server deploy path
   d. SSH `remote-ops.sh receive-deploy` (if in-place)
   e. SCP Docker files (Dockerfile, docker-compose.yml, .env.example)
   f. SCP Nginx config tree (recursive)
   g. Seed active-upstream.conf if first deploy
   h. Set .env variables (DEPLOY_ENV, COMPOSE_PROJECT_NAME, env_defaults)
4. Report results

### Command: `deploy-config`

Deploys config files from secrets to servers (replaces `deploy-config-files.sh`).

```
node deploy-cli.js deploy-config \
  --env acceptance \
  --scope all \
  --deploy-path /opt/scaffoldapp

# Environment variable:
#   ALL_SECRETS='{"ACC_ENV_FILE":"...", "ACC_APP_CONFIG":"..."}'
```

**Implementation:**
1. Read `deploy-config.json`, resolve entries for environment
2. Read `ALL_SECRETS` env var (JSON from `${{ toJSON(secrets) }}`)
3. For each config entry:
   a. Extract secret value from ALL_SECRETS
   b. Write to temp file
   c. SCP to server at deploy_path/deploy_path
   d. Clean up temp file
4. Report results

### Command: `operate`

Run any remote-ops.sh subcommand on resolved servers.

```
node deploy-cli.js operate \
  --env acceptance \
  --scope all \
  --deploy-path /opt/scaffoldapp \
  --op health-check

node deploy-cli.js operate \
  --env production \
  --scope server \
  --filter prod-01 \
  --deploy-path /opt/scaffoldapp \
  --op view-logs \
  -- 500     # Extra args passed to remote-ops.sh
```

**Implementation:**
1. Resolve servers
2. Setup SSH
3. For each server (parallel or sequential depending on operation):
   a. `ssh server "remote-ops.sh <operation> <extra-args>"`
4. Report results

### Command: `registry`

Build and push Docker image to registry (CI-side only, for registry strategy).

```
node deploy-cli.js registry \
  --registry-url registry.internal:5000 \
  --image-name scaffoldapp \
  --tag 20260329220000 \
  --deploy-path .
```

**Implementation:**
1. Generate tag (YYYYMMDDHHMMSS if not provided)
2. `docker build -t registry/image:tag --label git.sha=<sha> .`
3. `docker push registry/image:tag`
4. Output: `IMAGE_TAG=20260329220000` (for downstream steps)

## Library Modules

### `lib/ssh.ts` — SSH/SCP Operations

```typescript
/**
 * Create SSH config file from environment variables.
 * Handles: key file creation, config generation, jump host proxy.
 * Returns path to config file for use with -F flag.
 */
export function setupSSH(options: SSHOptions): SSHConfig;

/**
 * Execute a command on a remote server via SSH.
 * Returns stdout/stderr and exit code.
 */
export function sshExec(
  config: SSHConfig,
  host: string,
  command: string,
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Copy files to a remote server via SCP.
 * Supports single files, multiple files, and recursive directories.
 */
export function scpUpload(
  config: SSHConfig,
  host: string,
  localPaths: string | string[],
  remotePath: string,
  options?: { recursive?: boolean }
): Promise<void>;

/**
 * Cleanup SSH config and key files.
 */
export function cleanupSSH(config: SSHConfig): void;
```

### `lib/config.ts` — Config Resolution

```typescript
/**
 * Read and parse deploy-config.json.
 * Replaces resolve-config.js functionality.
 */
export function readConfig(configPath?: string): DeployConfig;

/**
 * Resolve config entries for a specific environment.
 * Returns entries with secret keys resolved (e.g., {ENV} → ACC).
 */
export function resolveConfigEntries(
  config: DeployConfig,
  environment: string
): ResolvedConfigEntry[];

/**
 * Get env_defaults for an environment.
 */
export function getEnvDefaults(
  config: DeployConfig,
  environment: string
): Record<string, string>;
```

### `lib/inventory.ts` — Server Resolution

```typescript
/**
 * Read and parse deploy-inventory.json.
 * Replaces resolve-servers.js functionality.
 */
export function readInventory(inventoryPath?: string): DeployInventory;

/**
 * Resolve servers for an environment with scope/filter.
 * Returns filtered server list.
 */
export function resolveServers(
  inventory: DeployInventory,
  environment: string,
  scope: string,
  filter?: string
): ServerEntry[];

/**
 * Get SSH options for an environment (key secret name, jump host).
 */
export function getSSHOptions(
  inventory: DeployInventory,
  environment: string
): { keySecretName: string; jumpHostSecret?: string };
```

### `lib/logger.ts` — Structured Output

```typescript
/**
 * Logger with consistent formatting for CI output.
 * Uses emoji prefixes for visual scanning in GitHub Actions logs.
 */
export const logger = {
  info(msg: string): void;      // ✅ message
  error(msg: string): void;     // ❌ message
  warn(msg: string): void;      // ⚠️ message
  step(n: string, msg: string): void;  // [n] message
  server(name: string, status: 'start' | 'ok' | 'fail', msg?: string): void;
  summary(result: OperationResult): void;
};
```

### `lib/process.ts` — Process Helpers

```typescript
/**
 * Spawn a process and capture output.
 * Handles timeout, signal forwarding, and stream capture.
 */
export function spawn(
  command: string,
  args: string[],
  options?: {
    timeout?: number;
    env?: Record<string, string>;
    cwd?: string;
    pipe?: boolean;  // pipe stdout/stderr to parent (for live output)
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }>;
```

## Entry Point (`index.ts`)

```typescript
/**
 * CLI argument parsing and command dispatch.
 * 
 * Uses a simple hand-rolled parser (no dependencies like yargs/commander).
 * Parses --flag value pairs and positional command name.
 * 
 * Usage:
 *   node deploy-cli.js <command> [options]
 * 
 * Global options:
 *   --env <environment>      Target environment (test/acceptance/production)
 *   --scope <scope>          Server scope (all/group/tag/server)
 *   --filter <value>         Filter value for scope
 *   --deploy-path <path>     Remote deployment path
 *   --strategy <strategy>    Deployment strategy (in-place/registry)
 *   --max-parallel <n>       Max parallel operations (default: 10)
 *   --dry-run                Show what would happen without executing
 *   --project-name <name>    Project name for COMPOSE_PROJECT_NAME
 * 
 * Registry options:
 *   --registry-url <url>     Docker registry URL
 *   --image-name <name>      Docker image name
 *   --tag <tag>              Image tag (default: YYYYMMDDHHMMSS)
 * 
 * Environment variables (read from env, set by GitHub Actions):
 *   SSH_PRIVATE_KEY          SSH private key content
 *   JUMP_HOST                Jump host address
 *   ALL_SECRETS              JSON of all GitHub secrets (for deploy-config)
 *   DEPLOY_PATH              Override for --deploy-path
 */
```

## Error Handling

| Error Case | Handling Strategy |
|------------|-------------------|
| SSH connection refused | Catch spawn error, log server name + error, mark as failed, continue with other servers |
| SSH key not provided | Check env var, log clear error message, exit 1 before starting any operations |
| deploy-inventory.json not found | Log error with expected path, exit 1 |
| deploy-config.json not found | Log error with expected path, exit 1 |
| No servers match scope/filter | Log "0 servers matched", exit 0 (not an error) |
| Prepare fails on some servers | Report per-server results, exit 1, do NOT proceed to switch |
| Switch fails on some servers | Report per-server results, exit 1, log which servers switched and which didn't |
| Timeout on SSH command | Kill process after timeout, mark server as failed |
| Invalid command | Print usage help, exit 1 |
| Missing required option | Print specific error + usage, exit 1 |

## Parallel Execution Model

```typescript
/**
 * Execute an operation on multiple servers in parallel.
 * Respects maxParallel limit.
 * Returns results for all servers.
 */
async function executeOnServers(
  servers: ServerEntry[],
  operation: (server: ServerEntry) => Promise<ServerResult>,
  maxParallel: number
): Promise<OperationResult> {
  // Use a simple semaphore pattern with Promise.all + chunking
  // For maxParallel=10 and 20 servers: run 10, wait, run 10
  const results: ServerResult[] = [];
  
  for (let i = 0; i < servers.length; i += maxParallel) {
    const batch = servers.slice(i, i + maxParallel);
    const batchResults = await Promise.allSettled(
      batch.map(server => operation(server))
    );
    results.push(...batchResults.map(/* ... */));
  }
  
  return { /* summary */ };
}
```

## Testing Requirements

- Unit tests for config resolution (config.ts, inventory.ts)
- Unit tests for argument parsing (index.ts)
- Unit tests for logger formatting (logger.ts)
- Integration tests via ScaffoldApp deployment (Phase 8)
- No mocking of SSH — integration tests use real servers
