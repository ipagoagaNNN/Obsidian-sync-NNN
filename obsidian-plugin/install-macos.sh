#!/usr/bin/env bash
# NNN HF Sync — macOS installer.
#
# Fetches the LATEST published release from GitHub, verifies file integrity
# via SHA256 hashes, then installs the plugin into the Obsidian vault you
# choose. Re-running this script = updating to the latest release.
#
# Defenses (Layer 1 — see docs/decisions/2026-05-22-adr-009-plugin-distribution.md):
#   - Repo URL is hardcoded — no parameters, no env vars (anti typo-squat)
#   - HTTPS enforced for the GitHub API + download calls
#   - $MIN_VERSION floor prevents rollback attacks
#   - SHA256SUMS downloaded alongside artifacts; every file is verified
#     against the published hash before it is copied into your vault
#   - manifest.json version is cross-checked against the GitHub Release tag
#
# Layer 2 (GPG-signed SHA256SUMS) is deferred to a future release — see ADR-009.
#
# Usage (from Terminal):
#   bash install-macos.sh
# Or make it executable:
#   chmod +x install-macos.sh && ./install-macos.sh

set -euo pipefail

# ─── Pinned configuration ─────────────────────────────────────────────────────
REPO_OWNER='ipagoagaNNN'
REPO_NAME='Obsidian-sync-NNN'
PLUGIN_ID='nnn-hf-sync'
MIN_VERSION='1.2.0'    # rollback floor — bump each major release

# ─── Banner ───────────────────────────────────────────────────────────────────
cat <<EOF

============================================================
  NNN HF Sync — plugin installer (macOS)
  Source: github.com/${REPO_OWNER}/${REPO_NAME}  (releases/latest)
  Integrity: SHA256 verification over HTTPS
============================================================
EOF

# Tool sanity-check
for bin in curl shasum python3; do
    if ! command -v "$bin" >/dev/null 2>&1; then
        echo "[ERROR] '$bin' is not on PATH — cannot proceed." >&2
        exit 1
    fi
done

# ─── Step 1: locate Obsidian vaults from obsidian.json ────────────────────────
OBSIDIAN_CFG="$HOME/Library/Application Support/obsidian/obsidian.json"
if [[ ! -f "$OBSIDIAN_CFG" ]]; then
    echo "[ERROR] Could not find Obsidian config at:" >&2
    echo "        $OBSIDIAN_CFG" >&2
    echo "Make sure Obsidian is installed and has been opened at least once." >&2
    exit 1
fi

VAULT_PATHS=$(python3 - <<'PYEOF'
import json, os
with open(f"{os.environ['HOME']}/Library/Application Support/obsidian/obsidian.json") as f:
    data = json.load(f)
for v in (data.get("vaults") or {}).values():
    path = v.get("path", "")
    if path:
        print(path)
PYEOF
)

if [[ -z "$VAULT_PATHS" ]]; then
    echo "[ERROR] No vaults found in Obsidian config." >&2
    echo "        Open Obsidian and create or open a vault first." >&2
    exit 1
fi

# Bash 3.2 compatible (macOS ships 3.2 by default).
VAULTS=()
while IFS= read -r line; do
    [[ -n "$line" ]] && VAULTS+=("$line")
