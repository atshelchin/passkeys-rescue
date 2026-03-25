import { getPlatform, commandExists } from "./platform.ts";
import { ui } from "./ui.ts";
import { getStateDir } from "./state.ts";
import * as path from "node:path";
import * as fs from "node:fs";

const MKCERT_VERSION = "v1.4.4";
const MKCERT_BASE_URL = `https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}`;

// mkcert binary path managed by passkeys-rescue
function getMkcertDir(): string {
  return path.join(getStateDir(), "bin");
}

function getMkcertPath(): string {
  const platform = getPlatform();
  const ext = platform === "windows" ? ".exe" : "";
  return path.join(getMkcertDir(), `mkcert${ext}`);
}

function getMkcertDownloadUrl(): string {
  const platform = getPlatform();
  const arch = process.arch; // "x64" | "arm64" etc.

  let os: string;
  let archStr: string;

  switch (platform) {
    case "macos":
      os = "darwin";
      archStr = arch === "arm64" ? "arm64" : "amd64";
      break;
    case "windows":
      os = "windows";
      archStr = "amd64";
      break;
    case "linux":
      os = "linux";
      archStr = arch === "arm64" ? "arm64" : "amd64";
      break;
  }

  const ext = platform === "windows" ? ".exe" : "";
  return `${MKCERT_BASE_URL}/mkcert-${MKCERT_VERSION}-${os}-${archStr}${ext}`;
}

/** Find mkcert: check our bundled path first, then system PATH */
async function findMkcert(): Promise<string | null> {
  const bundledPath = getMkcertPath();
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }
  if (await commandExists("mkcert")) {
    return "mkcert";
  }
  return null;
}

/** Download mkcert binary directly from GitHub releases */
async function downloadMkcert(): Promise<string> {
  const url = getMkcertDownloadUrl();
  const dest = getMkcertPath();
  const dir = getMkcertDir();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  ui.info(`Downloading mkcert from GitHub...`);
  ui.dim(`  ${url}`);

  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(`Download failed: HTTP ${resp.status} ${resp.statusText}`);
  }

  const buffer = await resp.arrayBuffer();
  await Bun.write(dest, buffer);

  // Make executable on Unix
  if (getPlatform() !== "windows") {
    fs.chmodSync(dest, 0o755);
  }

  ui.success(`mkcert downloaded to ${dest}`);
  return dest;
}

export async function ensureMkcert(): Promise<string> {
  // 1. Check if already available
  const existing = await findMkcert();
  if (existing) {
    ui.success(`mkcert found: ${existing}`);
    return existing;
  }

  // 2. Auto-download from GitHub
  ui.info("mkcert not found. Downloading automatically...");
  try {
    return await downloadMkcert();
  } catch (e) {
    ui.error(`Auto-download failed: ${e}`);
    ui.info("You can also install mkcert manually:");
    const platform = getPlatform();
    switch (platform) {
      case "macos":
        ui.info("  brew install mkcert");
        break;
      case "windows":
        ui.info("  choco install mkcert  OR  scoop install mkcert  OR  winget install FiloSottile.mkcert");
        break;
      case "linux":
        ui.info("  apt install mkcert  OR  pacman -S mkcert");
        break;
    }
    throw new Error("mkcert is required but could not be obtained");
  }
}

export async function installRootCA(mkcert: string): Promise<void> {
  ui.info("Installing mkcert root CA into system trust store...");
  try {
    const proc = Bun.spawn([mkcert, "-install"], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    await proc.exited;
    ui.success("Root CA installed and trusted by system");
  } catch (e) {
    ui.error(`Failed to install root CA: ${e}`);
    throw e;
  }
}

export async function generateCert(
  mkcert: string,
  domain: string
): Promise<{ certPath: string; keyPath: string }> {
  const stateDir = getStateDir();
  const certPath = path.join(stateDir, `${domain}.pem`);
  const keyPath = path.join(stateDir, `${domain}-key.pem`);

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    ui.success(`Certificate for ${domain} already exists`);
    return { certPath, keyPath };
  }

  ui.info(`Generating TLS certificate for ${ui.bold(domain)}...`);

  const proc = Bun.spawn(
    [mkcert, "-cert-file", certPath, "-key-file", keyPath, domain],
    { stdout: "inherit", stderr: "inherit" }
  );
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`mkcert failed with exit code ${exitCode}`);
  }

  ui.success(`Certificate generated: ${certPath}`);
  return { certPath, keyPath };
}

export async function uninstallRootCA(): Promise<void> {
  const mkcert = await findMkcert();
  if (!mkcert) {
    ui.warn("mkcert not found, skipping trust store cleanup");
    await deleteCAFiles();
    return;
  }

  ui.info("Removing root CA from system trust store...");
  try {
    const proc = Bun.spawn([mkcert, "-uninstall"], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    await proc.exited;
    ui.success("Root CA removed from system trust store");
  } catch (e) {
    ui.warn(`Could not uninstall root CA: ${e}`);
  }

  await deleteCAFiles();
}

async function deleteCAFiles(): Promise<void> {
  const caRoot = await getCARoot();
  if (!caRoot) return;

  const files = [
    path.join(caRoot, "rootCA.pem"),
    path.join(caRoot, "rootCA-key.pem"),
  ];

  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        ui.success(`Deleted CA file: ${file}`);
      }
    } catch {
      ui.warn(`Could not delete ${file} — please remove it manually`);
    }
  }
}

async function getCARoot(): Promise<string | null> {
  const mkcert = await findMkcert();
  if (mkcert) {
    try {
      const proc = Bun.spawn([mkcert, "-CAROOT"], { stdout: "pipe" });
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      const dir = output.trim();
      if (dir) return dir;
    } catch {}
  }

  // Fallback: known default paths
  const platform = getPlatform();
  const home = process.env.HOME || process.env.USERPROFILE || "";
  switch (platform) {
    case "macos":
      return path.join(home, "Library", "Application Support", "mkcert");
    case "windows":
      return path.join(
        process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
        "mkcert"
      );
    case "linux":
      return path.join(
        process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
        "mkcert"
      );
  }
}
