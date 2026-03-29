#!/usr/bin/env node

// src/deploy-cli/index.ts
var VERSION = "1.0.0";
var CLI_NAME = "deploy-cli";
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set(["dry-run", "help", "version"]);
function parseArgs(argv) {
  const options = {};
  const extraArgs = [];
  let command = "";
  let collectingExtra = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      collectingExtra = true;
      continue;
    }
    if (collectingExtra) {
      extraArgs.push(arg ?? "");
      continue;
    }
    if (arg?.startsWith("--")) {
      const flagName = arg.slice(2);
      if (BOOLEAN_FLAGS.has(flagName)) {
        options[flagName] = "true";
        continue;
      }
      const nextArg = argv[i + 1];
      if (nextArg !== void 0 && !nextArg.startsWith("--")) {
        options[flagName] = nextArg;
        i++;
      } else {
        options[flagName] = "true";
      }
      continue;
    }
    if (!command) {
      command = arg ?? "";
      continue;
    }
    extraArgs.push(arg ?? "");
  }
  return { command, options, extraArgs };
}
var commands = [
  // Phase 3 will add: prepare, switch, deploy, upload, deploy-config, operate, registry
];
function printHelp() {
  const lines = [
    `${CLI_NAME} v${VERSION}`,
    "",
    "Usage:",
    `  node ${CLI_NAME}.js <command> [options]`,
    "",
    "Commands:"
  ];
  if (commands.length === 0) {
    lines.push("  (no commands registered yet \u2014 see Phase 3)");
  } else {
    const maxNameLen = Math.max(...commands.map((c) => c.name.length));
    for (const cmd of commands) {
      lines.push(`  ${cmd.name.padEnd(maxNameLen + 2)}${cmd.description}`);
    }
  }
  lines.push(
    "",
    "Global options:",
    "  --env <environment>      Target environment (test/acceptance/production)",
    "  --scope <scope>          Server scope (all/group/tag/server)",
    "  --filter <value>         Filter value for scope",
    "  --deploy-path <path>     Remote deployment path",
    "  --strategy <strategy>    Deployment strategy (in-place/registry)",
    "  --max-parallel <n>       Max parallel operations (default: 10)",
    "  --dry-run                Show what would happen without executing",
    "  --project-name <name>    Project name for COMPOSE_PROJECT_NAME",
    "",
    "Registry options:",
    "  --registry-url <url>     Docker registry URL",
    "  --image-name <name>      Docker image name",
    "  --tag <tag>              Image tag (default: YYYYMMDDHHMMSS)",
    "",
    "Environment variables:",
    "  SSH_PRIVATE_KEY          SSH private key content",
    "  JUMP_HOST                Jump host address",
    "  ALL_SECRETS              JSON of all GitHub secrets (for deploy-config)",
    "  DEPLOY_PATH              Override for --deploy-path",
    "",
    "Examples:",
    "  node deploy-cli.js deploy --env acceptance --scope all --strategy in-place",
    "  node deploy-cli.js prepare --env production --scope group --filter web",
    "  node deploy-cli.js operate --env test --scope all --op health-check",
    "  node deploy-cli.js registry --registry-url localhost:5000 --image-name myapp"
  );
  console.log(lines.join("\n"));
}
function printVersion() {
  console.log(`${CLI_NAME} v${VERSION}`);
}
async function dispatch(args) {
  const cmd = commands.find((c) => c.name === args.command);
  if (!cmd) {
    console.error(`\u274C Unknown command: "${args.command}"`);
    console.error(`   Run "node ${CLI_NAME}.js --help" to see available commands.`);
    process.exit(1);
  }
  await cmd.handler(args);
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.options["help"] === "true" || args.command === "help") {
    printHelp();
    return;
  }
  if (args.options["version"] === "true") {
    printVersion();
    return;
  }
  if (!args.command) {
    printHelp();
    process.exit(1);
  }
  await dispatch(args);
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\u274C Fatal error: ${message}`);
  process.exit(1);
});
export {
  parseArgs
};
