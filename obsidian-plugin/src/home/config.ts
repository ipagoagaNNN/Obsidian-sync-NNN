// Home-tab config helpers (Phase 1).
//
// Pure logic over the HomeConfig shape (defined in ../types). No Obsidian /
// network dependency except the best-effort bookmarks import, which is fully
// guarded so it degrades to [] when the core Bookmarks plugin is absent.

import type { App } from 'obsidian'
import type { HomeConfig, HomeLink, HomeLinkKind } from '../types'

/** Monotonic-ish id generator — unique within a session, stable once assigned. */
let __seq = 0
export function newId(prefix = 'h'): string {
  __seq += 1
  return `${prefix}_${Date.now().toString(36)}_${__seq}`
}

/** A fresh, conservative default config. New tabs become Home and Home opens on
 *  startup out of the box (it IS a home tab) — both are one-toggle reversible. */
export function defaultHomeConfig(): HomeConfig {
  return {
    collections: [],
    favorites: [],
    mru: [],
    replaceNewTabs: true,
    openOnStartup: true,
  }
}

/**
 * Normalize settings.home into a full HomeConfig (idempotent). Tolerates a
 * partial/absent object from older saved data — fills every field with a sane
 * default. Mutates settings.home in place and returns the same reference so
 * callers can read AND mutate the live config, then persist via saveSettings().
 */
export function ensureHomeConfig(settings: { home?: HomeConfig }): HomeConfig {
  const d = defaultHomeConfig()
  const cur = settings.home
  if (!cur || typeof cur !== 'object') {
    settings.home = d
    return d
  }
  // Mutate in place so the reference stays stable across calls — the settings
  // tab and the HomeView both hold this object; reassigning would detach them.
  if (!Array.isArray(cur.collections)) cur.collections = d.collections
  if (!Array.isArray(cur.favorites)) cur.favorites = d.favorites
  if (!Array.isArray(cur.mru)) cur.mru = d.mru
  if (typeof cur.replaceNewTabs !== 'boolean') cur.replaceNewTabs = d.replaceNewTabs
  if (typeof cur.openOnStartup !== 'boolean') cur.openOnStartup = d.openOnStartup
  if (cur.greeting !== undefined && typeof cur.greeting !== 'string') cur.greeting = undefined
  return cur
}

/** Push a viewed path to the front of the MRU list (dedup + cap). */
export function pushMru(cfg: HomeConfig, path: string, cap = 50): void {
  cfg.mru = [path, ...cfg.mru.filter((p) => p !== path)].slice(0, cap)
}

/** Default lucide icon id for a link with no explicit icon. */
export function defaultIconFor(kind: HomeLinkKind): string {
  switch (kind) {
    case 'folder':
      return 'folder'
    case 'url':
      return 'link'
    case 'pmview':
      return 'layout-grid'
    case 'command':
      return 'terminal'
    case 'note':
    default:
      return 'file-text'
  }
}

/** A blank link of the given kind, ready for the edit modal. */
export function blankLink(kind: HomeLinkKind = 'note'): HomeLink {
  return { id: newId('lnk'), label: '', kind, target: '' }
}

/**
 * Best-effort import of file paths from Obsidian's core Bookmarks plugin.
 * The bookmarks API is internal/untyped, so every access is guarded; returns
 * [] when the plugin is disabled or the shape differs. Recurses into groups.
 */
export function importBookmarkPaths(app: App): string[] {
  const out: string[] = []
  try {
    const bm = (app as any).internalPlugins?.getPluginById?.('bookmarks')
    const inst = bm?.instance
    const items: unknown[] = inst?.getBookmarks?.() ?? inst?.items ?? []
    const walk = (arr: unknown[]) => {
      for (const raw of arr) {
        const it = raw as { type?: string; path?: string; items?: unknown[] }
        if (it?.type === 'file' && typeof it.path === 'string') out.push(it.path)
        else if (it?.type === 'group' && Array.isArray(it.items)) walk(it.items)
      }
    }
    if (Array.isArray(items)) walk(items)
  } catch {
    /* bookmarks plugin absent or shape changed — silently skip */
  }
  // de-dup, preserve order
  return [...new Set(out)]
}
