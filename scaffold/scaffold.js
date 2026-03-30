#!/usr/bin/env node

// =============================================================================
// Blue-Green Deployment Scaffold Generator
// =============================================================================
// Interactive (or flag-based) generator that adds complete blue-green deployment
// infrastructure to any BlendSDK/WebAFX application.
//
// Usage:
//   node scaffold.js                          # Interactive mode
//   node scaffold.js --name my-app --port 3000 --with-postgres --single
//
// Built-in modules only — zero external dependencies.
// =============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// =============================================================================
// Constants
// =============================================================================

/** Directory where scaffold templates live (relative to this script) */
const TEMPLATES_DIR = path.join(__dirname, 'templates');

/** Directory where conditional partials live (relative to this script) */
const PARTIALS_DIR = path.join(__dirname, 'partials');

/** Default values for project configuration */
const DEFAULTS = {
  appPort: '3000',
  nginxPort: '80',
  appReplicas: '2',
  entrypoint: 'node server.js',
};

// =============================================================================
// CLI Argument Parser (Task 9.1.1)
// =============================================================================

/**
 * Parse command-line arguments into a flags object.
 * Supports: --name, --port, --nginx-port, --replicas, --entry,
 *           --with-postgres, --no-postgres, --with-redis, --no-redis,
 *           --single, --multi, --force, --dry-run, --help
 *
 * @returns {object} Parsed flags (keys are camelCase, values are strings or booleans)
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--name':        flags.name = args[++i]; break;
      case '--port':        flags.port = args[++i]; break;
      case '--nginx-port':  flags.nginxPort = args[++i]; break;
      case '--replicas':    flags.replicas = args[++i]; break;
      case '--entry':       flags.entry = args[++i]; break;
      case '--with-postgres': flags.postgres = true; break;
      case '--no-postgres':   flags.postgres = false; break;
      case '--with-redis':    flags.redis = true; break;
      case '--no-redis':      flags.redis = false; break;
      case '--strategy':      flags.strategy = args[++i]; break;
      case '--registry-url':  flags.registryUrl = args[++i]; break;
      case '--platform':      flags.platform = args[++i]; break;
      case '--single':        flags.topology = 'single'; break;
      case '--multi':         flags.topology = 'multi'; break;
      case '--force':         flags.force = true; break;
      case '--dry-run':       flags.dryRun = true; break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        // Unknown flags are silently ignored for forward compatibility
        if (arg.startsWith('--')) {
          console.warn(`⚠️  Unknown flag: ${arg}`);
        }
    }
  }

  return flags;
}

/**
 * Determine if we're running in non-interactive mode.
 * Non-interactive requires at minimum --name to be specified.
 *
 * @param {object} flags - Parsed CLI flags
 * @returns {boolean} True if all required flags are present for non-interactive mode
 */
function isNonInteractive(flags) {
  return typeof flags.name === 'string' && flags.name.length > 0;
}

/**
 * Print usage help and exit.
 */
function printHelp() {
  console.log(`
Blue-Green Deployment Scaffold Generator

Usage:
  node scaffold.js                    # Interactive mode
  node scaffold.js [flags]            # Non-interactive mode (requires --name)

Flags:
  --name <name>         Project name (required for non-interactive)
  --port <port>         App port (default: ${DEFAULTS.appPort})
  --nginx-port <port>   Nginx HTTP port (default: ${DEFAULTS.nginxPort})
  --replicas <count>    App replicas per color (default: ${DEFAULTS.appReplicas})
  --entry <command>     App entrypoint command (default: ${DEFAULTS.entrypoint})
  --with-postgres       Include PostgreSQL (default in interactive: ask)
  --no-postgres         Exclude PostgreSQL
  --with-redis          Include Redis
  --no-redis            Exclude Redis (default)
  --strategy <type>     Deployment strategy: in-place (default) or registry
  --registry-url <url>  Docker registry URL (required for registry strategy)
  --platform <platform> Target platform(s) for Docker builds (e.g., linux/arm64)
  --single              Single-server deployment topology
  --multi               Multi-server deployment topology
  --force               Overwrite existing files without asking
  --dry-run             Show what would be generated without writing files
  --help, -h            Show this help message

Examples:
  node scaffold.js --name my-app --port 3000 --with-postgres --single
  node scaffold.js --name my-api --port 4000 --with-postgres --with-redis --multi --force
  node scaffold.js --name my-svc --port 3000 --strategy registry --registry-url registry.internal:5000 --single
`);
  process.exit(0);
}

