import * as path from "node:path";
import * as os from "node:os";

export interface SessionState {
  domain: string;
  mode: "static" | "proxy";
  target: string; // directory path or proxy URL
  certPath: string;
  keyPath: string;
  port: number;
  startedAt: string;
}

const STATE_DIR = path.join(os.homedir(), ".passkeys-rescue");
const STATE_FILE = path.join(STATE_DIR, "session.json");

export function getStateDir(): string {
  return STATE_DIR;
}

export async function ensureStateDir(): Promise<void> {
  const dir = Bun.file(STATE_DIR);
  try {
    await Bun.write(path.join(STATE_DIR, ".keep"), "");
  } catch {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(STATE_DIR, { recursive: true });
    await Bun.write(path.join(STATE_DIR, ".keep"), "");
  }
}

export async function saveState(state: SessionState): Promise<void> {
  await ensureStateDir();
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function loadState(): Promise<SessionState | null> {
  try {
    const file = Bun.file(STATE_FILE);
    if (await file.exists()) {
      return await file.json();
    }
  } catch {}
  return null;
}

export async function clearState(): Promise<void> {
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(STATE_FILE);
  } catch {}
}
