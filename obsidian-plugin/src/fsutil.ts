// Vault filesystem helpers shared by the sync engine.

import { Vault, normalizePath } from 'obsidian'

// ── Private roots (Phase 2 Spaces) ────────────────────────────────────────────
// Folders configured as a "Private space" are LOCAL-ONLY: their files must
// never enter the y-sweet document. Enforcement lives here (the single gate the
// whole sync engine already consults via isSyncable) — not in any UI — so the
// privacy guarantee is structural. main.ts calls setPrivateRoots() from the
// loaded SpacesConfig on boot and whenever the setting changes.
let privateRoots: string[] = []

/** Configure the local-only roots. Values are normalized (forward slashes, no
 *  leading/trailing slash); empties dropped. */
export function setPrivateRoots(roots: string[]): void {
  privateRoots = (roots ?? [])
    .map((r) => r.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim())
    .filter(Boolean)
}

/** Current private roots (normalized). */
export function getPrivateRoots(): string[] {
  return privateRoots.slice()
}

/** True if `path` is a configured private root or sits inside one. */
export function isPrivatePath(path: string): boolean {
  const p = path.replace(/\\/g, '/').replace(/^\/+/, '')
  return privateRoots.some((r) => p === r || p.startsWith(r + '/'))
}

/** Only sync plain-text files; skip hidden files, binary formats, and anything
 *  under a configured private root (local-only). */
export function isSyncable(path: string): boolean {
  if (isPrivatePath(path)) return false // local-only — never enters the y-sweet doc
  const base = path.split('/').pop() ?? path
  if (base.startsWith('.')) return false
  const ext = base.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'md' || ext === 'txt'
}

/** Create all ancestor directories of filePath that do not yet exist */
export async function ensureParentDirs(vault: Vault, filePath: string): Promise<void> {
  const segments = normalizePath(filePath).split('/')
  segments.pop()
  for (let depth = 1; depth <= segments.length; depth++) {
    const dir = segments.slice(0, depth).join('/')
    if (!vault.getAbstractFileByPath(dir)) {
      try { await vault.createFolder(dir) } catch { /* already exists — race */ }
    }
  }
}
