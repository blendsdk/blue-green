#!/usr/bin/env node

// src/deploy-cli/lib/ssh.ts
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// src/deploy-cli/lib/process.ts
import { spawn as nodeSpawn } from "child_process";
function spawn(command, args, options = {}) {
  return new Promise((resolve3, reject) => {
    const { timeout, env, cwd, pipe = false } = options;
    const mergedEnv = env ? { ...process.env, ...env } : process.env;
    const child = nodeSpawn(command, args, {
      cwd,
      env: mergedEnv,
      // Always capture output via pipe — we manually forward to parent if pipe=true
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      if (pipe) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
      if (pipe) {
        process.stderr.write(chunk);
      }
    });
    let timeoutId;
    if (timeout !== void 0 && timeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5e3);
      }, timeout);
    }
    child.on("close", (code) => {
      if (timeoutId !== void 0) {
        clearTimeout(timeoutId);
      }
      resolve3({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code
      });
    });
    child.on("error", (err) => {
      if (timeoutId !== void 0) {
        clearTimeout(timeoutId);
      }
      reject(err);
    });
  });
}

// src/deploy-cli/lib/ssh.ts
function setupSSH(options) {
  if (!options.privateKey) {
    throw new Error("SSH private key is required. Set SSH_PRIVATE_KEY environment variable.");
  }
  const sshDir = join(tmpdir(), `deploy-cli-ssh-${Date.now()}`);
  mkdirSync(sshDir, { recursive: true });
  const keyPath = join(sshDir, "deploy_key");
  const configPath = join(sshDir, "ssh_config");
  writeFileSync(keyPath, options.privateKey + "\n", { mode: 384 });
  const configLines = [
    "Host *",
    `  IdentityFile ${keyPath}`,
    "  StrictHostKeyChecking no",
    "  UserKnownHostsFile /dev/null",
    "  LogLevel ERROR",
    "  ServerAliveInterval 30",
    "  ServerAliveCountMax 3",
    "  ConnectTimeout 10"
  ];
  if (options.jumpHost) {
    configLines.push(`  ProxyJump ${options.jumpHost}`);
  }
  writeFileSync(configPath, configLines.join("\n") + "\n", { mode: 384 });
  return { configPath, keyPath };
}
async function sshExec(config, host, command, options) {
  const args = [
    "-F",
    config.configPath,
    "-o",
    "BatchMode=yes",
    host,
    command
  ];
  return spawn("ssh", args, {
    timeout: options?.timeout,
    pipe: options?.pipe
  });
}
async function scpUpload(config, host, localPaths, remotePath, options) {
  const paths = Array.isArray(localPaths) ? localPaths : [localPaths];
  const args = [
    "-F",
    config.configPath,
    "-o",
    "BatchMode=yes"
  ];
  if (options?.recursive) {
    args.push("-r");
  }
  args.push(...paths);
  args.push(`${host}:${remotePath}`);
  const result = await spawn("scp", args);
  if (result.exitCode !== 0) {
    throw new Error(`SCP upload failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
}
function cleanupSSH(config) {
  try {
    unlinkSync(config.configPath);
  } catch {
  }
  if (config.keyPath) {
    try {
      unlinkSync(config.keyPath);
    } catch {
    }
  }
  try {
    const dir = join(config.configPath, "..");
    unlinkSync(dir);
  } catch {
  }
}

// src/deploy-cli/lib/logger.ts
var logger = {
  /**
   * Log an informational message with a success/info emoji.
   * Used for general progress updates and confirmations.
   *
   * @param msg - Message to display
   */
  info(msg) {
    console.log(`\u2705 ${msg}`);
  },
  /**
   * Log an error message with an error emoji.
   * Used for failures and error conditions.
   *
   * @param msg - Error message to display
   */
  error(msg) {
    console.error(`\u274C ${msg}`);
  },
  /**
   * Log a warning message with a warning emoji.
   * Used for non-fatal issues that deserve attention.
   *
   * @param msg - Warning message to display
   */
  warn(msg) {
    console.warn(`\u26A0\uFE0F  ${msg}`);
  },
  /**
   * Log a numbered step in a sequence.
   * Used for multi-step operations to show progress.
   *
   * @param n - Step number or label (e.g., "1/5", "2.1")
   * @param msg - Description of the step
   */
  step(n, msg) {
    console.log(`\u{1F504} [${n}] ${msg}`);
  },
  /**
   * Log a server-specific status update.
   * Used during multi-server operations to track per-server progress.
   *
   * @param name - Server name (e.g., "acc-01")
   * @param status - Current status (start = beginning, ok = success, fail = error)
   * @param msg - Optional additional message
   */
  server(name, status, msg) {
    const icons = {
      start: "\u{1F5A5}\uFE0F ",
      ok: "\u2705",
      fail: "\u274C"
    };
    const icon = icons[status] ?? "\u{1F5A5}\uFE0F ";
    const suffix = msg ? ` \u2014 ${msg}` : "";
    console.log(`${icon} [${name}]${suffix}`);
  },
  /**
   * Print a summary of an operation across all servers.
   * Shows per-server results, total duration, and overall success/failure counts.
   *
   * @param result - Aggregated operation result
   */
  summary(result) {
    const { operation, results, totalDuration, successCount, failCount } = result;
    const durationSec = (totalDuration / 1e3).toFixed(1);
    console.log("");
    console.log(`\u2501\u2501\u2501 ${operation} Summary \u2501\u2501\u2501`);
    console.log(`  Total: ${results.length} server(s) in ${durationSec}s`);
    console.log(`  Success: ${successCount}  |  Failed: ${failCount}`);
    if (results.length > 0) {
      console.log("");
      for (const r of results) {
        const icon = r.success ? "\u2705" : "\u274C";
        const duration = (r.duration / 1e3).toFixed(1);
        const errSuffix = r.error ? ` \u2014 ${r.error}` : "";
        console.log(`  ${icon} ${r.server.name} (${duration}s)${errSuffix}`);
      }
    }
    console.log("");
    if (failCount === 0) {
      console.log(`\u2705 ${operation} completed successfully`);
    } else {
      console.log(`\u274C ${operation} failed on ${failCount} server(s)`);
    }
    console.log("");
  }
};

// src/deploy-cli/lib/inventory.ts
import { readFileSync } from "fs";
import { resolve } from "path";
function readInventory(inventoryPath) {
  const filePath = resolve(inventoryPath ?? "deploy-inventory.json");
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(
      `Inventory file not found: ${filePath}
  Expected deploy-inventory.json in the project root.
  Run the scaffold generator to create one.`
    );
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in inventory file: ${filePath}`);
  }
}
function resolveServers(inventory, environment, scope, filter) {
  const envInventory = getEnvironmentInventory(inventory, environment);
  const servers = envInventory.servers;
  switch (scope) {
    case "all":
      return servers;
    case "group": {
      if (!filter) {
        throw new Error('--filter is required when scope is "group"');
      }
      const matched = servers.filter((s) => s.group === filter);
      if (matched.length === 0) {
        const groups = [...new Set(servers.map((s) => s.group))].join(", ");
        throw new Error(
          `No servers found in group "${filter}" for environment "${environment}"
  Available groups: ${groups}`
        );
      }
      return matched;
    }
    case "tag": {
      if (!filter) {
        throw new Error('--filter is required when scope is "tag"');
      }
      const matched = servers.filter((s) => s.tags?.includes(filter) ?? false);
      if (matched.length === 0) {
        const allTags = [...new Set(servers.flatMap((s) => s.tags ?? []))].join(", ");
        throw new Error(
          `No servers found with tag "${filter}" for environment "${environment}"
  Available tags: ${allTags || "(none)"}`
        );
      }
      return matched;
    }
    case "server": {
      if (!filter) {
        throw new Error('--filter is required when scope is "server"');
      }
      const matched = servers.filter((s) => s.name === filter);
      if (matched.length === 0) {
        const names = servers.map((s) => s.name).join(", ");
        throw new Error(
          `Server "${filter}" not found in environment "${environment}"
  Available servers: ${names}`
        );
      }
      return matched;
    }
    default:
      throw new Error(
        `Invalid scope: "${scope}"
  Valid scopes: all, group, tag, server`
      );
  }
}
function getSSHOptions(inventory, environment) {
  const envInventory = getEnvironmentInventory(inventory, environment);
  return {
    keySecretName: inventory.ssh_key_secret,
    jumpHostSecret: envInventory.jump_host_secret
  };
}
function getEnvironmentInventory(inventory, environment) {
  const envInventory = inventory.environments[environment];
  if (!envInventory) {
    const available = Object.keys(inventory.environments).join(", ");
    throw new Error(
      `Unknown environment: "${environment}"
  Available environments: ${available}`
    );
  }
  return envInventory;
}