// =============================================================================
// Interactive Prompts (Task 9.1.2)
// =============================================================================

/**
 * Create a readline interface for interactive prompts.
 * @returns {readline.Interface}
 */
function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a question and return the answer (or default if empty).
 *
 * @param {readline.Interface} rl - Readline interface
 * @param {string} question - The question to display
 * @param {string} [defaultValue] - Default value if user presses Enter
 * @returns {Promise<string>} The user's answer
 */
function ask(rl, question, defaultValue) {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Ask a yes/no confirmation question.
 *
 * @param {readline.Interface} rl - Readline interface
 * @param {string} question - The question to display
 * @param {boolean} [defaultYes=true] - Default to yes if true
 * @returns {Promise<boolean>} True if user confirmed
 */
function confirm(rl, question, defaultYes = true) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    rl.question(`${question} ${hint}: `, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        resolve(defaultYes);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

/**
 * Ask user to choose between options.
 *
 * @param {readline.Interface} rl - Readline interface
 * @param {string} question - The question to display
 * @param {string[]} options - Array of option labels
 * @param {number} [defaultIndex=0] - Default option index (0-based)
 * @returns {Promise<number>} Selected option index (0-based)
 */
function choose(rl, question, options, defaultIndex = 0) {
  return new Promise((resolve) => {
    console.log(`\n${question}`);
    options.forEach((opt, i) => {
      const marker = i === defaultIndex ? '●' : '○';
      console.log(`  ${marker} ${i + 1}) ${opt}`);
    });
    rl.question(`Choice [${defaultIndex + 1}]: `, (answer) => {
      const trimmed = answer.trim();
      if (trimmed === '') {
        resolve(defaultIndex);
      } else {
        const num = parseInt(trimmed, 10);
        if (num >= 1 && num <= options.length) {
          resolve(num - 1);
        } else {
          // Invalid input — use default
          resolve(defaultIndex);
        }
      }
    });
  });
}

/**
 * Run the full interactive prompt flow to gather all user answers.
 *
 * @returns {Promise<object>} User answers object with all configuration values
 */
async function runInteractivePrompts() {
  const rl = createRL();

  console.log('\n🚀 Blue-Green Deployment Scaffold Generator\n');
  console.log('This will add complete deployment infrastructure to your project.');
  console.log('Press Enter to accept defaults shown in [brackets].\n');

  try {
    // --- Project basics ---
    console.log('── Project Configuration ──────────────────────');
    const name = await ask(rl, 'Project name', path.basename(process.cwd()));
    const appPort = await ask(rl, 'Application port', DEFAULTS.appPort);
    const nginxPort = await ask(rl, 'Nginx HTTP port (ProxyBuilder forwards here)', DEFAULTS.nginxPort);
    const appReplicas = await ask(rl, 'App replicas per color (blue/green)', DEFAULTS.appReplicas);
    const entrypoint = await ask(rl, 'App entrypoint command', DEFAULTS.entrypoint);

    // --- Infrastructure ---
    console.log('\n── Infrastructure ─────────────────────────────');
    const postgres = await confirm(rl, 'Include PostgreSQL?', true);
    const redis = await confirm(rl, 'Include Redis?', false);

    // --- Deployment strategy ---
    console.log('\n── Deployment Strategy ────────────────────────');
    const strategyChoice = await choose(rl, 'Deployment strategy:', [
      'in-place — Build Docker image on each server (simple, no registry needed)',
      'registry — Build once, push to registry, all servers pull (faster, consistent)',
    ], 0);
    const strategy = strategyChoice === 0 ? 'in-place' : 'registry';

    // Registry URL and platform are only needed for registry strategy
    let registryUrl = '';
    let platform = '';
    if (strategy === 'registry') {
      registryUrl = await ask(rl, 'Docker registry URL (e.g., registry.internal:5000)');

      // Platform prompt — determines target architecture for Docker builds.
      // When CI runner arch differs from server arch (e.g., amd64 → arm64),
      // QEMU + buildx handle cross-compilation automatically.
      const platformChoice = await choose(rl, 'Target platform(s) for Docker builds:', [
        'linux/amd64              (x86 servers)',
        'linux/arm64              (ARM servers)',
        'linux/amd64,linux/arm64  (mixed fleet — builds both architectures)',
        'Custom',
      ], 0);
      const presets = ['linux/amd64', 'linux/arm64', 'linux/amd64,linux/arm64'];
      platform = platformChoice < 3 ? presets[platformChoice] : await ask(rl, 'Custom platform(s)');
    }

    // --- Deployment topology ---
    console.log('\n── Deployment Topology ────────────────────────');
    const topologyChoice = await choose(rl, 'Deployment topology:', [
      'Single server — one server per environment',
      'Multi server — multiple servers per environment',
    ], 0);
    const topology = topologyChoice === 0 ? 'single' : 'multi';

    return { name, appPort, nginxPort, appReplicas, entrypoint, postgres, redis, strategy, registryUrl, platform, topology };
  } finally {
    rl.close();
  }
}

/**
 * Build answers from CLI flags (non-interactive mode).
 *
 * @param {object} flags - Parsed CLI flags
 * @returns {object} User answers object
 */
function answersFromFlags(flags) {
  const strategy = flags.strategy || 'in-place';

  // Validate strategy value to catch typos early
  if (strategy !== 'in-place' && strategy !== 'registry') {
    console.error(`❌ Invalid --strategy value: "${strategy}". Must be "in-place" or "registry".`);
    process.exit(1);
  }

  // Registry URL is required when strategy is registry
  if (strategy === 'registry' && !flags.registryUrl) {
    console.error('❌ --registry-url is required when --strategy is "registry".');
    process.exit(1);
  }

  return {
    name: flags.name,
    appPort: flags.port || DEFAULTS.appPort,
    nginxPort: flags.nginxPort || DEFAULTS.nginxPort,
    appReplicas: flags.replicas || DEFAULTS.appReplicas,
    entrypoint: flags.entry || DEFAULTS.entrypoint,
    postgres: flags.postgres !== undefined ? flags.postgres : true,
    redis: flags.redis !== undefined ? flags.redis : false,
    strategy,
    registryUrl: flags.registryUrl || '',
    platform: flags.platform || '',
    topology: flags.topology || 'single',
  };
}

// =============================================================================
// Template Rendering (Task 9.1.3)
// =============================================================================

/**
 * Replace {{PLACEHOLDER}} markers in a template string with values from vars.
 * Unmatched placeholders are left as-is (they may be bash/YAML variables).
 *
 * @param {string} template - Template content with {{PLACEHOLDER}} markers
 * @param {object} vars - Key-value pairs for placeholder replacement
 * @returns {string} Rendered content
 */
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}

/**
 * Read a template file from the templates directory.
 *
 * @param {string} relativePath - Path relative to TEMPLATES_DIR
 * @returns {string} File contents
 */
function readTemplate(relativePath) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, relativePath), 'utf-8');
}

