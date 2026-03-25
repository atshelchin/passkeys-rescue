import { getHostsPath, getPlatform } from "./platform.ts";
import { ui } from "./ui.ts";

const MARKER_START = "# >>> passkeys-rescue";
const MARKER_END = "# <<< passkeys-rescue";

export async function addHostEntry(domain: string): Promise<void> {
  const hostsPath = getHostsPath();
  const entry = `127.0.0.1 ${domain}`;

  const content = await readHostsFile();

  // Check if already has our entry
  if (content.includes(MARKER_START)) {
    ui.warn("Hosts file already has a passkeys-rescue entry. Updating...");
    await removeHostEntry();
  }

  const addition = `\n${MARKER_START}\n${entry}\n${MARKER_END}\n`;

  const platform = getPlatform();
  if (platform === "windows") {
    const newContent = (await readHostsFile()) + addition;
    await Bun.write(hostsPath, newContent);
  } else {
    // Use sudo tee to append
    const proc = Bun.spawn(["sudo", "tee", "-a", hostsPath], {
      stdin: new Blob([addition]),
      stdout: "ignore",
      stderr: "inherit",
    });
    await proc.exited;
  }

  ui.success(`Added ${ui.bold(entry)} to hosts file`);
}

export async function removeHostEntry(): Promise<void> {
  const hostsPath = getHostsPath();

  const content = await readHostsFile();

  // Remove our marked section
  const regex = new RegExp(
    `\\n?${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
    "g"
  );
  const cleaned = content.replace(regex, "\n");

  const platform = getPlatform();
  if (platform === "windows") {
    await Bun.write(hostsPath, cleaned);
  } else {
    // Write to temp, then sudo cp
    const tmpFile = `/tmp/passkeys-rescue-hosts-${Date.now()}`;
    await Bun.write(tmpFile, cleaned);
    const proc = Bun.spawn(["sudo", "cp", tmpFile, hostsPath], {
      stdout: "ignore",
      stderr: "inherit",
      stdin: "inherit",
    });
    await proc.exited;

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(tmpFile); } catch {}
  }

  ui.success("Removed passkeys-rescue entries from hosts file");
}

export async function hasHostEntry(): Promise<boolean> {
  const content = await readHostsFile();
  return content.includes(MARKER_START);
}

async function readHostsFile(): Promise<string> {
  const hostsPath = getHostsPath();
  try {
    return await Bun.file(hostsPath).text();
  } catch {
    // Fallback: use cat
    const proc = Bun.spawn(["cat", hostsPath], { stdout: "pipe" });
    return await new Response(proc.stdout).text();
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
