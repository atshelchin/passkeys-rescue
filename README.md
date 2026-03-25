# passkeys-rescue

Rescue your passkeys when your domain is lost.

When a domain becomes unavailable (expired, seized, or lost), passkeys (WebAuthn credentials) bound to that domain become inaccessible. **passkeys-rescue** creates a local domain mirror with valid HTTPS, allowing your browser to recognize the original domain and unlock your passkeys — so you can recover access to crypto wallets, sign Ethereum transactions, and more.

## How it works

1. Auto-downloads [mkcert](https://github.com/FiloSottile/mkcert) (no manual install needed), generates a trusted local CA and TLS certificate for your domain
2. Adds a hosts file entry pointing the domain to `127.0.0.1`
3. Flushes the system DNS cache
4. Starts an HTTPS server (static files or reverse proxy to local/remote service)
5. Your browser sees a valid HTTPS site on the original domain — WebAuthn/Passkeys work as expected

## Requirements

- [Bun](https://bun.sh) runtime (or use the [compiled binary from Releases](https://github.com/user/passkeys-rescue/releases))
- Admin/sudo privileges (for hosts file and CA trust store)
- mkcert is **auto-downloaded** — no manual install required

## Install

```bash
bun install
```

## Usage

### Start a recovery session

```bash
bun run src/index.ts start
```

The interactive wizard will guide you through:

```
? Enter the domain to recover (e.g., wallet.example.com): wallet.abc.com
? How do you want to serve the site?
    1) Static files — serve from a local directory
    2) Reverse proxy — forward to a local or remote service
? HTTPS port to listen on (443): 443
```

### Check session status

```bash
bun run src/index.ts status
```

### Stop and clean up

```bash
bun run src/index.ts stop
```

This removes all changes: certificates, hosts entries, DNS cache, root CA from trust store, and CA files from disk.

## Compile to standalone binary

No Bun runtime needed on the target machine:

```bash
# Current platform
bun run build

# All platforms
bun run build:all
```

Or build individually:

```bash
bun run build:darwin-arm64    # macOS Apple Silicon
bun run build:darwin-x64      # macOS Intel
bun run build:linux-x64       # Linux x64
bun run build:linux-arm64     # Linux ARM64
bun run build:windows         # Windows x64
```

## Supported platforms

| Platform | DNS flush | Hosts file | mkcert |
|---|---|---|---|
| macOS | `dscacheutil` + `mDNSResponder` | `/etc/hosts` | Auto-download |
| Windows | `ipconfig /flushdns` | `C:\Windows\System32\drivers\etc\hosts` | Auto-download |
| Linux (Ubuntu/Debian/Arch) | `systemd-resolve` / `resolvectl` | `/etc/hosts` | Auto-download |

## Root CA certificate locations

When `passkeys-rescue start` runs, mkcert creates a root CA and installs it into the system trust store. Understanding where these are stored helps you verify cleanup.

### CA file storage (on disk)

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/mkcert/` |
| Windows | `%LOCALAPPDATA%\mkcert\` |
| Linux | `~/.local/share/mkcert/` (or `$XDG_DATA_HOME/mkcert/`) |

Files: `rootCA.pem` (certificate) and `rootCA-key.pem` (private key)

### CA trust store (system-level)

| Platform | Trust store location | How to verify |
|---|---|---|
| macOS | System Keychain (`/Library/Keychains/System.keychain`) | Open **Keychain Access** app, search `mkcert` in **System** keychain |
| Windows | Certificate Manager (Trusted Root CAs) | Run `certmgr.msc`, navigate to **Trusted Root Certification Authorities > Certificates**, look for `mkcert` |
| Linux | `/usr/local/share/ca-certificates/` or `/etc/pki/ca-trust/source/anchors/` | Run `trust list \| grep mkcert` or check the directories above |

### What `passkeys-rescue stop` cleans up

1. Removes root CA from system trust store (`mkcert -uninstall`)
2. Deletes `rootCA.pem` and `rootCA-key.pem` from disk
3. Deletes the generated domain certificate and key
4. Removes `hosts` file entry
5. Flushes DNS cache

## Security warning

This tool installs a local root CA and modifies your hosts file. **A root CA can be used to forge any HTTPS certificate**, so it is critical to clean up after use.

1. **Always run `passkeys-rescue stop`** after recovering your passkeys
2. Verify cleanup: check the trust store locations above to confirm the CA is gone
3. Never share or reuse the generated root CA
4. Never run this tool on a machine you don't fully control

## Project structure

```
src/
  index.ts      — CLI entry, command routing, interactive wizard
  ui.ts         — Terminal UI (colors, prompts)
  platform.ts   — Cross-platform detection (macOS/Windows/Linux)
  dns.ts        — DNS cache flush
  hosts.ts      — Hosts file management (marked sections, safe rollback)
  cert.ts       — mkcert auto-download / cert generation / root CA management
  server.ts     — HTTPS server (static files + reverse proxy)
  state.ts      — Session state persistence (~/.passkeys-rescue/)
```

## License

MIT