/**
 * Read a partial file from the partials directory.
 *
 * @param {string} filename - Partial filename (e.g., 'docker-compose-postgres.yml')
 * @returns {string} File contents
 */
function readPartial(filename) {
  return fs.readFileSync(path.join(PARTIALS_DIR, filename), 'utf-8');
}

// =============================================================================
// Conditional Assembly (Task 9.1.4)
// =============================================================================

/**
 * Build the template variables map from user answers.
 * This includes both direct placeholders (PROJECT_NAME, APP_PORT, etc.)
 * and conditional partial content (SERVICES_PARTIAL, ENV_POSTGRES_PARTIAL, etc.).
 *
 * @param {object} answers - User answers from prompts or flags
 * @returns {object} Template variables for render()
 */
function buildTemplateVars(answers) {
  const vars = {
    PROJECT_NAME: answers.name,
    PROJECT_NAME_LOWER: answers.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
    APP_PORT: answers.appPort,
    NGINX_PORT: answers.nginxPort,
    APP_REPLICAS: answers.appReplicas,
    ENTRYPOINT: answers.entrypoint,
    ENTRYPOINT_ARRAY: answers.entrypoint.split(/\s+/).map(s => `"${s}"`).join(', '),
  };

  // --- Docker Compose build strategy ---
  // Select build partial based on deployment strategy choice.
  // In-place: builds Docker image on each server using local Dockerfile.
  // Registry: pulls pre-built image from a Docker registry.
  const isRegistry = answers.strategy === 'registry';
  vars.APP_BUILD_SECTION = isRegistry
    ? readPartial('compose-build-registry.yml')
    : readPartial('compose-build-inplace.yml');

  // Registry-specific variables used in env-registry.txt partial and workflows
  vars.REGISTRY_URL = answers.registryUrl || '';
  vars.IMAGE_NAME = vars.PROJECT_NAME_LOWER;

  // --- Docker Compose conditionals ---
  const services = [];
  const volumes = [];

  if (answers.postgres) {
    services.push(readPartial('docker-compose-postgres.yml'));
    services.push(readPartial('docker-compose-pgbackup.yml'));
    volumes.push('  postgres_data:');
    volumes.push('    driver: local');
  }

  if (answers.redis) {
    services.push(readPartial('docker-compose-redis.yml'));
    volumes.push('  redis_data:');
    volumes.push('    driver: local');
  }

  // SERVICES_PARTIAL: joined service blocks (or empty)
  vars.SERVICES_PARTIAL = services.length > 0 ? services.join('\n') : '';

  // VOLUMES_PARTIAL: volumes section header + entries (or empty)
  if (volumes.length > 0) {
    vars.VOLUMES_PARTIAL = 'volumes:\n' + volumes.join('\n') + '\n';
  } else {
    vars.VOLUMES_PARTIAL = '';
  }

  // CORE_SERVICES_COMMENT: additional core services listed in comment header
  const coreExtras = [];
  if (answers.postgres) coreExtras.push('postgres');
  if (answers.redis) coreExtras.push('redis');
  vars.CORE_SERVICES_COMMENT = coreExtras.length > 0 ? ', ' + coreExtras.join(', ') : '';

  // DB_PROFILE_COMMENT: database profile comment line (or empty)
  vars.DB_PROFILE_COMMENT = answers.postgres
    ? '#   - db:       Database only (postgres)\n'
    : '';

  // --- .env.example conditionals ---
  // Registry env vars are included only for registry strategy
  vars.ENV_REGISTRY_PARTIAL = isRegistry ? readPartial('env-registry.txt') : '';
  vars.ENV_POSTGRES_PARTIAL = answers.postgres ? readPartial('env-postgres.txt') : '';
  vars.ENV_REDIS_PARTIAL = answers.redis ? readPartial('env-redis.txt') : '';
  vars.ENV_BACKUP_PARTIAL = answers.postgres ? readPartial('env-backup.txt') : '';

  // --- remote-ops.sh conditionals (comment-wrapped partials) ---
  // These replace "# {{PARTIAL}}" comment lines with actual content
  vars.DATABASE_COMMANDS_PARTIAL = answers.postgres
    ? readPartial('remote-ops-database-commands.sh')
    : '';
  vars.DISPATCHER_DATABASE_PARTIAL = answers.postgres
    ? readPartial('remote-ops-dispatcher-database.sh')
    : '';
  vars.HEALTH_CHECK_DB_PARTIAL = answers.postgres
    ? readPartial('remote-ops-health-check-db.sh')
    : '';
  vars.HELP_DATABASE_PARTIAL = answers.postgres
    ? readPartial('remote-ops-help-database.sh')
    : '';

  // --- GitHub Actions operations conditionals ---
  vars.OPERATIONS_DATABASE_OPTIONS = answers.postgres
    ? readPartial('operations-database-options.yml')
    : '';
  // Note: OPERATIONS_DATABASE_STEPS partial exists but is no longer referenced
  // by workflow templates — the deploy CLI `operate` command handles all
  // operations dynamically. Kept for backward compatibility if needed.

  // --- GitHub Actions workflow conditionals (registry vs in-place) ---
  // DOCKER_PLATFORM: target platform for buildx (e.g., "linux/arm64")
  vars.DOCKER_PLATFORM = answers.platform || '';
  // WORKFLOW_REGISTRY_STEPS: QEMU + buildx + login + push block (empty for in-place)
  vars.WORKFLOW_REGISTRY_STEPS = isRegistry
    ? readPartial('workflow-release-registry-steps.yml')
    : '';
  // UPLOAD_STRATEGY_FLAG: appended to upload command (empty for in-place)
  vars.UPLOAD_STRATEGY_FLAG = isRegistry ? '--strategy registry' : '';

  // --- SECRETS-SETUP.md config secrets table ---
  vars.CONFIG_SECRETS_TABLE = buildConfigSecretsTable(answers);

  return vars;
}