// src/deploy-cli/commands/shared.ts
function parseDeployOptions(args) {
  const environment = args.options["env"];
  if (!environment) {
    throw new Error("--env is required (e.g., --env acceptance)");
  }
  const scope = args.options["scope"] ?? "all";
  if (!["all", "group", "tag", "server"].includes(scope)) {
    throw new Error(`Invalid --scope: "${scope}". Valid: all, group, tag, server`);
  }
  const deployPath = args.options["deploy-path"] ?? process.env["DEPLOY_PATH"];
  if (!deployPath) {
    throw new Error("--deploy-path is required (e.g., --deploy-path /opt/myapp)");
  }
  const strategy = args.options["strategy"] ?? "in-place";
  if (strategy !== "in-place" && strategy !== "registry") {
    throw new Error(`Invalid --strategy: "${strategy}". Valid: in-place, registry`);
  }
  const maxParallel = parseInt(args.options["max-parallel"] ?? "10", 10);
  if (isNaN(maxParallel) || maxParallel < 1) {
    throw new Error("--max-parallel must be a positive integer");
  }
  return {
    environment,
    scope,
    filter: args.options["filter"],
    strategy,
    maxParallel,
    dryRun: args.options["dry-run"] === "true",
    deployPath,
    projectName: args.options["project-name"] ?? ""
  };
}
function resolveTargetServers(options) {
  const inventory = readInventory();
  const servers = resolveServers(
    inventory,
    options.environment,
    options.scope,
    options.filter
  );
  const sshOptions = getSSHOptions(inventory, options.environment);
  return { servers, sshOptions };
}
function buildSSHOptions(sshOpts) {
  const privateKey = process.env["SSH_PRIVATE_KEY"] ?? process.env[sshOpts.keySecretName];
  const jumpHost = sshOpts.jumpHostSecret ? process.env[sshOpts.jumpHostSecret] : void 0;
  return { privateKey, jumpHost };
}
async function withSSH(sshOptions, fn) {
  const config = setupSSH(sshOptions);
  try {
    return await fn(config);
  } finally {
    cleanupSSH(config);
  }
}
async function executeOnServers(operationName, servers, operation, maxParallel = 10) {
  const overallStart = Date.now();
  const results = [];
  for (let i = 0; i < servers.length; i += maxParallel) {
    const batch = servers.slice(i, i + maxParallel);
    const batchNumber = Math.floor(i / maxParallel) + 1;
    const totalBatches = Math.ceil(servers.length / maxParallel);
    if (totalBatches > 1) {
      logger.step(
        `${batchNumber}/${totalBatches}`,
        `Processing batch of ${batch.length} server(s)`
      );
    }
    const batchPromises = batch.map(async (server) => {
      logger.server(server.name, "start", operationName);
      const start = Date.now();
      try {
        const result = await operation(server);
        const duration = Date.now() - start;
        if (result.success) {
          logger.server(server.name, "ok", `${(duration / 1e3).toFixed(1)}s`);
        } else {
          logger.server(server.name, "fail", result.error ?? "unknown error");
        }
        return { ...result, duration };
      } catch (err) {
        const duration = Date.now() - start;
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.server(server.name, "fail", errorMsg);
        return {
          server,
          success: false,
          duration,
          error: errorMsg
        };
      }
    });
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  const totalDuration = Date.now() - overallStart;
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  return {
    operation: operationName,
    results,
    totalDuration,
    successCount,
    failCount
  };
}
function logDryRun(operationName, servers, options) {
  logger.info(`DRY RUN \u2014 ${operationName}`);
  logger.info(`Environment: ${options.environment}`);
  logger.info(`Scope: ${options.scope}${options.filter ? ` (filter: ${options.filter})` : ""}`);
  logger.info(`Strategy: ${options.strategy}`);
  logger.info(`Deploy path: ${options.deployPath}`);
  logger.info(`Max parallel: ${options.maxParallel}`);
  logger.info(`Target servers (${servers.length}):`);
  for (const server of servers) {
    logger.info(`  ${server.name} (${server.host}) [${server.group}]`);
  }
}
function exitWithResult(result) {
  logger.summary(result);
  if (result.failCount > 0) {
    process.exit(1);
  }
}

// src/deploy-cli/commands/prepare.ts
async function prepareCommand(args) {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);
  if (servers.length === 0) {
    logger.info("No servers matched \u2014 nothing to prepare");
    return;
  }
  if (options.dryRun) {
    logDryRun("prepare", servers, options);
    return;
  }
  logger.info(`Preparing ${servers.length} server(s) in ${options.environment}`);
  logger.info(`Strategy: ${options.strategy}`);
  const sshOpts = buildSSHOptions(sshOptions);
  const scriptsDir = `${options.deployPath}/scripts`;
  const remoteCommand = `bash ${scriptsDir}/remote-ops.sh blue-green-prepare`;
  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      "prepare",
      servers,
      (server) => runPrepare(sshConfig, server, remoteCommand),
      options.maxParallel
    );
  });
  exitWithResult(result);
}
async function runPrepare(sshConfig, server, remoteCommand) {
  try {
    const result = await sshExec(sshConfig, server.host, remoteCommand, {
      pipe: true,
      // Stream build output live for CI visibility
      timeout: 6e5
      // 10 minutes — builds can be slow
    });
    const success = result.exitCode === 0;
    return {
      server,
      success,
      duration: 0,
      // Set by executeOnServers wrapper
      output: result.stdout.trim() || void 0,
      error: success ? void 0 : `prepare failed (exit ${result.exitCode})`
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg
    };
  }
}