done <<< "$VAULT_PATHS"
VAULT_COUNT=${#VAULTS[@]}

# ─── Step 2: vault picker ─────────────────────────────────────────────────────
echo ""
echo "Detected ${VAULT_COUNT} vault(s):"
for i in "${!VAULTS[@]}"; do
    echo "  [$((i+1))] ${VAULTS[$i]}"
done
echo ""

if (( VAULT_COUNT == 1 )); then
    TARGET_VAULT="${VAULTS[0]}"
    echo "Only one vault — installing into it."
else
    while true; do
        read -rp "Enter vault number (1-${VAULT_COUNT}): " CHOICE
        if [[ "$CHOICE" =~ ^[0-9]+$ ]] && (( CHOICE >= 1 && CHOICE <= VAULT_COUNT )); then
            TARGET_VAULT="${VAULTS[$((CHOICE-1))]}"
            break
        fi
        echo "Invalid choice. Try again."
    done
fi
PLUGIN_DIR="${TARGET_VAULT}/.obsidian/plugins/${PLUGIN_ID}"

# ─── Step 3: fetch latest release metadata ───────────────────────────────────
echo ""
echo "Querying GitHub for the latest release..."
API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
RELEASE_JSON=$(curl -fsSL \
    -H 'User-Agent: NNN-Sync-Installer' \
    -H 'Accept: application/vnd.github+json' \
    "$API_URL")

TAG_VERSION=$(python3 -c "import sys, json; d=json.load(sys.stdin); print(d['tag_name'].lstrip('v'))" <<< "$RELEASE_JSON")
echo "  Latest release: v${TAG_VERSION}"

# ─── Step 4: rollback / version floor check ──────────────────────────────────
version_lt() {
    # Returns 0 (true) if $1 < $2, using semver-ish numeric comparison.
    python3 -c "
import sys
def parts(v): return tuple(int(x) for x in v.split('.'))
sys.exit(0 if parts('$1') < parts('$2') else 1)
"
}
if version_lt "$TAG_VERSION" "$MIN_VERSION"; then
    echo "[ERROR] Refusing to install v${TAG_VERSION} — below pinned minimum v${MIN_VERSION}. Possible rollback. Aborting." >&2
    exit 1
fi

# ─── Step 5: download main.js, manifest.json, SHA256SUMS ─────────────────────
TMPDIR_INSTALL=$(mktemp -d -t nnn-sync-install)
trap 'rm -rf "$TMPDIR_INSTALL"' EXIT

asset_url() {
    # $1 = asset name. Returns its browser_download_url, or empty string.
    python3 -c "
import sys, json
d = json.load(sys.stdin)
for a in d.get('assets', []):
    if a.get('name') == '$1':
        print(a.get('browser_download_url', ''))
        sys.exit(0)
" <<< "$RELEASE_JSON"
}

for name in main.js manifest.json SHA256SUMS; do
    url=$(asset_url "$name")
    if [[ -z "$url" ]]; then
        echo "[ERROR] Release v${TAG_VERSION} is missing required asset '${name}'. Aborting." >&2
        exit 1
    fi
    echo "  Downloading ${name} ..."
    curl -fsSL -H 'User-Agent: NNN-Sync-Installer' "$url" -o "${TMPDIR_INSTALL}/${name}"
done

# ─── Step 6: SHA256 integrity verification ───────────────────────────────────
echo ""
echo "Verifying SHA256 hashes..."
for name in main.js manifest.json; do
    actual=$(shasum -a 256 "${TMPDIR_INSTALL}/${name}" | awk '{print $1}' | tr 'A-F' 'a-f')
    declared=$(awk -v f="$name" '$2 == f { print tolower($1); exit }' "${TMPDIR_INSTALL}/SHA256SUMS")
    if [[ -z "$declared" ]]; then
        echo "[ERROR] SHA256SUMS does not list a hash for ${name}." >&2
        exit 1
    fi
    if [[ "$actual" != "$declared" ]]; then
        echo "[ERROR] INTEGRITY CHECK FAILED for ${name}." >&2
        echo "  Expected SHA256: ${declared}" >&2
        echo "  Actual   SHA256: ${actual}" >&2
        echo "The file on GitHub may have been tampered with, or the download was corrupted." >&2
        echo "Aborting install. NOTHING has been written to your vault." >&2
        exit 1
    fi
    echo "  [OK] ${name}"
done

# ─── Step 7: cross-check manifest version against the release tag ────────────
MANIFEST_VERSION=$(python3 -c "import json,sys; print(json.load(open('${TMPDIR_INSTALL}/manifest.json'))['version'])")
if [[ "$MANIFEST_VERSION" != "$TAG_VERSION" ]]; then
    echo "[ERROR] manifest.json version (${MANIFEST_VERSION}) does not match release tag (v${TAG_VERSION}). Aborting." >&2
    exit 1
fi

# ─── Step 8: install ─────────────────────────────────────────────────────────
echo ""
echo "Installing to: ${PLUGIN_DIR}"
mkdir -p "$PLUGIN_DIR"
cp -f "${TMPDIR_INSTALL}/main.js"       "${PLUGIN_DIR}/main.js"
cp -f "${TMPDIR_INSTALL}/manifest.json" "${PLUGIN_DIR}/manifest.json"

# ─── Step 9: enable plugin in community-plugins.json ─────────────────────────
COMMUNITY_JSON="${TARGET_VAULT}/.obsidian/community-plugins.json"
python3 - "$COMMUNITY_JSON" "$PLUGIN_ID" <<'PYEOF'
import json, os, sys
path, plugin_id = sys.argv[1], sys.argv[2]
if os.path.exists(path):
    try:
        with open(path) as f:
            plugins = json.load(f)
    except json.JSONDecodeError:
        plugins = []
else:
    plugins = []
if not isinstance(plugins, list):
    plugins = [plugins] if plugins else []
if plugin_id not in plugins:
    plugins.append(plugin_id)
    with open(path, "w") as f:
        json.dump(plugins, f, indent=2)
    print(f"Enabled {plugin_id} in community-plugins.json")
else:
    print(f"{plugin_id} already listed in community-plugins.json")
PYEOF

# ─── Done ────────────────────────────────────────────────────────────────────
cat <<EOF

============================================================
  SUCCESS — NNN HF Sync v${TAG_VERSION} installed and enabled
============================================================

Next steps:
  1. Open Obsidian (or run 'Reload app without saving' from the Command Palette)
  2. Settings > Community plugins > 'NNN HF Sync' should be on
  3. Configure the plugin:
       Space URL  : https://ipagoaga-obsidian-sync.hf.space
       Username   : <your username>
       Password   : <your password or temp password>
       Document ID: nnn-vault   (alphanumeric + hyphens, no slashes)
  4. Click Connect

To update later: just re-run this installer — it always pulls the latest release.

EOF
