// Plugin version + pinned update source.
//
// PLUGIN_VERSION is sent as the X-Plugin-Version header on every request and is
// the floor the in-app updater compares against. The repo constants pin where
// updates come from and MUST match install-windows.ps1 / install-macos.sh.

export const PLUGIN_VERSION = '1.7.1'

// Pinned source for in-app updates (must match install-windows.ps1 / install-macos.sh).
export const PLUGIN_REPO_OWNER = 'ipagoagaNNN'
export const PLUGIN_REPO_NAME  = 'Obsidian-sync-NNN'
