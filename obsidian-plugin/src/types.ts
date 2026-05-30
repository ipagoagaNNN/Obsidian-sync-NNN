// Shared types + settings shape for the NNN HF Sync plugin.

import type { ClientToken } from '@y-sweet/sdk'

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