/**
 * Generate the config secrets table for SECRETS-SETUP.md.
 * Based on the default deploy-config.json structure and selected environments.
 *
 * @param {object} answers - User answers
 * @returns {string} Markdown table of config secrets
 */
function buildConfigSecretsTable(answers) {
  // Standard config entries that every project gets
  const configs = [
    { name: 'Docker Environment (.env)', key: 'ENV_FILE' },
    { name: 'App Config (app-config.json)', key: 'APP_CONFIG' },
  ];

  // Standard environment prefixes
  const envPrefixes = [
    { env: 'test', prefix: 'TEST' },
    { env: 'acceptance', prefix: 'ACC' },
    { env: 'production', prefix: 'PROD' },
  ];

  const rows = ['| Secret | Description | Source |', '|--------|-------------|--------|'];

  for (const config of configs) {
    for (const { env, prefix } of envPrefixes) {
      const secretKey = `${prefix}_${config.key}`;
      rows.push(`| \`${secretKey}\` | ${config.name} for ${env} | \`local_data/${env}/\` |`);
    }
  }

  return rows.join('\n');
}

// =============================================================================
// File Writer (Task 9.2.1)
// =============================================================================

/**
 * Determine the list of files to generate based on user answers.
 * Each entry maps a source template path to a target output path.
 *
 * @param {object} answers - User answers
 * @returns {Array<{src: string, dest: string, executable?: boolean}>} File list
 */
