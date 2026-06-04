// Spaces config helpers (Phase 2). Pure logic over SpacesConfig (../types).

import type { SpacesConfig } from '../types'

/** Default: a single local-only "Private" root, dashboards surfaced, sidebar
 *  opt-in (reachable via ribbon/command). Conservative — nothing un-syncs
 *  unless the user actually has files under a private root. */
export function defaultSpacesConfig(): SpacesConfig {
  return {
    privateRoots: ['Private'],
    showDashboards: true,
    openOnStartup: false,
  }
}

/** Normalize a path-ish string to a clean vault-relative root (forward slashes,
 *  no leading/trailing slash). */
export function normalizeRoot(root: string): string {
  return root.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
}

/**
 * Normalize settings.spaces into a full SpacesConfig (idempotent). Mutates
 * settings.spaces in place and returns the same reference so callers can read
 * AND mutate the live config, then persist via saveSettings().
 */
export function ensureSpacesConfig(settings: { spaces?: SpacesConfig }): SpacesConfig {
  const d = defaultSpacesConfig()
  const cur = settings.spaces
  if (!cur || typeof cur !== 'object') {
    settings.spaces = d
    return d
  }
  // Mutate in place so the reference stays stable across calls (the settings
  // tab + SpacesView both hold it). privateRoots is re-normalized each call.
  if (!Array.isArray(cur.privateRoots)) cur.privateRoots = d.privateRoots
  else cur.privateRoots = cur.privateRoots.map(normalizeRoot).filter(Boolean)
  if (typeof cur.showDashboards !== 'boolean') cur.showDashboards = d.showDashboards
  if (typeof cur.openOnStartup !== 'boolean') cur.openOnStartup = d.openOnStartup
  return cur
}
