#!/usr/bin/env bash
# NNN HF Sync — Plugin Installer for macOS
# Version 1.1.0
#
# Usage: double-click in Finder (open with Terminal) or run from terminal:
#   bash install-macos.sh

set -euo pipefail

PLUGIN_ID="nnn-hf-sync"
PLUGIN_VERSION="1.1.0"

echo ""
echo "============================================================"
echo "  NNN HF Sync Plugin Installer for macOS"
echo "  Version ${PLUGIN_VERSION}"
echo "============================================================"
echo ""

# ── Locate Obsidian vault list ────────────────────────────────────────────────
OBSIDIAN_CFG="$HOME/Library/Application Support/obsidian/obsidian.json"

if [[ ! -f "$OBSIDIAN_CFG" ]]; then
    echo "[ERROR] Could not find Obsidian config at:"
    echo "        $OBSIDIAN_CFG"
    echo ""
    echo "Make sure Obsidian is installed and has been opened at least once."
    exit 1
fi

# Parse vault paths using Python (available on all macOS versions)
VAULT_PATHS=$(python3 - <<'PYEOF'
import json, sys
with open(f"{__import__('os').environ['HOME']}/Library/Application Support/obsidian/obsidian.json") as f:
    data = json.load(f)
vaults = data.get("vaults", {})
for v in vaults.values():
    path = v.get("path", "")
    if path:
        print(path)
PYEOF
)

if [[ -z "$VAULT_PATHS" ]]; then
    echo "[ERROR] No vaults found in Obsidian config."
    echo "        Open Obsidian and create or open a vault first."
    exit 1
fi

# Build indexed array (bash 3.2 compatible — no mapfile)
VAULTS=()
while IFS= read -r line; do
    [[ -n "$line" ]] && VAULTS+=("$line")
done <<< "$VAULT_PATHS"
VAULT_COUNT=${#VAULTS[@]}

# ── Show vault list and let user pick ────────────────────────────────────────
echo "Found ${VAULT_COUNT} vault(s):"
echo ""
for i in "${!VAULTS[@]}"; do
    echo "  [$((i+1))] ${VAULTS[$i]}"
done
echo ""

# Auto-select if only one vault
if (( VAULT_COUNT == 1 )); then
    echo "Only one vault found — installing automatically."
    TARGET_VAULT="${VAULTS[0]}"
else
    while true; do
        read -rp "Enter vault number to install into (1-${VAULT_COUNT}): " CHOICE
        if [[ "$CHOICE" =~ ^[0-9]+$ ]] && (( CHOICE >= 1 && CHOICE <= VAULT_COUNT )); then
            TARGET_VAULT="${VAULTS[$((CHOICE-1))]}"
            break
        fi
        echo "Invalid choice. Please enter a number between 1 and ${VAULT_COUNT}."
    done
fi

# ── Install ───────────────────────────────────────────────────────────────────
PLUGIN_DIR="${TARGET_VAULT}/.obsidian/plugins/${PLUGIN_ID}"

echo ""
echo "Installing to:"
echo "  ${PLUGIN_DIR}"
echo ""

# Create plugin directory
mkdir -p "$PLUGIN_DIR"

# Source files live next to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${SCRIPT_DIR}/main.js" ]]; then
    echo "[ERROR] main.js not found next to install-macos.sh"
    echo "        Expected: ${SCRIPT_DIR}/main.js"
    exit 1
fi
if [[ ! -f "${SCRIPT_DIR}/manifest.json" ]]; then
    echo "[ERROR] manifest.json not found next to install-macos.sh"
    echo "        Expected: ${SCRIPT_DIR}/manifest.json"
    exit 1
fi

# Copy plugin files
cp -f "${SCRIPT_DIR}/main.js"       "${PLUGIN_DIR}/main.js"
cp -f "${SCRIPT_DIR}/manifest.json" "${PLUGIN_DIR}/manifest.json"

# ── Enable plugin in community-plugins.json ───────────────────────────────────
COMMUNITY_JSON="${TARGET_VAULT}/.obsidian/community-plugins.json"

python3 - <<PYEOF
import json, os

path = "${COMMUNITY_JSON}"
if os.path.exists(path):
    with open(path) as f:
        plugins = json.load(f)
else:
    plugins = []

if "${PLUGIN_ID}" not in plugins:
    plugins.append("${PLUGIN_ID}")
    with open(path, "w") as f:
        json.dump(plugins, f, indent=2)
    print("Plugin enabled in community-plugins.json")
else:
    print("Plugin already listed in community-plugins.json")
PYEOF

echo ""
echo "============================================================"
echo "  SUCCESS — Plugin installed!"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Open Obsidian"
echo "  2. Settings > Community Plugins > enable \"NNN HF Sync\""
echo "     (If Obsidian was open, restart it first)"
echo "  3. Configure the plugin:"
echo "       Space URL  : https://ipagoaga-obsidian-sync.hf.space"
echo "       Username   : <your username>"
echo "       Password   : <your password / temp password>"
echo "       Document ID: nnn-vault  (alphanumeric+hyphens only, no slashes)"
echo "  4. Click Connect"
echo ""