function buildFileList(answers) {
  const files = [];

  // --- Helper to add a template file ---
  const add = (src, dest, executable) => {
    files.push({ src, dest, executable: executable || false });
  };

  // --- Nginx configs (always) ---
  add('deployment/nginx/nginx.conf', 'deployment/nginx/nginx.conf');
  add('deployment/nginx/conf.d/server-name.conf', 'deployment/nginx/conf.d/server-name.conf');
  add('deployment/nginx/includes/error_pages.conf', 'deployment/nginx/includes/error_pages.conf');
  add('deployment/nginx/includes/file_cache.conf', 'deployment/nginx/includes/file_cache.conf');
  add('deployment/nginx/includes/proxy_headers.conf', 'deployment/nginx/includes/proxy_headers.conf');
  add('deployment/nginx/includes/proxy_params.conf', 'deployment/nginx/includes/proxy_params.conf');
  add('deployment/nginx/includes/proxy_timeouts.conf', 'deployment/nginx/includes/proxy_timeouts.conf');
  add('deployment/nginx/includes/proxy_timeouts_health.conf', 'deployment/nginx/includes/proxy_timeouts_health.conf');
  add('deployment/nginx/includes/security_headers_enhanced.conf', 'deployment/nginx/includes/security_headers_enhanced.conf');
  add('deployment/nginx/includes/trusted_proxies.conf', 'deployment/nginx/includes/trusted_proxies.conf');
  add('deployment/nginx/locations/10-health.conf', 'deployment/nginx/locations/10-health.conf');
  add('deployment/nginx/locations/15-auth.conf', 'deployment/nginx/locations/15-auth.conf');
  add('deployment/nginx/locations/20-ping.conf', 'deployment/nginx/locations/20-ping.conf');
  add('deployment/nginx/locations/30-nginx-status.conf', 'deployment/nginx/locations/30-nginx-status.conf');
  add('deployment/nginx/locations/99-default.conf', 'deployment/nginx/locations/99-default.conf');
  add('deployment/nginx/upstreams/active-upstream.conf', 'deployment/nginx/upstreams/active-upstream.conf');
  add('deployment/nginx/upstreams/blue-upstream.conf', 'deployment/nginx/upstreams/blue-upstream.conf');
  add('deployment/nginx/upstreams/green-upstream.conf', 'deployment/nginx/upstreams/green-upstream.conf');

  // --- Docker infrastructure (always) ---
  add('deployment/docker-compose.yml', 'deployment/docker-compose.yml');
  add('deployment/Dockerfile', 'deployment/Dockerfile');
  add('deployment/.env.example', 'deployment/.env.example');

  // --- pg-backup (only if postgres) ---
  if (answers.postgres) {
    add('deployment/pg-backup.sh', 'deployment/pg-backup.sh', true);
  }

  // --- Scripts (always) ---
  // deploy-cli.js replaces the old deploy-config-files.sh, multi-deploy.sh,
  // resolve-config.js, and resolve-servers.js scripts. It handles all
  // deployment orchestration from CI runners via SSH.
  add('deployment/scripts/deploy-cli.js', 'deployment/scripts/deploy-cli.js');
  add('deployment/scripts/remote-ops.sh', 'deployment/scripts/remote-ops.sh', true);
  add('deployment/scripts/health-check-wait.sh', 'deployment/scripts/health-check-wait.sh', true);

  // --- Deploy package + push-secrets (always) ---
  add('deploy-package.sh', 'deploy-package.sh', true);
  add('scripts/push-secrets.sh', 'scripts/push-secrets.sh', true);

  // --- Config files (always) ---
  add('deploy-config.json', 'deploy-config.json');

  // --- Inventory (only if multi) ---
  if (answers.topology === 'multi') {
    add('deploy-inventory.json', 'deploy-inventory.json');
  }

  // --- GitHub Actions (topology-dependent) ---
  add('.github/workflows/build-test.yml', '.github/workflows/build-test.yml');
  add('.github/SECRETS-SETUP.md', '.github/SECRETS-SETUP.md');

  if (answers.topology === 'single') {
    add('.github/workflows/release-single.yml', '.github/workflows/release.yml');
    add('.github/workflows/operations-single.yml', '.github/workflows/operations.yml');
  } else {
    add('.github/workflows/release-multi.yml', '.github/workflows/release.yml');
    add('.github/workflows/operations-multi.yml', '.github/workflows/operations.yml');
  }

  // --- .gitignore + local_data (always) ---
  add('.gitignore.template', '.gitignore');
  add('local_data/.gitkeep', 'local_data/.gitkeep');

  return files;
}

