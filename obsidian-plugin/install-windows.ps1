# NNN HF Sync — Windows installer (PowerShell 5.1+).
#
# Fetches the LATEST published release from GitHub, verifies file integrity
# via SHA256 hashes, then installs the plugin into the Obsidian vault you
# choose. Re-running this script = updating to the latest release.
#
# Defenses (Layer 1 — see docs/decisions/2026-05-22-adr-009-plugin-distribution.md):
#   - Repo URL is hardcoded — no parameters, no env vars (anti typo-squat)
#   - TLS 1.2 enforced for the GitHub API + download calls
#   - $MinVersion floor prevents rollback attacks
#   - SHA256SUMS downloaded alongside artifacts; every file is verified
#     against the published hash before it is copied into your vault
#   - manifest.json version is cross-checked against the GitHub Release tag
#
# Layer 2 (GPG-signed SHA256SUMS) is deferred to a future release — see ADR-009.

#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

# ─── Pinned configuration ─────────────────────────────────────────────────────
$RepoOwner  = 'ipagoagaNNN'
$RepoName   = 'Obsidian-sync-NNN'
$PluginId   = 'nnn-hf-sync'
$MinVersion = '1.2.0'   # rollback floor — bump this each major release

# ─── Banner ───────────────────────────────────────────────────────────────────
$banner = @"

============================================================
  NNN HF Sync — plugin installer (Windows)
  Source: github.com/$RepoOwner/$RepoName  (releases/latest)
  Integrity: SHA256 verification over HTTPS
============================================================
"@
Write-Host $banner

