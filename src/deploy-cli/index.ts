/**
 * Deploy CLI — Entry point.
 *
 * A TypeScript CLI tool that orchestrates blue-green deployments from CI runners
 * via SSH to remote servers. Replaces inline bash in GitHub Actions workflows
 * with a single, typed, testable tool.
 *
 * Usage:
 *   node deploy-cli.js <command> [options]
 *
 * Commands:
 *   prepare        Run blue-green-prepare on all resolved servers
 *   switch         Run blue-green-switch on all resolved servers
 *   deploy         Full coordinated deploy (prepare → barrier → switch)
 *   upload         Upload tarball, scripts, Docker/Nginx configs to servers
 *   deploy-config  Deploy config files from secrets to servers
 *   operate        Run any remote-ops.sh subcommand on servers
 *   registry       Build + push Docker image to registry (CI-side)
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
 *
 * @module deploy-cli
 */

import type { ParsedArgs, CommandDefinition } from './types.js';

// ── Constants ───────────────────────────────────────────

/** CLI version — updated manually on significant changes */
const VERSION = '1.0.0';

/** CLI name as shown in usage output */
const CLI_NAME = 'deploy-cli';

/** Boolean flags that don't take a value argument */
const BOOLEAN_FLAGS = new Set(['dry-run', 'help', 'version']);

// ── Argument Parser ─────────────────────────────────────

/**
 * Parse command-line arguments into a structured format.
 *
 * Handles three types of arguments:
 * 1. Positional command (first non-flag argument)
 * 2. Named options (--flag value pairs, or --boolean-flag)
 * 3. Extra arguments after "--" separator (passed through to remote commands)
 *
 * @param argv - Raw argument array (typically process.argv.slice(2))
 * @returns Parsed arguments with command, options, and extra args
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const options: Record<string, string> = {};
  const extraArgs: string[] = [];
  let command = '';
  let collectingExtra = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Everything after "--" is collected as extra args (passed to remote commands)
    if (arg === '--') {
      collectingExtra = true;
      continue;
    }

    if (collectingExtra) {
      extraArgs.push(arg ?? '');
      continue;
    }

    // Named option: --flag or --flag value
    if (arg?.startsWith('--')) {
      const flagName = arg.slice(2);

      // Boolean flags don't consume the next argument
      if (BOOLEAN_FLAGS.has(flagName)) {
        options[flagName] = 'true';
        continue;
      }

      // Value flags consume the next argument
      const nextArg = argv[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith('--')) {
        options[flagName] = nextArg;
        i++; // Skip the value argument
      } else {
        // Flag without a value — treat as boolean
        options[flagName] = 'true';
      }
      continue;
    }

    // First positional argument is the command name
    if (!command) {
      command = arg ?? '';
      continue;
    }

    // Additional positional arguments are treated as extra args
    extraArgs.push(arg ?? '');
  }

  return { command, options, extraArgs };
}

// ── Command Registry ────────────────────────────────────

/**
 * Registry of available commands.
 * Commands are added in Phase 3 — for now, this is an empty array
 * that the dispatcher iterates over.
 */
const commands: CommandDefinition[] = [
  // Phase 3 will add: prepare, switch, deploy, upload, deploy-config, operate, registry
];

// ── Help & Version ──────────────────────────────────────

/**
 * Print usage help to stdout.
 * Lists all registered commands and global options.
 */
function printHelp(): void {
  const lines = [
    `${CLI_NAME} v${VERSION}`,
    '',
    'Usage:',
    `  node ${CLI_NAME}.js <command> [options]`,
    '',
    'Commands:',
  ];

  if (commands.length === 0) {
    lines.push('  (no commands registered yet — see Phase 3)');
  } else {
    // Calculate padding for aligned descriptions
    const maxNameLen = Math.max(...commands.map(c => c.name.length));
    for (const cmd of commands) {
      lines.push(`  ${cmd.name.padEnd(maxNameLen + 2)}${cmd.description}`);
    }
  }

  lines.push(
    '',
    'Global options:',
    '  --env <environment>      Target environment (test/acceptance/production)',
    '  --scope <scope>          Server scope (all/group/tag/server)',
    '  --filter <value>         Filter value for scope',
    '  --deploy-path <path>     Remote deployment path',
    '  --strategy <strategy>    Deployment strategy (in-place/registry)',
    '  --max-parallel <n>       Max parallel operations (default: 10)',
    '  --dry-run                Show what would happen without executing',
    '  --project-name <name>    Project name for COMPOSE_PROJECT_NAME',
    '',
    'Registry options:',
    '  --registry-url <url>     Docker registry URL',
    '  --image-name <name>      Docker image name',
    '  --tag <tag>              Image tag (default: YYYYMMDDHHMMSS)',
    '',
    'Environment variables:',
    '  SSH_PRIVATE_KEY          SSH private key content',
    '  JUMP_HOST                Jump host address',
    '  ALL_SECRETS              JSON of all GitHub secrets (for deploy-config)',
    '  DEPLOY_PATH              Override for --deploy-path',
    '',
    'Examples:',
    '  node deploy-cli.js deploy --env acceptance --scope all --strategy in-place',
    '  node deploy-cli.js prepare --env production --scope group --filter web',
    '  node deploy-cli.js operate --env test --scope all --op health-check',
    '  node deploy-cli.js registry --registry-url localhost:5000 --image-name myapp',
  );

  console.log(lines.join('\n'));
}

/**
 * Print version to stdout.
 */
function printVersion(): void {
  console.log(`${CLI_NAME} v${VERSION}`);
}

// ── Command Dispatcher ──────────────────────────────────

/**
 * Find and execute the requested command.
 * Exits with code 1 if the command is unknown.
 *
 * @param args - Parsed CLI arguments
 */
async function dispatch(args: ParsedArgs): Promise<void> {
  const cmd = commands.find(c => c.name === args.command);

  if (!cmd) {
    console.error(`❌ Unknown command: "${args.command}"`);
    console.error(`   Run "node ${CLI_NAME}.js --help" to see available commands.`);
    process.exit(1);
  }

  await cmd.handler(args);
}

// ── Main Entry Point ────────────────────────────────────

/**
 * Main function — parses arguments and dispatches to the appropriate command.
 * Handles --help and --version flags before dispatching.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Handle global flags first
  if (args.options['help'] === 'true' || args.command === 'help') {
    printHelp();
    return;
  }

  if (args.options['version'] === 'true') {
    printVersion();
    return;
  }

  // A command is required
  if (!args.command) {
    printHelp();
    process.exit(1);
  }

  // Dispatch to the matching command handler
  await dispatch(args);
}

// Only run main() when this file is executed directly (not imported for testing).
// In ESM, we check if the resolved module URL matches the CLI entry in process.argv.
const isDirectExecution = process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
   import.meta.url === `file://${process.argv[1]}`);

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Fatal error: ${message}`);
    process.exit(1);
  });
}