/**
 * Write a single file to disk with conflict detection.
 * Creates parent directories as needed. Sets executable permission if requested.
 *
 * @param {string} destPath - Absolute path to write to
 * @param {string} content - File content
 * @param {boolean} executable - Whether to set executable permission
 * @param {object} options - { force: boolean, dryRun: boolean }
 * @returns {string} Status: 'created', 'overwritten', 'skipped', or 'dry-run'
 */
function writeFile(destPath, content, executable, options) {
  const { force, dryRun } = options;

  if (dryRun) {
    return 'dry-run';
  }

  const exists = fs.existsSync(destPath);

  if (exists && !force) {
    return 'skipped';
  }

  // Create parent directories
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(destPath, content, 'utf-8');

  // Set executable permission for shell scripts
  if (executable) {
    fs.chmodSync(destPath, 0o755);
  }

  return exists ? 'overwritten' : 'created';
}

// =============================================================================
// Deploy Config Generation (Task 9.2.2)
// =============================================================================

/**
 * Generate deploy-config.json content based on user answers.
 * Customizes environments based on deployment topology.
 *
 * @param {object} answers - User answers
 * @returns {string} JSON string for deploy-config.json
 */
function generateDeployConfig(answers) {
  const config = {
    configs: [
      {
        name: 'Docker Environment',
        secret_key: '{ENV}_ENV_FILE',
        local_file: 'local_data/{env}/.env',
        deploy_path: '.env',
      },
      {
        name: 'App Config',
        secret_key: '{ENV}_APP_CONFIG',
        local_file: 'local_data/{env}/app-config.json',
        deploy_path: 'app-config.json',
      },
    ],
    environments: {
      test: 'TEST',
      acceptance: 'ACC',
      production: 'PROD',
    },
  };

  return JSON.stringify(config, null, 2) + '\n';
}

