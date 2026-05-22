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

The **NNN HF Sync** plugin (`nnn-hf-sync`) is distributed as **integrity-verified GitHub Releases**. Each release page is the single source of truth — installers and plugin artifacts live side by side. The installer auto-downloads the latest plugin, verifies every file against the published SHA256 hashes, and installs into the Obsidian vault you choose. **Re-running the installer = updating.**

Threat model and integrity defenses are documented in [`docs/decisions/2026-05-22-adr-009-plugin-distribution.md`](docs/decisions/2026-05-22-adr-009-plugin-distribution.md).

### What's on each release page

Visit **<https://github.com/ipagoagaNNN/Obsidian-sync-NNN/releases/latest>**. You will see six assets attached to the latest release:

| File | Who downloads it | Purpose |
|---|---|---|
| `install-windows.bat` | Windows users | Double-click shim that launches the PowerShell installer |
| `install-windows.ps1` | Windows users | The actual installer logic |
| `install-macos.sh` | macOS users | bash installer (curl + shasum + python3) |
| `main.js` | (the installer downloads this) | Plugin code bundle |
| `manifest.json` | (the installer downloads this) | Plugin metadata |
| `SHA256SUMS` | (the installer downloads this) | Hash manifest used by the installer to verify integrity |

End users only ever click the two installer files for their platform. The installer takes care of the rest.

### Windows

1. Open the **[latest release page](https://github.com/ipagoagaNNN/Obsidian-sync-NNN/releases/latest)**.
2. Under **Assets**, download both `install-windows.bat` and `install-windows.ps1` into the same folder (e.g. `Downloads\`).
3. Double-click `install-windows.bat`. The installer will:
   - Detect your Obsidian vaults from `%APPDATA%\obsidian\obsidian.json`.
   - Let you pick one (auto-selects if only one exists).
   - Download `main.js`, `manifest.json`, and `SHA256SUMS` directly from the same release page over HTTPS.
   - Verify each file's SHA256 against the published manifest — aborts cleanly if anything fails to match.
   - Cross-check that `manifest.json`'s `version` field matches the GitHub Release tag.
   - Refuse to install any version below the installer's pinned `$MinVersion` (rollback protection).
   - Copy the plugin into `<vault>\.obsidian\plugins\nnn-hf-sync\` and enable it in `community-plugins.json`.
4. Reload Obsidian (`Ctrl+P` → "Reload app without saving") and configure the plugin (see below).

> **Updating:** just re-run `install-windows.bat`. It always pulls the latest release. You can leave the two installer files in `Downloads\` and re-use them.

### macOS

1. Open the **[latest release page](https://github.com/ipagoagaNNN/Obsidian-sync-NNN/releases/latest)**.
2. Under **Assets**, download `install-macos.sh`.
3. Open Terminal, `cd` into the folder containing the file, and run:
   ```bash
   bash install-macos.sh
   ```
4. The installer will detect vaults from `~/Library/Application Support/obsidian/obsidian.json`, let you pick one, download + verify the plugin from the same release page, then install.
5. Reload Obsidian and configure (see below).

> **First time on macOS:** Gatekeeper may quarantine the downloaded script. If `bash install-macos.sh` reports *"Operation not permitted"* or refuses to run, clear the quarantine flag with:
> ```bash
> xattr -d com.apple.quarantine install-macos.sh
> ```
> Then re-run.

> **Updating:** re-run `bash install-macos.sh` — it pulls the latest release every time.

### First-run configuration

After the installer reports success, reload Obsidian and open **Settings → Community plugins → NNN HF Sync → Options**:

| Setting | Value |
|---|---|
| **Space URL** | `https://ipagoaga-obsidian-sync.hf.space` |
| **Username** | Your auth-server username |
| **Password** | Your password (or temp password if first login — a modal will prompt you to set a permanent one) |
| **Document ID** | Shared vault identifier (e.g. `nnn-vault`, alphanumeric + hyphens, no slashes) |

Click **Connect**. Status bar should show 🟡 → 🟢 within a few seconds. The plugin will pull the shared vault state and create any missing files locally — your vault becomes a live mirror of the shared workspace.

### What the installer protects against

| Threat | Mitigation |
|---|---|
| Tampering in transit (CDN, ISP, hotel wifi) | HTTPS + SHA256 hash check |
| Corrupted / partial download | SHA256 hash check |
| Typo-squatted repo URL | Repo owner + name hardcoded in installer source |
| Rollback to a known-vulnerable version | `$MinVersion` floor pinned in installer |
| Asset shuffling between tag and build | manifest.json version cross-checked against the GitHub Release tag |

Higher-tier defenses against a fully compromised GitHub account (GPG signing of `SHA256SUMS`) are deferred to Phase 9b — see ADR-009.

---

## Phases

- **Phase 1** ✅ Accounts & prerequisites (Neon, HF Spaces, secrets)
- **Phase 2** ✅ Headscale Space — deployed `obsidian-headscale`
- **Phase 3** ✅ y-sweet + Go auth server Space — deployed `obsidian-sync`, auth + ACL + admin UI live
- **Phase 4** ✅ Obsidian plugin — vault sync (4c) + live co-editing (4d) shipped in v1.2.0
- **Phase 5** ✅ Cloudflare R2 — y-sweet persists snapshots; cross-vault sync verified
- **Phase 7** ✅ Admin Console expansion + ACL enforcement
- **Phase 8** 🔄 Observability & hardening (UptimeRobot, structured logs, Resend email)
- **Phase 9** 🔄 Distribution — installer scripts shipped (9a); GPG signing deferred (9b)

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
