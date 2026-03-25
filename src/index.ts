#!/usr/bin/env bun

import { ui, ask, confirm, select, closePrompt } from "./ui.ts";
import { getPlatform, acquireSudo } from "./platform.ts";
import { flushDns } from "./dns.ts";
import { addHostEntry, removeHostEntry, hasHostEntry } from "./hosts.ts";
import { ensureMkcert, installRootCA, generateCert, uninstallRootCA } from "./cert.ts";
import { startServer, stopServer } from "./server.ts";
import {
  saveState,
  loadState,
  clearState,
  ensureStateDir,
  type SessionState,
} from "./state.ts";
import * as path from "node:path";
import * as fs from "node:fs";

const TOTAL_STEPS = 5;

async function cmdStart() {
  ui.banner();

  const platform = getPlatform();
  ui.info(`Detected platform: ${ui.bold(platform)}`);
  console.log();

  // Check if a session is already active
  const existing = await loadState();
  if (existing) {
    ui.warn(`An active session exists for ${ui.bold(existing.domain)}`);
    const overwrite = await confirm("Stop existing session and start a new one?");
    if (overwrite) {
      await cmdStop(false);
    } else {
      ui.info("Exiting. Use 'passkeys-rescue stop' to clean up first.");
      return;
    }
  }

  // Step 1: Ask for domain
  ui.step(1, TOTAL_STEPS, "Domain Configuration");
  const domain = await ask("Enter the domain to recover (e.g., wallet.example.com)");
  if (!domain) {
    ui.error("Domain is required");
    return;
  }

  // Validate domain format
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/.test(domain)) {
    ui.warn("Domain format looks unusual. Continuing anyway...");
  }

  // Step 2: Ask for mode
  ui.step(2, TOTAL_STEPS, "Server Mode");
  const modeIdx = await select("How do you want to serve the site?", [
    "Static files — serve from a local directory",
    "Reverse proxy — forward to a local or remote service",
  ]);

  let mode: "static" | "proxy";
  let target: string;

  if (modeIdx === 0) {
    mode = "static";
    const dir = await ask("Enter the path to your web files directory", "./dist");
    target = path.resolve(dir);
    if (!fs.existsSync(target)) {
      ui.error(`Directory not found: ${target}`);
      const create = await confirm("Create it?", false);
      if (create) {
        fs.mkdirSync(target, { recursive: true });
        ui.success(`Created ${target}`);
        ui.info("Place your HTML/JS files there, then restart.");
        return;
      }
      return;
    }
  } else {
    mode = "proxy";
    ui.info("Examples:");
    console.log("    Local:  http://localhost:3000");
    console.log("    Remote: https://backup.example.com");
    console.log("    IPFS:   https://gateway.ipfs.io/ipfs/Qm...");
    target = await ask("Enter the upstream URL", "http://localhost:3000");

    // Validate URL format
    try {
      new URL(target);
    } catch {
      ui.error(`Invalid URL: ${target}`);
      return;
    }
  }

  // Ask for port
  const portStr = await ask("HTTPS port to listen on", "443");
  const port = parseInt(portStr, 10) || 443;

  console.log();
  ui.divider();
  ui.info(`Domain:  ${ui.bold(domain)}`);
  ui.info(`Mode:    ${ui.bold(mode === "static" ? `static → ${target}` : `proxy → ${target}`)}`);
  ui.info(`Port:    ${ui.bold(String(port))}`);
  ui.divider();
  console.log();

  const proceed = await confirm("Proceed with the above configuration?");
  if (!proceed) {
    ui.info("Aborted.");
    return;
  }

  // Close readline BEFORE any system operations
  // so that sudo password prompt works correctly (hidden input)
  closePrompt();

  // Acquire sudo credentials once (password hidden properly in normal terminal mode)
  const hasSudo = await acquireSudo();
  if (!hasSudo) {
    ui.error("Cannot proceed without sudo privileges.");
    return;
  }

  // Step 3: Install mkcert & generate cert
  ui.step(3, TOTAL_STEPS, "Certificate Setup");
  let mkcertPath: string;
  try {
    mkcertPath = await ensureMkcert();
  } catch {
    ui.error("Cannot proceed without mkcert.");
    return;
  }

  await installRootCA(mkcertPath);
  await ensureStateDir();
  const { certPath, keyPath } = await generateCert(mkcertPath, domain);

  console.log();

  // Step 4: DNS & Hosts
  ui.step(4, TOTAL_STEPS, "DNS & Hosts Configuration");
  await flushDns();
  await addHostEntry(domain);

  console.log();

  // Save state before starting server
  const state: SessionState = {
    domain,
    mode,
    target,
    certPath,
    keyPath,
    port,
    startedAt: new Date().toISOString(),
  };
  await saveState(state);

  // Step 5: Start server
  ui.step(5, TOTAL_STEPS, "Starting HTTPS Server");

  await startServer({ domain, port, certPath, keyPath, mode, target });

  // Graceful shutdown on Ctrl+C
  const cleanup = async () => {
    console.log();
    ui.info("Shutting down...");
    stopServer();
    // Don't auto-clean on Ctrl+C — user should run "stop" command explicitly
    ui.warn("Session state preserved. Run 'passkeys-rescue stop' to fully clean up.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function cmdStop(showBanner = true) {
  if (showBanner) ui.banner();

  const state = await loadState();

  if (!state && !(await hasHostEntry())) {
    ui.info("No active session found. Nothing to clean up.");
    return;
  }

  // Ask user questions FIRST, before closing readline
  let shouldRemoveCA = false;
  if (showBanner) {
    shouldRemoveCA = await confirm(
      "Also remove mkcert root CA from system trust store? (recommended)",
      true
    );
    // Close readline before system operations
    closePrompt();

    // Acquire sudo
    const hasSudo = await acquireSudo();
    if (!hasSudo) {
      ui.error("Cannot proceed without sudo privileges.");
      return;
    }
  }

  ui.info("Cleaning up...");
  console.log();

  // 1. Remove hosts entry
  if (await hasHostEntry()) {
    await removeHostEntry();
  }

  // 2. Flush DNS
  await flushDns();

  // 3. Remove certificates
  if (state) {
    try {
      fs.unlinkSync(state.certPath);
      fs.unlinkSync(state.keyPath);
      ui.success("Removed generated certificates");
    } catch {}
  }

  // 4. Uninstall root CA if user agreed
  if (shouldRemoveCA) {
    await uninstallRootCA();
  }

  // 5. Clear state
  await clearState();

  console.log();
  ui.success("All passkeys-rescue changes have been reverted.");
  ui.info("Your system is back to its original state.");
  console.log();
}

async function cmdStatus() {
  ui.banner();

  const state = await loadState();
  if (!state) {
    ui.info("No active session.");
    return;
  }

  ui.info(`Domain:     ${ui.bold(state.domain)}`);
  ui.info(`Mode:       ${ui.bold(state.mode)}`);
  ui.info(`Target:     ${ui.bold(state.target)}`);
  ui.info(`Port:       ${ui.bold(String(state.port))}`);
  ui.info(`Started at: ${ui.bold(state.startedAt)}`);
  ui.info(`Cert:       ${state.certPath}`);

  const hostsActive = await hasHostEntry();
  ui.info(`Hosts:      ${hostsActive ? ui.green("active") : ui.red("inactive")}`);
}

function printHelp() {
  ui.banner();
  console.log("  Usage:");
  console.log(`    ${ui.bold("passkeys-rescue start")}   Interactive setup wizard`);
  console.log(`    ${ui.bold("passkeys-rescue stop")}    Clean up and restore system`);
  console.log(`    ${ui.bold("passkeys-rescue status")}  Show current session info`);
  console.log(`    ${ui.bold("passkeys-rescue help")}    Show this help`);
  console.log();
  console.log("  What it does:");
  console.log("    1. Installs a local CA via mkcert and generates a TLS cert for your domain");
  console.log("    2. Adds a hosts file entry pointing your domain to 127.0.0.1");
  console.log("    3. Flushes DNS cache");
  console.log("    4. Starts an HTTPS server (static files or reverse proxy)");
  console.log("    5. Your browser sees a valid HTTPS site → WebAuthn/Passkeys work");
  console.log();
  console.log("  After recovery:");
  console.log(`    Run ${ui.bold("passkeys-rescue stop")} to remove all changes (certs, hosts, CA).`);
  console.log();
}

// --- Main ---
const command = process.argv[2] || "help";

switch (command) {
  case "start":
    cmdStart().catch((e) => {
      ui.error(`Fatal: ${e.message || e}`);
      process.exit(1);
    });
    break;
  case "stop":
    cmdStop().catch((e) => {
      ui.error(`Fatal: ${e.message || e}`);
      process.exit(1);
    });
    break;
  case "status":
    cmdStatus().catch((e) => {
      ui.error(`Fatal: ${e.message || e}`);
      process.exit(1);
    });
    break;
  default:
    printHelp();
    break;
}
