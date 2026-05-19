# NNN HF Sync — Obsidian Plugin

Real-time vault sync via y-sweet on a private Hugging Face Space.  
Version: **1.1.0** | Desktop only (Windows / macOS) | See ADR-008 for mobile plan.

---

## Verify your download

Make sure the zip contains these files before running the installer:

```
nnn-hf-sync-v1.1.0/
  main.js
  manifest.json
  install-windows.bat
  install-macos.sh
  README-user.md
```

---

## Installation — Windows

1. Unzip the folder anywhere (Desktop is fine).
2. Double-click **`install-windows.bat`**.
3. It will detect your Obsidian vaults and ask you to pick one.
4. Files are copied and the plugin is enabled automatically.
5. Open (or restart) Obsidian → Settings → Community Plugins → enable **NNN HF Sync**.

> Requires Obsidian to have been opened at least once (so the vault list exists).

---

## Installation — macOS

1. Unzip the folder anywhere.
2. Open **Terminal** (Spotlight → "Terminal").
3. Drag `install-macos.sh` into the Terminal window (this fills in the path), then press Enter.
   - Or: `cd` to the folder and run `bash install-macos.sh`
4. Pick your vault from the list.
5. Open (or restart) Obsidian → Settings → Community Plugins → enable **NNN HF Sync**.

> If macOS blocks the script ("cannot be opened because it is from an unidentified developer"):  
> Right-click `install-macos.sh` → Open With → Terminal.

---

## First-time configuration

After enabling the plugin in Obsidian:

Settings → NNN HF Sync:

| Field | Value |
|---|---|
| Space URL | `https://ipagoaga-obsidian-sync.hf.space` |
| Username | *(as given by your admin)* |
| Password | *(temp password from your admin — you'll be prompted to set a new one on first connect)* |
| Document ID | `nnn-vault` *(alphanumeric + hyphens only, no slashes)* |

Click **Connect**. On first login with a temp password, a dialog will prompt you to set a permanent password.

---

## Status bar

| Indicator | Meaning |
|---|---|
| ⬜ NNN Sync | Idle / disconnected |
| 🟡 NNN Sync | Connecting / handshaking |
| 🟢 NNN Sync | Connected and syncing |
| 🔴 NNN Sync | Connection error (auto-retrying) |

---

## Updating the plugin

When a new version is released, run the installer again — it overwrites the old files.  
The plugin directory and your settings are preserved.

---

## Troubleshooting

**"configure username and document ID before connecting"**  
→ Fill in Username and Document ID in settings first.

**"enter your password"**  
→ Your session expired. Enter your password again and click Connect.

**🔴 after connecting**  
→ Check the Space is running at `https://ipagoaga-obsidian-sync.hf.space/health`.  
→ Verify your username and Document ID match what your admin set up.

**Installer says "No vaults found"**  
→ Open Obsidian at least once to initialize the vault config, then re-run the installer.
