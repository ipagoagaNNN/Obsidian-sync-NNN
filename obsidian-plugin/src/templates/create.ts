// Create a note from a parsed template (Phase 3).
//
// The created note's frontmatter is written via app.fileManager.processFrontMatter
// (never hand-stringified YAML) so Obsidian's Properties UI always renders valid
// values. The body's {{tokens}} are filled from the same answer set.

import { App, TFile, TFolder } from 'obsidian'
import {
  coerceFieldValue,
  fillTokens,
  type TemplateSpec,
  type TemplateValues,
} from './registry'
import { normalizeFolder } from './config'

/** Strip characters Obsidian / Windows reject in a file or folder name. */
export function sanitizeName(raw: string): string {
  return raw
    .replace(/\.md$/i, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ensure a (possibly nested) folder exists. */
async function ensureFolder(app: App, folder: string): Promise<void> {
  if (!folder) return
  if (app.vault.getAbstractFileByPath(folder) instanceof TFolder) return
  try {
    await app.vault.createFolder(folder)
  } catch {
    // already created (race / parent auto-create) — fine
  }
}

/** Append " 2", " 3"… to the basename until the path is free. */
function uniquePath(app: App, path: string): string {
  if (!app.vault.getAbstractFileByPath(path)) return path
  const dot = path.lastIndexOf('.')
  const stem = dot === -1 ? path : path.slice(0, dot)
  const ext = dot === -1 ? '' : path.slice(dot)
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} ${i}${ext}`
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate
  }
  return `${stem} ${Date.now()}${ext}`
}

export interface CreateResult {
  file: TFile
}

/**
 * Materialize a new note from `spec` + the collected `values`, in `destFolder`
 * with the given `fileName` (without extension). Returns the created TFile.
 */
export async function createFromTemplate(
  app: App,
  spec: TemplateSpec,
  values: TemplateValues,
  destFolder: string,
  fileName: string,
): Promise<TFile> {
  const folder = normalizeFolder(destFolder)
  const base = sanitizeName(fileName) || sanitizeName(spec.name) || 'Untitled'
  await ensureFolder(app, folder)

  const desired = (folder ? `${folder}/` : '') + `${base}.md`
  const path = uniquePath(app, desired)

  // Body: fill {{tokens}} using the typed (coerced) answer set so arrays/numbers
  // render sensibly inline.
  const typed = coerceValues(spec, values)
  const body = fillTokens(spec.body, typed)
  const file = await app.vault.create(path, body)

  // Frontmatter: copy template's pass-through keys (tokens filled), then stamp
  // the schema fields with their typed values.
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const [k, v] of Object.entries(spec.frontmatter)) {
      fm[k] = typeof v === 'string' ? fillTokens(v, typed) : v
    }
    for (const field of spec.fields) {
      const val = typed[field.key]
      if (val === undefined) continue
      fm[field.key] = val
    }
  })

  return file
}

/** Coerce every raw answer to its typed frontmatter value. */
function coerceValues(spec: TemplateSpec, values: TemplateValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of spec.fields) {
    out[field.key] = coerceFieldValue(field, values[field.key])
  }
  // Carry through any extra answers not tied to a schema field (e.g. a bare
  // {{title}} token answered in the form) as plain strings.
  for (const [k, v] of Object.entries(values)) {
    if (!(k in out)) out[k] = typeof v === 'string' ? v : String(v)
  }
  return out
}
