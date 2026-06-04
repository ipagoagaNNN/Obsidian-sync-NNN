// Shared types + settings shape for the NNN HF Sync plugin.

import type { ClientToken } from '@y-sweet/sdk'

// ── Home tab (workspace layer, Phase 1) ───────────────────────────────────────

/** What a quick-link card points at.
 *  note    → vault-relative note path (opened in the workspace)
 *  folder  → vault-relative folder path (revealed in the file explorer)
 *  url     → external URL (opened in the browser)
 *  pmview  → an NNN-PM view (opens the PM board)
 *  command → an Obsidian command id (executed) */
export type HomeLinkKind = 'note' | 'folder' | 'url' | 'pmview' | 'command'

/** One customizable quick-link card inside a collection. */
export interface HomeLink {
  id: string
  label: string
  icon?: string // lucide icon id (e.g. 'file-text'); falls back per-kind
  color?: string // optional CSS accent color for the card
  kind: HomeLinkKind
  target: string // path | url | view id | command id (per kind)
}

/** A user-defined, personally-named group of quick-link cards. */
export interface HomeCollection {
  id: string
  title: string
  icon?: string
  links: HomeLink[]
}

/** Per-user home-tab configuration. Persisted inside the plugin's settings
 *  (loadData/saveData) — local to this device, never synced. */
export interface HomeConfig {
  collections: HomeCollection[]
  favorites: string[] // vault-relative file paths (and/or urls)
  mru: string[] // viewed-file paths, most-recent first (capped)
  replaceNewTabs: boolean // turn empty/new tabs into the Home view
  openOnStartup: boolean // open Home when Obsidian launches
  greeting?: string // optional custom heading shown at the top
}

// ── Spaces (Private vs. Organization, Phase 2) ────────────────────────────────

/** Spaces configuration. Maps onto the existing sync + ACL machinery:
 *  - privateRoots are excluded from sync (isSyncable → false) so they are
 *    LOCAL-ONLY — the privacy guarantee is structural, not cosmetic.
 *  - the Organization space = the synced subtree, surfaced read/write per the
 *    server ACLs (effectivePermission). */
export interface SpacesConfig {
  privateRoots: string[] // local-only folder roots (never synced)
  showDashboards: boolean // surface PM views + canonical docs atop the Org section
  openOnStartup: boolean // reveal the Spaces sidebar when Obsidian launches
}

// ── ACL types (mirrors server's pathACL struct in types.go) ───────────────────

/** Server-side ACL row. permission is "read" | "write" | "none" (raw DB value). */
export interface PathACL {
  path: string
  permission: 'read' | 'write' | 'none'
  /**
   * Tier of this rule. Server returns rows in user → role → default order
   * and the plugin walks them as-is — first match wins. Added in v1.4.0
   * to support path-default ACLs (everyone-default policy, enabling
   * "private folder" semantics).
   */
  source?: 'user' | 'role' | 'default'
}

/** Effective per-file permission derived from pathAcls + user role. */
export type Permission = 'write' | 'read-only' | 'none'

// ── Settings ──────────────────────────────────────────────────────────────────

export interface NNNSyncSettings {
  /** Full URL of the HF Space */
  spaceUrl: string
  /** @deprecated Space is public; kept to avoid breaking saved data */
  hfToken: string
  username: string
  /** Temp password — cleared after first-login */
  password: string
  sessionToken: string
  sessionExpiresAt: string
  /** y-sweet logical doc ID — represents the entire shared vault */
  docId: string
  enabled: boolean
  /** Home tab config (Phase 1). Optional on disk; normalized via
   *  ensureHomeConfig() on load so live code always sees a full object. */
  home?: HomeConfig
  /** Spaces config (Phase 2). Optional on disk; normalized via
   *  ensureSpacesConfig() on load. */
  spaces?: SpacesConfig
}

export const DEFAULT_SETTINGS: NNNSyncSettings = {
  spaceUrl: 'https://ipagoaga-obsidian-sync.hf.space',
  hfToken: '',
  username: '',
  password: '',
  sessionToken: '',
  sessionExpiresAt: '',
  docId: '',
  enabled: false,
}

/**
 * /token result shape — includes ACL metadata the plugin needs for path
 * enforcement, not just the y-sweet client token.
 */
export interface TokenResult {
  clientToken: ClientToken
  role: string                // "admin" | "editor" | "viewer" | ""
  pathAcls: PathACL[]
}