// =============================================================================
// Deploy Inventory Generation (Task 9.2.3)
// =============================================================================

/**
 * Generate deploy-inventory.json content for multi-server topology.
 * Provides a starter template with example environments.
 *
 * @param {object} answers - User answers
 * @returns {string} JSON string for deploy-inventory.json
 */
function generateDeployInventory(answers) {
  const inventory = {
    ssh_key_secret: 'DEPLOY_SSH_KEY',
    environments: {
      test: {
        access: 'direct',
        servers: [
          { name: 'test-01', host: 'deploy@10.0.1.30', group: 'all' },
        ],
      },
      acceptance: {
        access: 'jump_host',
        jump_host_secret: 'JUMP_HOST',
        servers: [
          { name: 'acc-01', host: 'deploy@10.0.2.10', group: 'all' },
          { name: 'acc-02', host: 'deploy@10.0.2.20', group: 'all' },
        ],
      },
      production: {
        access: 'direct',
        servers: [
          { name: 'prod-01', host: 'deploy@10.0.3.10', group: 'all', tags: ['eu-west'] },
          { name: 'prod-02', host: 'deploy@10.0.3.20', group: 'all', tags: ['eu-west'] },
        ],
      },
    },
  };

  return JSON.stringify(inventory, null, 2) + '\n';
}

// =============================================================================
// Workflow Selection & Environment Setup (Task 9.2.4)
// =============================================================================

/**
 * Process and render all files for the scaffold.
 * Orchestrates: template reading → partial injection → placeholder rendering → file writing.
 *
 * @param {object} answers - User answers
 * @param {object} options - { force: boolean, dryRun: boolean }
 * @returns {Array<{dest: string, status: string}>} Results for each file
 */
function generateAllFiles(answers, options) {
  const vars = buildTemplateVars(answers);
  const fileList = buildFileList(answers);
  const targetDir = process.cwd();
  const results = [];

  for (const file of fileList) {
    let content;

    // Special case: deploy-config.json and deploy-inventory.json are generated,
    // not just template-rendered (Task 9.2.2, 9.2.3)
    if (file.src === 'deploy-config.json') {
      content = generateDeployConfig(answers);
    } else if (file.src === 'deploy-inventory.json') {
      content = generateDeployInventory(answers);
    } else {
      // Read template and render with placeholder replacement
      const template = readTemplate(file.src);
      content = render(template, vars);
    }

    // Also render partials content that was injected (partials may contain {{PROJECT_NAME}})
    content = render(content, vars);

    // Handle comment-wrapped partials in bash files:
    // Lines like "  # {{PARTIAL_NAME}}" where the partial was already replaced above.
    // If the partial was empty string, we need to clean up the comment wrapper too.
    // Clean up empty comment lines that were placeholder wrappers
    content = content.replace(/^[ \t]*#[ \t]*\n/gm, (match, offset) => {
      // Only remove if it looks like a cleaned-up partial (not regular comments)
      return match;
    });

    const destPath = path.join(targetDir, file.dest);
    const status = writeFile(destPath, content, file.executable, options);

    results.push({ dest: file.dest, status });
  }

  return results;
}

// =============================================================================
// Summary Output (Task 9.2.5)
// =============================================================================

/**
 * Print a summary of generated files and next steps.
 *
 * @param {Array<{dest: string, status: string}>} results - File generation results
 * @param {object} answers - User answers
 */