# Force TLS 1.2 for older PowerShell 5.1 boxes — github.com refuses 1.0/1.1.
[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ─── Step 1: locate Obsidian vaults from obsidian.json ────────────────────────
$obsidianCfg = Join-Path $env:APPDATA 'obsidian\obsidian.json'
if (-not (Test-Path $obsidianCfg)) {
    throw "Could not find Obsidian config at $obsidianCfg. Install Obsidian and open it once."
}

$cfg = Get-Content $obsidianCfg -Raw | ConvertFrom-Json
$vaults = @()
foreach ($prop in $cfg.vaults.PSObject.Properties) {
    if ($prop.Value.path) { $vaults += $prop.Value.path }
}
if ($vaults.Count -eq 0) {
    throw "No Obsidian vaults found in obsidian.json. Open or create a vault first."
}

# ─── Step 2: vault picker (auto-select if only one) ───────────────────────────
Write-Host ""
Write-Host "Detected $($vaults.Count) vault(s):"
for ($i = 0; $i -lt $vaults.Count; $i++) {
    Write-Host ("  [{0}] {1}" -f ($i + 1), $vaults[$i])
}

if ($vaults.Count -eq 1) {
    $vaultPath = $vaults[0]
    Write-Host ""
    Write-Host "Only one vault — installing into it."
} else {
    Write-Host ""
    $choice = Read-Host "Enter vault number (1-$($vaults.Count))"
    $idx = [int]$choice - 1
    if ($idx -lt 0 -or $idx -ge $vaults.Count) {
        throw "Invalid choice."
    }
    $vaultPath = $vaults[$idx]
}

$pluginDir = Join-Path $vaultPath ".obsidian\plugins\$PluginId"

# ─── Step 3: fetch latest release metadata from GitHub API ────────────────────
Write-Host ""
Write-Host "Querying GitHub for the latest release..."
$apiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
try {
    $release = Invoke-RestMethod -Uri $apiUrl `
        -Headers @{ 'User-Agent' = 'NNN-Sync-Installer'; 'Accept' = 'application/vnd.github+json' } `
        -UseBasicParsing
} catch {
    throw "Failed to query GitHub API: $_"
}

$tagVersion = $release.tag_name -replace '^v', ''
Write-Host "  Latest release: v$tagVersion"

# ─── Step 4: rollback / version floor check ───────────────────────────────────
try {
    $tagV = [Version]$tagVersion
    $minV = [Version]$MinVersion
} catch {
    throw "Could not parse version. Tag='$tagVersion' Min='$MinVersion'."
}
if ($tagV -lt $minV) {
    throw "Refusing to install v$tagVersion — below pinned minimum v$MinVersion. Possible rollback. Aborting."
}

# ─── Step 5: download main.js, manifest.json, SHA256SUMS to temp dir ──────────
$tmp = Join-Path $env:TEMP "nnn-sync-install-$(New-Guid)"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $required = @('main.js', 'manifest.json', 'SHA256SUMS')
    foreach ($name in $required) {
        $asset = $release.assets | Where-Object { $_.name -eq $name }
        if (-not $asset) {
            throw "Release v$tagVersion is missing required asset '$name'. Aborting."
        }
        $dest = Join-Path $tmp $name
        Write-Host "  Downloading $name ..."
        Invoke-WebRequest -Uri $asset.browser_download_url `
            -OutFile $dest -UseBasicParsing `
            -Headers @{ 'User-Agent' = 'NNN-Sync-Installer' }
    }

    # ─── Step 6: SHA256 integrity verification ────────────────────────────────
    Write-Host ""
    Write-Host "Verifying SHA256 hashes..."
    $expected = @{}
    foreach ($line in (Get-Content (Join-Path $tmp 'SHA256SUMS'))) {
        # sha256sum output: <64-char-hex>  <filename>
        $line = $line.Trim()
        if (-not $line) { continue }
        $parts = $line -split '\s+', 2
        if ($parts.Count -ne 2) { continue }
        $expected[$parts[1].Trim()] = $parts[0].ToLower()
    }

    foreach ($name in @('main.js', 'manifest.json')) {
        $actual   = (Get-FileHash (Join-Path $tmp $name) -Algorithm SHA256).Hash.ToLower()
        $declared = $expected[$name]
        if (-not $declared) {
            throw "SHA256SUMS does not list a hash for $name. Release may be incomplete."
        }
        if ($actual -ne $declared) {
            throw @"
INTEGRITY CHECK FAILED for $name.
  Expected SHA256: $declared
  Actual   SHA256: $actual
The file on GitHub may have been tampered with, or the download was corrupted.
Aborting install. NOTHING has been written to your vault.
"@
        }
        Write-Host ("  [OK] {0}" -f $name)
    }

    # ─── Step 7: cross-check manifest.json version against the release tag ────
    $manifest = Get-Content (Join-Path $tmp 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.version -ne $tagVersion) {
        throw "manifest.json version ($($manifest.version)) does not match release tag (v$tagVersion). Aborting."
    }

    # ─── Step 8: install ──────────────────────────────────────────────────────
    Write-Host ""
    Write-Host "Installing to: $pluginDir"
    if (-not (Test-Path $pluginDir)) {
        New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
    }
    Copy-Item (Join-Path $tmp 'main.js')       (Join-Path $pluginDir 'main.js')       -Force
    Copy-Item (Join-Path $tmp 'manifest.json') (Join-Path $pluginDir 'manifest.json') -Force

    # ─── Step 9: enable plugin in community-plugins.json ──────────────────────
    # community-plugins.json must be a JSON array of plugin ids.
    $cpJson = Join-Path $vaultPath '.obsidian\community-plugins.json'
    $list = @()
    if (Test-Path $cpJson) {
        $raw = Get-Content $cpJson -Raw
        if ($raw.Trim()) {
            $parsed = $raw | ConvertFrom-Json
            if ($parsed -is [System.Array]) { $list = $parsed } else { $list = @($parsed) }
        }
    }
    if ($list -notcontains $PluginId) {
        $list = @($list) + $PluginId
        # Force an array even when there is a single element — Obsidian rejects bare strings.
        $jsonOut = '["' + (($list | ForEach-Object { $_ -replace '"','\"' }) -join '","') + '"]'
        $jsonOut | Set-Content -Encoding utf8 $cpJson
    }

    # ─── Done ─────────────────────────────────────────────────────────────────
    Write-Host ""
    Write-Host "============================================================"
    Write-Host "  SUCCESS — NNN HF Sync v$tagVersion installed and enabled"
    Write-Host "============================================================"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Open Obsidian (or run 'Reload app without saving' from the Command Palette)"
    Write-Host "  2. Settings > Community plugins > 'NNN HF Sync' should be on"
    Write-Host "  3. Configure the plugin:"
    Write-Host "       Space URL  : https://ipagoaga-obsidian-sync.hf.space"
    Write-Host "       Username   : <your username>"
    Write-Host "       Password   : <your password or temp password>"
    Write-Host "       Document ID: nnn-vault   (alphanumeric + hyphens, no slashes)"
    Write-Host "  4. Click Connect"
    Write-Host ""
    Write-Host "To update later: just re-run this installer — it always pulls the latest release."
    Write-Host ""
} finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
}