// src/deploy-cli/commands/switch.ts
async function switchCommand(args) {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);
  if (servers.length === 0) {
    logger.info("No servers matched \u2014 nothing to switch");
    return;
  }
  if (options.dryRun) {
    logDryRun("switch", servers, options);
    return;
  }
  logger.info(`Switching ${servers.length} server(s) in ${options.environment}`);
  const sshOpts = buildSSHOptions(sshOptions);
  const scriptsDir = `${options.deployPath}/scripts`;
  const remoteCommand = `bash ${scriptsDir}/remote-ops.sh blue-green-switch`;
  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      "switch",
      servers,
      (server) => runSwitch(sshConfig, server, remoteCommand),
      options.maxParallel
    );
  });
  exitWithResult(result);
}
async function runSwitch(sshConfig, server, remoteCommand) {
  try {
    const result = await sshExec(sshConfig, server.host, remoteCommand, {
      pipe: true,
      // Show switch output for visibility
      timeout: 12e4
      // 2 minutes — switch is fast, timeout is a safety net
    });
    const success = result.exitCode === 0;
    return {
      server,
      success,
      duration: 0,
      // Set by executeOnServers wrapper
      output: result.stdout.trim() || void 0,
      error: success ? void 0 : `switch failed (exit ${result.exitCode})`
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg
    };
  }
}