function printSummary(results, answers) {
  console.log('\n' + '═'.repeat(60));
  console.log('  🎉 Scaffold Generated Successfully!');
  console.log('═'.repeat(60));

  // --- File counts by status ---
  const created = results.filter(r => r.status === 'created');
  const overwritten = results.filter(r => r.status === 'overwritten');
  const skipped = results.filter(r => r.status === 'skipped');
  const dryRun = results.filter(r => r.status === 'dry-run');

  console.log(`\n📁 Files: ${results.length} total`);
  if (created.length > 0) console.log(`   ✅ ${created.length} created`);
  if (overwritten.length > 0) console.log(`   🔄 ${overwritten.length} overwritten`);
  if (skipped.length > 0) console.log(`   ⏭️  ${skipped.length} skipped (already exist, use --force to overwrite)`);
  if (dryRun.length > 0) console.log(`   🔍 ${dryRun.length} would be created (dry run)`);

  // --- Configuration summary ---
  const strategyLabel = answers.strategy === 'registry'
    ? `registry (push to ${answers.registryUrl})`
    : 'in-place (build on each server)';

  console.log('\n📋 Configuration:');
  console.log(`   Project:    ${answers.name}`);
  console.log(`   App Port:   ${answers.appPort}`);
  console.log(`   Nginx Port: ${answers.nginxPort}`);
  console.log(`   Replicas:   ${answers.appReplicas}`);
  console.log(`   PostgreSQL: ${answers.postgres ? '✅ Yes' : '❌ No'}`);
  console.log(`   Redis:      ${answers.redis ? '✅ Yes' : '❌ No'}`);
  console.log(`   Strategy:   ${strategyLabel}`);
  if (answers.platform) {
    console.log(`   Platform:   ${answers.platform}`);
  }
  console.log(`   Topology:   ${answers.topology === 'single' ? 'Single server' : 'Multi server'}`);

  // --- Skipped files detail ---
  if (skipped.length > 0) {
    console.log('\n⏭️  Skipped files (already exist):');
    for (const r of skipped) {
      console.log(`   - ${r.dest}`);
    }
  }

  // --- Registry setup notes (only for registry strategy) ---
  if (answers.strategy === 'registry') {
    console.log('\n⚠️  Registry setup required:');
    console.log(`   1. Run Docker registry on your registry host (${answers.registryUrl})`);
    console.log(`   2. Add "insecure-registries": ["${answers.registryUrl}"]`);
    console.log('      to /etc/docker/daemon.json on all hosts');
    console.log('   3. Restart Docker on all hosts: sudo systemctl restart docker');
  }

  // --- Next steps ---
  console.log('\n🔜 Next Steps:');
  console.log('');
  console.log('   1. Set up environment files:');
  console.log('      mkdir -p local_data/{test,acceptance,production}');
  console.log('      cp deployment/.env.example local_data/test/.env');
  console.log('      # Edit each environment\'s .env with correct values');
  console.log('');
  console.log('   2. Review and customize:');
  console.log('      - deployment/docker-compose.yml  — Docker service configuration');
  console.log('      - deployment/Dockerfile           — Build steps for your app');
  console.log('      - deploy-package.sh               — Uncomment sections you need');
  if (answers.topology === 'multi') {
    console.log('      - deploy-inventory.json           — Server inventory per environment');
  }
  console.log('');
  console.log('   3. Push secrets to GitHub:');
  console.log('      ./scripts/push-secrets.sh test');
  console.log('      ./scripts/push-secrets.sh acceptance');
  console.log('      ./scripts/push-secrets.sh production');
  console.log('');
  console.log('   4. Set infrastructure secrets in GitHub:');
  console.log(`      See: .github/SECRETS-SETUP.md`);
  console.log('');
  console.log('   5. Build and verify locally:');
  console.log('      cd deployment && docker compose --profile all build');
  console.log('      docker compose --profile core --profile blue up -d');
  console.log('');
  console.log('   6. Deploy:');
  console.log('      Push to main branch → GitHub Actions handles the rest!');
  console.log('');
  console.log('═'.repeat(60));
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Main function — orchestrates the scaffold generation flow.
 * Handles both interactive and non-interactive modes.
 */
async function main() {
  const flags = parseArgs();

  // Show help if requested
  if (flags.help) {
    printHelp();
  }

  // Determine mode: interactive vs non-interactive
  let answers;

  if (isNonInteractive(flags)) {
    // Non-interactive: build answers from flags
    answers = answersFromFlags(flags);
    console.log(`\n🚀 Generating scaffold for "${answers.name}" (non-interactive mode)\n`);
  } else {
    // Interactive: prompt user for all values
    answers = await runInteractivePrompts();
  }

  // Determine write options
  const options = {
    force: flags.force || false,
    dryRun: flags.dryRun || false,
  };

  // Generate all files
  const results = generateAllFiles(answers, options);

  // Print summary
  printSummary(results, answers);
}

// Run main and handle errors
main().catch((err) => {
  console.error(`\n❌ Scaffold generation failed: ${err.message}`);
  process.exit(1);
});
