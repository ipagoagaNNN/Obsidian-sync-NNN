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

## Plugin installation (local, manual)

The **NNN HF Sync** plugin (`nnn-hf-sync`) is not in the Obsidian Community Plugins registry — it must be installed manually into your vault's local plugins folder.

### Files required

From `my-nnn-hf-obsidian/obsidian-plugin/`:

| File | Required |
|---|---|
| `main.js` | ✅ Yes |
| `manifest.json` | ✅ Yes |
| `styles.css` | Only if present |

---

### Windows

1. Open **File Explorer** and navigate to your vault root folder.
2. Enable hidden files: **View → Show → Hidden items**.
3. Open the folder `.obsidian\plugins\` inside your vault.
4. Create a new folder named exactly `nnn-hf-sync`.
5. Copy `main.js` and `manifest.json` into that new folder.
6. Restart Obsidian, or go to **Settings → Community plugins → Reload plugins**.
7. Enable **NNN HF Sync** under **Settings → Community plugins → Installed plugins**.

> **PowerShell shortcut** (run from the `obsidian-plugin/` directory):
> ```powershell
> $vault = "C:\path\to\your\vault"
> $dest  = "$vault\.obsidian\plugins\nnn-hf-sync"
> New-Item -ItemType Directory -Force $dest
> Copy-Item main.js, manifest.json -Destination $dest
> ```

---

### macOS

1. Open **Finder** and navigate to your vault root folder.
2. Press **⌘ Shift .** to toggle hidden files visible.
3. Open the folder `.obsidian/plugins/` inside your vault.
4. Create a new folder named exactly `nnn-hf-sync`.
5. Copy `main.js` and `manifest.json` into that new folder.
6. Restart Obsidian, or go to **Settings → Community plugins → Reload plugins**.
7. Enable **NNN HF Sync** under **Settings → Community plugins → Installed plugins**.

> **Terminal shortcut** (run from the `obsidian-plugin/` directory):
> ```bash
> VAULT="/path/to/your/vault"
> DEST="$VAULT/.obsidian/plugins/nnn-hf-sync"
> mkdir -p "$DEST"
> cp main.js manifest.json "$DEST/"
> ```

---

### First-run configuration

After enabling the plugin, open **Settings → NNN HF Sync** and fill in:

| Setting | Value |
|---|---|
| **Auth server URL** | Your `obsidian-sync` HF Space URL (e.g. `https://yourname-obsidian-sync.hf.space`) |
| **Username** | Your auth-server username |
| **Password** | Your auth-server password |
| **Doc ID** | Shared document identifier (e.g. `main`) |

> The plugin will request a y-sweet client token from the auth server on startup and begin syncing automatically.

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
