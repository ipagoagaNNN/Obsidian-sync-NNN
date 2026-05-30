// Vault filesystem helpers shared by the sync engine.

import { Vault, normalizePath } from 'obsidian'

/** Only sync plain-text files; skip hidden files and binary formats */
export function isSyncable(path: string): boolean {
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