// src/deploy-cli/commands/deploy.ts
async function deployCommand(args) {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);
  if (servers.length === 0) {
    logger.info("No servers matched \u2014 nothing to deploy");
    return;
  }
  if (options.dryRun) {
    logDryRun("deploy (prepare \u2192 switch)", servers, options);
    return;
  }
  logger.info(`Deploying to ${servers.length} server(s) in ${options.environment}`);
  logger.info(`Strategy: ${options.strategy}`);
  const sshOpts = buildSSHOptions(sshOptions);
  const scriptsDir = `${options.deployPath}/scripts`;
  await withSSH(sshOpts, async (sshConfig) => {
    logger.step("1/2", "PREPARE \u2014 Building and starting new version on all servers");
    const prepareCommand2 = `bash ${scriptsDir}/remote-ops.sh blue-green-prepare`;
    const prepareResult = await executeOnServers(
      "prepare",
      servers,
      (server) => runRemoteOp(sshConfig, server, prepareCommand2, 6e5),
      options.maxParallel
    );
    logger.summary(prepareResult);
    if (prepareResult.failCount > 0) {
      logger.error("BARRIER \u2014 Prepare failed on some servers. Aborting deploy.");
      logger.error("No servers will be switched. Fix failures and retry.");
      const failedServers = prepareResult.results.filter((r) => !r.success).map((r) => r.server.name).join(", ");
      logger.error(`Failed servers: ${failedServers}`);
      process.exit(1);
    }
    logger.info("All servers prepared successfully \u2014 proceeding to switch");
    logger.step("2/2", "SWITCH \u2014 Swapping traffic to new version on all servers");
    const switchCmd = `bash ${scriptsDir}/remote-ops.sh blue-green-switch`;
    const switchResult = await executeOnServers(
      "switch",
      servers,
      (server) => runRemoteOp(sshConfig, server, switchCmd, 12e4),
      options.maxParallel
    );
    const combinedResult = {
      ...switchResult,
      operation: "deploy",
      totalDuration: prepareResult.totalDuration + switchResult.totalDuration
    };
    exitWithResult(combinedResult);
  });
}
async function runRemoteOp(sshConfig, server, command, timeout) {
  try {
    const result = await sshExec(sshConfig, server.host, command, {
      pipe: true,
      timeout
    });
    const success = result.exitCode === 0;
    return {
      server,
      success,
      duration: 0,
      // Set by executeOnServers wrapper
      output: result.stdout.trim() || void 0,
      error: success ? void 0 : `failed (exit ${result.exitCode})`
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg
    };
  }
}

