import { $ } from "bun";

export type Platform = "macos" | "windows" | "linux";

export function getPlatform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

export function getHostsPath(): string {
  return getPlatform() === "windows"
    ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
    : "/etc/hosts";
}

export function isRoot(): boolean {
  if (getPlatform() === "windows") {
    // On Windows, check if running as admin is done differently
    // but for Bun CLI usage, we'll attempt and catch errors
    return true;
  }
  return process.getuid?.() === 0;
}

export async function ensureSudo(): Promise<string> {
  const platform = getPlatform();
  if (platform === "windows") return "";
  if (process.getuid?.() === 0) return "";
  return "sudo ";
}

/**
 * Pre-acquire sudo credentials before any system operations.
 * Must be called AFTER closing readline, so the terminal is in normal mode
 * and password input is properly hidden.
 */
export async function acquireSudo(): Promise<boolean> {
  const platform = getPlatform();
  if (platform === "windows") return true;
  if (process.getuid?.() === 0) return true;

  console.log();
  console.log("  \x1b[36mℹ\x1b[0m This tool needs sudo to modify hosts file and flush DNS.");
  console.log("  \x1b[36mℹ\x1b[0m You will be prompted for your password once.\n");

  const proc = Bun.spawn(["sudo", "-v"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.log("  \x1b[31m✘\x1b[0m Failed to acquire sudo privileges.");
    return false;
  }

  console.log("  \x1b[32m✔\x1b[0m Sudo credentials cached.\n");
  return true;
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const platform = getPlatform();
    if (platform === "windows") {
      const result = await $`where ${cmd}`.quiet();
      return result.exitCode === 0;
    } else {
      const result = await $`which ${cmd}`.quiet();
      return result.exitCode === 0;
    }
  } catch {
    return false;
  }
}
