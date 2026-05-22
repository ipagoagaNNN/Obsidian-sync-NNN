# NNN-HF-ObsidianVault

Self-hosted Obsidian real-time collaboration stack on Hugging Face Spaces.

## Architecture

| Component | HF Space | Purpose |
|---|---|---|
| y-sweet + Go auth server | `obsidian-sync` | CRDT document sync + token issuance |
| Headscale | `obsidian-headscale` | WireGuard mesh coordination (persisted to Neon.tech) |
| Neon.tech (external) | — | PostgreSQL for auth + Headscale node state |
| Obsidian plugin | local install | Custom TypeScript plugin (Phase 4) |

## Directory layout

```
NNN-HF-Obsidian/
  obsidian-sync/          ← HF Space repo: y-sweet + Go auth server (canonical)
  obsidian-headscale/     ← HF Space repo: Headscale WireGuard coordinator (canonical)
  my-nnn-hf-obsidian/     ← Local monorepo (not a HF Space)
    headscale/            ← Source files for obsidian-headscale Space
    obsidian-plugin/      ← Custom Obsidian plugin (TypeScript, local install)
      src/main.ts
      main.js             ← Built output, installed into vault
      manifest.json
```

> **Rule:** Never edit `obsidian-sync/` or `obsidian-headscale/` directly.
> They are HF Space git clones — work in the source directories and push via git.

---

## Plugin installation

The **NNN HF Sync** plugin (`nnn-hf-sync`) is distributed as signed-integrity GitHub Releases. The installer scripts auto-download the latest version, verify SHA256 hashes against the published `SHA256SUMS`, and install into the Obsidian vault you choose. **Re-running the installer = updating.**

Threat model and integrity defenses are documented in [`docs/decisions/2026-05-22-adr-009-plugin-distribution.md`](docs/decisions/2026-05-22-adr-009-plugin-distribution.md).

### Windows

1. Go to **[Releases](https://github.com/ipagoagaNNN/Obsidian-sync-NNN/releases/latest)** and download `install-windows.bat` and `install-windows.ps1` (both files).
2. Put them in the same folder.
3. Double-click `install-windows.bat`. The installer will:
   - Detect your Obsidian vaults from `obsidian.json`.
   - Let you pick one (auto-selects if only one exists).
   - Download `main.js`, `manifest.json`, and `SHA256SUMS` from the latest release.
   - Verify SHA256 hashes against the published values — aborts if any file is tampered.
   - Install into `<vault>/.obsidian/plugins/nnn-hf-sync/` and enable in `community-plugins.json`.
4. Reload Obsidian (`Ctrl+P` → "Reload app without saving") and configure the plugin (see below).

> **Updating:** Just re-run `install-windows.bat`. It always pulls the latest release.

### macOS

1. Go to **[Releases](https://github.com/ipagoagaNNN/Obsidian-sync-NNN/releases/latest)** and download `install-macos.sh`.
2. Open Terminal, `cd` into the folder containing the file, and run:
   ```bash
   bash install-macos.sh
   ```
3. The installer will detect vaults, pick one (auto if only one), download + verify hashes, then install.
4. Reload Obsidian and configure (see below).

> **First-time install on macOS:** Gatekeeper may quarantine the downloaded file. If `bash install-macos.sh` reports "Operation not permitted", clear the quarantine flag with:
> ```bash
> xattr -d com.apple.quarantine install-macos.sh
> ```

> **Updating:** Re-run `bash install-macos.sh`.

### First-run configuration

After the installer reports success, reload Obsidian and open **Settings → Community plugins → NNN HF Sync → Options**:

| Setting | Value |
|---|---|
| **Space URL** | `https://ipagoaga-obsidian-sync.hf.space` |
| **Username** | Your auth-server username |
| **Password** | Your password (or temp password if first login — a modal will prompt you to set a permanent one) |
| **Document ID** | Vault identifier (e.g. `nnn-vault`, alphanumeric + hyphens, no slashes) |

Click **Connect**. Status bar should show 🟡 → 🟢 within a few seconds. The plugin will pull the shared vault state and create any missing files locally.

### What the installer protects against

| Threat | Mitigation |
|---|---|
| Tampering in transit (CDN, ISP, hotel wifi) | HTTPS + SHA256 hash check |
| Corrupted / partial download | SHA256 hash check |
| Typo-squatted repo URL | Repo URL hardcoded in installer source |
| Rollback to a known-vulnerable version | `$MinVersion` floor pinned in installer |

Higher-tier defenses against a fully compromised GitHub account (GPG signing of `SHA256SUMS`) are deferred — see ADR-009.

---

## Phases

- **Phase 1** ✅ Accounts & prerequisites (Neon, HF Spaces, secrets)
- **Phase 2** ✅ Headscale Space — deployed `obsidian-headscale`
- **Phase 3** ✅ y-sweet + Go auth server Space — deployed `obsidian-sync`, auth working, 200 confirmed
- **Phase 4** 🔄 Obsidian plugin — custom TypeScript plugin in `obsidian-plugin/`
- **Phase 5** ⬜ R2 storage — configure Cloudflare R2 for y-sweet persistence

## HF Space secrets

### obsidian-sync

| Secret | Purpose |
|---|---|
| `YSWEET_PRIVATE_KEY` | y-sweet `--auth` flag (private key from `gen-auth --json`) |
| `YSWEET_SERVER_TOKEN` | auth-server Bearer token (server_token from same keypair) |
| `NEON_HOST` | Neon postgres host |
| `NEON_AUTH_PASS` | Password for the `auth_server` Neon role |
| `ADMIN_JWT_SECRET` | 64-char secret for signing admin JWTs |
| `PUBLIC_URL` | Public Space URL (e.g. `https://ipagoaga-obsidian-sync.hf.space`) |

### obsidian-headscale

| Secret | Purpose |
|---|---|
| `HEADSCALE_DB_PASS` | Neon postgres password for Headscale node state |

## Auth endpoints (obsidian-sync)

```
POST /token   { "username":"…", "password":"…", "docId":"…" }
              → { "clientToken":{…}, "role":"editor", "pathAcls":[…] }
GET  /health  → { "status":"ok", "version":"0.8.0" }

# Admin (X-Admin-Token: <jwt>)
GET    /admin/users
POST   /admin/users   { "username":"…", "password":"…", "role":"editor" }
PATCH  /admin/users/:id
DELETE /admin/users/:id
GET    /admin/audit
```

See `decisions/` in the Obsidian vault for full ADRs.