// src/deploy-cli/commands/upload.ts
import { existsSync } from "fs";
import { join as join2 } from "path";

// src/deploy-cli/lib/config.ts
import { readFileSync as readFileSync2 } from "fs";
import { resolve as resolve2 } from "path";
function readConfig(configPath) {
  const filePath = resolve2(configPath ?? "deploy-config.json");
  let content;
  try {
    content = readFileSync2(filePath, "utf-8");
  } catch {
    throw new Error(
      `Config file not found: ${filePath}
  Expected deploy-config.json in the project root.
  Run the scaffold generator to create one.`
    );
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in config file: ${filePath}`);
  }
}
function resolveConfigEntries(config, environment) {
  const envConfig = getEnvironmentConfig(config, environment);
  return config.configs.map((entry) => ({
    name: entry.name,
    // Replace {ENV} with the uppercase prefix (e.g., "ACC")
    secretKey: entry.secret_key.replace("{ENV}", envConfig.prefix),
    // Replace {env} with the lowercase environment name (e.g., "acceptance")
    localFile: entry.local_file.replace("{env}", environment),
    deployPath: entry.deploy_path
  }));
}
function getEnvDefaults(config, environment) {
  const envConfig = getEnvironmentConfig(config, environment);
  return envConfig.env_defaults;
}
function getEnvironmentConfig(config, environment) {
  const envConfig = config.environments[environment];
  if (!envConfig) {
    const available = Object.keys(config.environments).join(", ");
    throw new Error(
      `Unknown environment: "${environment}"
  Available environments: ${available}`
    );
  }
  return envConfig;
}

// src/deploy-cli/commands/upload.ts
async function uploadCommand(args) {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);
  if (servers.length === 0) {
    logger.info("No servers matched \u2014 nothing to upload");
    return;
  }
  if (options.dryRun) {
    logDryRun("upload", servers, options);
    return;
  }
  logger.info(`Uploading to ${servers.length} server(s) in ${options.environment}`);
  const sshOpts = buildSSHOptions(sshOptions);
  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      "upload",
      servers,
      (server) => uploadToServer(sshConfig, server, options, args),
      options.maxParallel
    );
  });
  exitWithResult(result);
}
async function uploadToServer(sshConfig, server, options, args) {
  const { deployPath, strategy } = options;
  const scriptsDir = `${deployPath}/scripts`;
  const output = [];
  try {
    await uploadScripts(sshConfig, server, scriptsDir);
    output.push("scripts uploaded");
    await sshExec(sshConfig, server.host, `bash ${scriptsDir}/remote-ops.sh setup-dirs`);
    output.push("dirs created");
    if (strategy === "in-place") {
      const tarballPath = args.options["tarball"];
      if (tarballPath && existsSync(tarballPath)) {
        await scpUpload(sshConfig, server.host, tarballPath, deployPath);
        await sshExec(sshConfig, server.host, `bash ${scriptsDir}/remote-ops.sh receive-deploy`);
        output.push("tarball deployed");
      }
    }
    await uploadDockerConfigs(sshConfig, server, deployPath);
    output.push("docker configs uploaded");
    await uploadNginxConfigs(sshConfig, server, deployPath);
    output.push("nginx configs uploaded");
    await seedActiveUpstream(sshConfig, server, deployPath);
    await setEnvVariables(sshConfig, server, deployPath, options);
    output.push(".env configured");
    return {
      server,
      success: true,
      duration: 0,
      // Actual duration set by executeOnServers wrapper
      output: output.join(", ")
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg,
      output: output.join(", ")
    };
  }
}
async function uploadScripts(sshConfig, server, scriptsDir) {
  await sshExec(sshConfig, server.host, `mkdir -p ${scriptsDir}`);
  const scriptFiles = ["remote-ops.sh", "health-check-wait.sh"];
  const localPaths = scriptFiles.map((f) => join2("deployment", "scripts", f)).filter((f) => existsSync(f));
  if (localPaths.length > 0) {
    await scpUpload(sshConfig, server.host, localPaths, scriptsDir);
    await sshExec(sshConfig, server.host, `chmod +x ${scriptsDir}/*.sh`);
  }
}
async function uploadDockerConfigs(sshConfig, server, deployPath) {
  const dockerFiles = ["Dockerfile", "docker-compose.yml", ".env.example"];
  const localPaths = dockerFiles.map((f) => join2("deployment", f)).filter((f) => existsSync(f));
  if (localPaths.length > 0) {
    await scpUpload(sshConfig, server.host, localPaths, deployPath);
  }
}
async function uploadNginxConfigs(sshConfig, server, deployPath) {
  const nginxDir = join2("deployment", "nginx");
  if (existsSync(nginxDir)) {
    await sshExec(sshConfig, server.host, `mkdir -p ${deployPath}/nginx`);
    await scpUpload(
      sshConfig,
      server.host,
      nginxDir,
      `${deployPath}/`,
      { recursive: true }
    );
  }
}
async function seedActiveUpstream(sshConfig, server, deployPath) {
  const upstreamsDir = `${deployPath}/nginx/upstreams`;
  const activeConf = `${upstreamsDir}/active-upstream.conf`;
  const blueConf = `${upstreamsDir}/blue-upstream.conf`;
  const check = await sshExec(
    sshConfig,
    server.host,
    `test -f ${activeConf} && echo exists || echo missing`
  );
  if (check.stdout.trim() === "missing") {
    logger.info(`Seeding active-upstream.conf with blue on ${server.name}`);
    await sshExec(sshConfig, server.host, `cp ${blueConf} ${activeConf}`);
  }
}
async function setEnvVariables(sshConfig, server, deployPath, options) {
  const envFile = `${deployPath}/.env`;
  const envVars = {
    DEPLOY_ENV: options.environment
  };
  if (options.projectName) {
    envVars["COMPOSE_PROJECT_NAME"] = options.projectName;
  }
  try {
    const config = readConfig();
    const defaults = getEnvDefaults(config, options.environment);
    Object.assign(envVars, defaults);
  } catch {
    logger.warn("Could not read deploy-config.json for env_defaults \u2014 skipping");
  }
  const commands2 = [`touch ${envFile}`];
  for (const [key, value] of Object.entries(envVars)) {
    commands2.push(
      `grep -q "^${key}=" ${envFile} && sed -i "s|^${key}=.*|${key}=${value}|" ${envFile} || echo "${key}=${value}" >> ${envFile}`
    );
  }
  await sshExec(sshConfig, server.host, commands2.join(" && "));
}

// src/deploy-cli/commands/deploy-config.ts
import { writeFileSync as writeFileSync2, unlinkSync as unlinkSync2 } from "fs";
import { join as join3 } from "path";
import { tmpdir as tmpdir2 } from "os";
async function deployConfigCommand(args) {
  const options = parseDeployOptions(args);
  const { servers, sshOptions } = resolveTargetServers(options);
  if (servers.length === 0) {
    logger.info("No servers matched \u2014 nothing to deploy");
    return;
  }
  const config = readConfig();
  const entries = resolveConfigEntries(config, options.environment);
  if (entries.length === 0) {
    logger.info("No config entries defined \u2014 nothing to deploy");
    return;
  }
  const secrets = parseSecrets();
  const missingSecrets = entries.filter((e) => !secrets[e.secretKey]);
  if (missingSecrets.length > 0) {
    const missing = missingSecrets.map((e) => e.secretKey).join(", ");
    logger.error(`Missing secrets: ${missing}`);
    logger.error("Ensure ALL_SECRETS env var contains all required secrets.");
    process.exit(1);
  }
  if (options.dryRun) {
    logDryRun("deploy-config", servers, options);
    logger.info(`Config entries to deploy (${entries.length}):`);
    for (const entry of entries) {
      logger.info(`  ${entry.name}: ${entry.secretKey} \u2192 ${entry.deployPath}`);
    }
    return;
  }
  logger.info(`Deploying ${entries.length} config file(s) to ${servers.length} server(s)`);
  const sshOpts = buildSSHOptions(sshOptions);
  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      "deploy-config",
      servers,
      (server) => deployConfigToServer(sshConfig, server, entries, secrets, options.deployPath),
      options.maxParallel
    );
  });
  exitWithResult(result);
}
async function deployConfigToServer(sshConfig, server, entries, secrets, deployPath) {
  const deployed = [];
  try {
    for (const entry of entries) {
      const secretValue = secrets[entry.secretKey];
      if (!secretValue) {
        throw new Error(`Secret "${entry.secretKey}" not found for config "${entry.name}"`);
      }
      const tempFile = join3(tmpdir2(), `deploy-config-${Date.now()}-${entry.name}`);
      try {
        writeFileSync2(tempFile, secretValue, { mode: 384 });
        const remotePath = `${deployPath}/${entry.deployPath}`;
        const remoteDir = remotePath.substring(0, remotePath.lastIndexOf("/"));
        if (remoteDir) {
          await sshExec(sshConfig, server.host, `mkdir -p ${remoteDir}`);
        }
        await scpUpload(sshConfig, server.host, tempFile, remotePath);
        deployed.push(entry.name);
      } finally {
        try {
          unlinkSync2(tempFile);
        } catch {
        }
      }
    }
    return {
      server,
      success: true,
      duration: 0,
      // Set by executeOnServers wrapper
      output: `deployed: ${deployed.join(", ")}`
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg,
      output: deployed.length > 0 ? `partial: ${deployed.join(", ")}` : void 0
    };
  }
}
function parseSecrets() {
  const raw = process.env["ALL_SECRETS"];
  if (!raw) {
    logger.error("ALL_SECRETS environment variable is not set.");
    logger.error("In GitHub Actions, set it via: ALL_SECRETS: ${{ toJSON(secrets) }}");
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("ALL_SECRETS must be a JSON object");
    }
    return parsed;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to parse ALL_SECRETS: ${errorMsg}`);
    process.exit(1);
  }
}

// src/deploy-cli/commands/operate.ts
async function operateCommand(args) {
  const options = parseDeployOptions(args);
  const operation = args.options["op"];
  if (!operation) {
    logger.error("--op is required for the operate command");
    logger.error("Example: --op health-check, --op restart, --op view-logs");
    process.exit(1);
  }
  const { servers, sshOptions } = resolveTargetServers(options);
  if (servers.length === 0) {
    logger.info("No servers matched \u2014 nothing to do");
    return;
  }
  if (options.dryRun) {
    logDryRun(`operate:${operation}`, servers, options);
    if (args.extraArgs.length > 0) {
      logger.info(`Extra args: ${args.extraArgs.join(" ")}`);
    }
    return;
  }
  logger.info(`Running "${operation}" on ${servers.length} server(s) in ${options.environment}`);
  const sshOpts = buildSSHOptions(sshOptions);
  const extraArgsStr = args.extraArgs.length > 0 ? " " + args.extraArgs.join(" ") : "";
  const scriptsDir = `${options.deployPath}/scripts`;
  const remoteCommand = `bash ${scriptsDir}/remote-ops.sh ${operation}${extraArgsStr}`;
  const streamingOps = /* @__PURE__ */ new Set(["view-logs", "status", "docker-logs"]);
  const shouldPipe = streamingOps.has(operation);
  const result = await withSSH(sshOpts, async (sshConfig) => {
    return executeOnServers(
      `operate:${operation}`,
      servers,
      (server) => runOperation(sshConfig, server, remoteCommand, shouldPipe),
      options.maxParallel
    );
  });
  exitWithResult(result);
}
async function runOperation(sshConfig, server, remoteCommand, pipe) {
  try {
    const result = await sshExec(sshConfig, server.host, remoteCommand, {
      pipe,
      // Operations get a generous timeout (5 minutes)
      // Some operations like rebuild can take a while
      timeout: 3e5
    });
    const success = result.exitCode === 0;
    const output = result.stdout.trim() || result.stderr.trim();
    return {
      server,
      success,
      duration: 0,
      // Set by executeOnServers wrapper
      output: output || void 0,
      error: success ? void 0 : `exit code ${result.exitCode}`
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      server,
      success: false,
      duration: 0,
      error: errorMsg
    };
  }
}

// src/deploy-cli/commands/registry.ts
async function registryCommand(args) {
  const options = parseRegistryOptions(args);
  const dryRun = args.options["dry-run"] === "true";
  if (dryRun) {
    logRegistryDryRun(options);
    return;
  }
  const fullTag = `${options.registryUrl}/${options.imageName}:${options.imageTag}`;
  logger.info(`Building image: ${fullTag}`);
  await buildImage(fullTag, args);
  await pushImage(fullTag);
  logger.info(`Image pushed successfully: ${fullTag}`);
  console.log(`IMAGE_TAG=${options.imageTag}`);
}
function parseRegistryOptions(args) {
  const registryUrl = args.options["registry-url"];
  if (!registryUrl) {
    logger.error("--registry-url is required (e.g., --registry-url localhost:5000)");
    process.exit(1);
  }
  const imageName = args.options["image-name"];
  if (!imageName) {
    logger.error("--image-name is required (e.g., --image-name myapp)");
    process.exit(1);
  }
  const imageTag = args.options["tag"] ?? generateTimestampTag();
  return { registryUrl, imageName, imageTag };
}
async function buildImage(fullTag, args) {
  const deployPath = args.options["deploy-path"] ?? ".";
  const gitSha = await getGitSha();
  const buildArgs = [
    "build",
    "-t",
    fullTag,
    "--label",
    `git.sha=${gitSha}`,
    deployPath
  ];
  logger.step("1/2", "Building Docker image");
  const result = await spawn("docker", buildArgs, {
    pipe: true,
    // Stream build output live
    timeout: 6e5
    // 10 minutes for builds
  });
  if (result.exitCode !== 0) {
    logger.error("Docker build failed");
    logger.error(result.stderr.trim());
    process.exit(1);
  }
}
async function pushImage(fullTag) {
  logger.step("2/2", "Pushing Docker image to registry");
  const result = await spawn("docker", ["push", fullTag], {
    pipe: true,
    timeout: 3e5
    // 5 minutes for push
  });
  if (result.exitCode !== 0) {
    logger.error("Docker push failed");
    logger.error(result.stderr.trim());
    process.exit(1);
  }
}
function generateTimestampTag() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}
async function getGitSha() {
  try {
    const result = await spawn("git", ["rev-parse", "HEAD"], {
      timeout: 5e3
    });
    return result.exitCode === 0 ? result.stdout.trim() : "unknown";
  } catch {
    return "unknown";
  }
}
function logRegistryDryRun(options) {
  const fullTag = `${options.registryUrl}/${options.imageName}:${options.imageTag}`;
  logger.info("DRY RUN \u2014 registry");
  logger.info(`Registry URL: ${options.registryUrl}`);
  logger.info(`Image name: ${options.imageName}`);
  logger.info(`Image tag: ${options.imageTag}`);
  logger.info(`Full tag: ${fullTag}`);
  logger.info("Would build and push this image");
}

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
  {
    name: "prepare",
    description: "Run blue-green-prepare on all resolved servers",
    handler: prepareCommand
  },
  {
    name: "switch",
    description: "Run blue-green-switch on all resolved servers",
    handler: switchCommand
  },
  {
    name: "deploy",
    description: "Full coordinated deploy (prepare \u2192 barrier \u2192 switch)",
    handler: deployCommand
  },
  {
    name: "upload",
    description: "Upload tarball, scripts, Docker/Nginx configs to servers",
    handler: uploadCommand
  },
  {
    name: "deploy-config",
    description: "Deploy config files from secrets to servers",
    handler: deployConfigCommand
  },
  {
    name: "operate",
    description: "Run any remote-ops.sh subcommand on servers",
    handler: operateCommand
  },
  {
    name: "registry",
    description: "Build + push Docker image to registry (CI-side)",
    handler: registryCommand
  }
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
var isDirectExecution = process.argv[1] && (import.meta.url.endsWith(process.argv[1]) || import.meta.url === `file://${process.argv[1]}`);
if (isDirectExecution) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\u274C Fatal error: ${message}`);
    process.exit(1);
  });
}
export {
  parseArgs
};
