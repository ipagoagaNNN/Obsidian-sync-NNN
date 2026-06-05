// Templates config helpers (Phase 3). Pure logic over TemplatesConfig (../types).

import type { TemplatesConfig } from '../types'

/** Default: templates live in a synced `Templates/` folder; new notes are
 *  created at the vault root unless the template (or this setting) says otherwise. */
export function defaultTemplatesConfig(): TemplatesConfig {
  return {
    templatesFolder: 'Templates',
    defaultDest: '',
  }
}

/** Normalize a path-ish string to a clean vault-relative folder (forward
 *  slashes, no leading/trailing slash). An empty string means the vault root. */
export function normalizeFolder(path: string): string {
  return (path ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
}

/**
 * Normalize settings.templates into a full TemplatesConfig (idempotent).
 * Mutates settings.templates in place and returns the same reference so the
 * settings tab and commands share one live object.
 */
export function ensureTemplatesConfig(settings: { templates?: TemplatesConfig }): TemplatesConfig {
  const d = defaultTemplatesConfig()
  const cur = settings.templates
  if (!cur || typeof cur !== 'object') {
    settings.templates = d
    return d
  }
  if (typeof cur.templatesFolder !== 'string' || !cur.templatesFolder.trim()) {
    cur.templatesFolder = d.templatesFolder
  } else {
    cur.templatesFolder = normalizeFolder(cur.templatesFolder)
  }
  if (typeof cur.defaultDest !== 'string') cur.defaultDest = d.defaultDest
  else cur.defaultDest = normalizeFolder(cur.defaultDest)
  return cur
}
