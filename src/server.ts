import * as path from "node:path";
import { ui } from "./ui.ts";

interface ServerOptions {
  domain: string;
  port: number;
  certPath: string;
  keyPath: string;
  mode: "static" | "proxy";
  target: string;
}

let serverInstance: ReturnType<typeof Bun.serve> | null = null;

export async function startServer(opts: ServerOptions): Promise<void> {
  const { domain, port, certPath, keyPath, mode, target } = opts;

  const tls = {
    cert: Bun.file(certPath),
    key: Bun.file(keyPath),
  };

  if (mode === "static") {
    serverInstance = Bun.serve({
      port,
      tls,
      async fetch(req) {
        const url = new URL(req.url);
        let filePath = path.join(target, url.pathname);

        // Default to index.html
        if (url.pathname === "/" || url.pathname.endsWith("/")) {
          filePath = path.join(filePath, "index.html");
        }

        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }

        // SPA fallback: try index.html at root
        const indexFile = Bun.file(path.join(target, "index.html"));
        if (await indexFile.exists()) {
          return new Response(indexFile);
        }

        return new Response("Not Found", { status: 404 });
      },
    });
  } else {
    // Reverse proxy mode (supports local and remote upstreams)
    const upstreamUrl = new URL(target);
    const isLocalUpstream = ["localhost", "127.0.0.1", "[::1]"].includes(upstreamUrl.hostname);

    serverInstance = Bun.serve({
      port,
      tls,
      async fetch(req) {
        const url = new URL(req.url);
        // Strip trailing slash from target to avoid double slashes
        const base = target.replace(/\/$/, "");
        const proxyUrl = `${base}${url.pathname}${url.search}`;

        try {
          const headers = new Headers(req.headers);
          // For remote upstreams, set Host to upstream's host so it routes correctly
          // For local upstreams, set Host to the original domain for apps that check it
          headers.set("Host", isLocalUpstream ? domain : upstreamUrl.host);
          headers.set("X-Forwarded-Host", domain);
          headers.set("X-Forwarded-Proto", "https");
          headers.set("X-Forwarded-For", "127.0.0.1");
          // Remove headers that might cause issues with upstream
          headers.delete("sec-fetch-dest");
          headers.delete("sec-fetch-mode");
          headers.delete("sec-fetch-site");

          const proxyReq = new Request(proxyUrl, {
            method: req.method,
            headers,
            body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
            redirect: "manual", // Don't auto-follow redirects, pass them to client
          });

          const resp = await fetch(proxyReq);

          // Copy response headers, rewrite Location header for redirects
          const respHeaders = new Headers(resp.headers);
          const location = respHeaders.get("location");
          if (location) {
            try {
              const locUrl = new URL(location, target);
              if (locUrl.host === upstreamUrl.host) {
                locUrl.host = domain;
                locUrl.protocol = "https:";
                locUrl.port = port === 443 ? "" : String(port);
                respHeaders.set("location", locUrl.toString());
              }
            } catch {}
          }

          return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers: respHeaders,
          });
        } catch (e) {
          return new Response(`Proxy error: ${e}`, { status: 502 });
        }
      },
    });
  }

  console.log();
  ui.success(`HTTPS server running on port ${port}`);
  console.log();
  console.log(`  ${ui.bold(ui.green(`https://${domain}${port === 443 ? "" : `:${port}`}`))}`)
  console.log();
  ui.info(`Mode: ${mode === "static" ? `Static files from ${target}` : `Proxy to ${target}`}`);
  console.log();
  ui.divider();
  ui.warn("SECURITY REMINDER:");
  ui.info("After recovering your passkeys, run:");
  console.log(`    ${ui.bold("passkeys-rescue stop")}`);
  ui.info("This will remove the root CA and restore your hosts file.");
  ui.divider();
  console.log();
  ui.dim("Press Ctrl+C to stop the server...");
  console.log();
}

export function stopServer(): void {
  if (serverInstance) {
    serverInstance.stop(true);
    serverInstance = null;
    ui.success("HTTPS server stopped");
  }
}
