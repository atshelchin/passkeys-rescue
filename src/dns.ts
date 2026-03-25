import { getPlatform } from "./platform.ts";
import { ui } from "./ui.ts";

export async function flushDns(): Promise<void> {
  const platform = getPlatform();

  try {
    switch (platform) {
      case "macos": {
        const p1 = Bun.spawn(["sudo", "dscacheutil", "-flushcache"], {
          stdout: "ignore", stderr: "ignore", stdin: "inherit",
        });
        await p1.exited;
        const p2 = Bun.spawn(["sudo", "killall", "-HUP", "mDNSResponder"], {
          stdout: "ignore", stderr: "ignore", stdin: "inherit",
        });
        await p2.exited;
        break;
      }
      case "windows": {
        const p = Bun.spawn(["ipconfig", "/flushdns"], {
          stdout: "ignore", stderr: "ignore",
        });
        await p.exited;
        break;
      }
      case "linux": {
        // Try systemd-resolve, then resolvectl
        try {
          const p = Bun.spawn(["sudo", "systemd-resolve", "--flush-caches"], {
            stdout: "ignore", stderr: "ignore", stdin: "inherit",
          });
          const code = await p.exited;
          if (code !== 0) throw new Error();
        } catch {
          try {
            const p = Bun.spawn(["sudo", "resolvectl", "flush-caches"], {
              stdout: "ignore", stderr: "ignore", stdin: "inherit",
            });
            await p.exited;
          } catch {
            ui.warn("No DNS cache service found — may not be needed on this system");
            return;
          }
        }
        break;
      }
    }
    ui.success("DNS cache flushed");
  } catch {
    ui.warn("DNS flush may require elevated privileges. Run with sudo/admin.");
  }
}
