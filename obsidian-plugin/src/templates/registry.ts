// Template registry (Phase 3) — parse "template notes" into a prompt schema.
//
// CLEAN-ROOM / AGPL NOTE: this is an independent reimplementation of the
// "prompt for property values, then stamp them into YAML frontmatter" idea.
// It shares NO code, API names, or token syntax with Templater (AGPLv3) — we
// use our own `nnn_schema` frontmatter + `{{token}}` placeholders, built only
// on Obsidian's public API (parseYaml / vault / fileManager). See the plan's
// "Licensing & AGPL safeguards" section.
//
// A template is a plain note that carries an `nnn_schema` frontmatter block
// describing the properties to prompt for. Control keys (all `nnn_*`) are meta
// and are stripped from the created note; every other frontmatter key is copied
// through (with `{{tokens}}` filled), and the body's `{{tokens}}` are filled too.

import { App, TFile, parseYaml } from 'obsidian'

export type TemplateFieldKind = 'text' | 'textarea' | 'date' | 'number' | 'enum' | 'tags' | 'checkbox'

const FIELD_KINDS: TemplateFieldKind[] = ['text', 'textarea', 'date', 'number', 'enum', 'tags', 'checkbox']

/** One prompted property derived from an `nnn_schema` entry. */
export interface TemplateField {
  key: string
  label: string
  kind: TemplateFieldKind
  options: string[] // enum choices
  default?: string | number | boolean
  required: boolean
  description?: string
}

/** A fully-parsed template ready to drive the New-from-template form. */
export interface TemplateSpec {
  file: TFile
  name: string // display name (template note basename)
  fields: TemplateField[]
  body: string // template body with frontmatter stripped; still holds {{tokens}}
  frontmatter: Record<string, unknown> // template frontmatter minus nnn_* control keys
  titlePattern?: string // nnn_title — filename pattern (tokens allowed)
  targetPattern?: string // nnn_target — destination folder pattern (tokens allowed)
}

/** Collected answer values, keyed by field key. Raw form values; coerced to
 *  typed frontmatter at write time (see create.ts). */
export type TemplateValues = Record<string, string | boolean>

const CONTROL_PREFIX = 'nnn_'

function isControlKey(k: string): boolean {
  return k.startsWith(CONTROL_PREFIX)
}

/** Split a note's raw content into its frontmatter object + the body after it. */
export function splitFrontmatter(content: string): { fm: Record<string, unknown>; body: string } {
  const m = content.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { fm: {}, body: content }
  let fm: Record<string, unknown> = {}
  try {
    fm = (parseYaml(m[1]) as Record<string, unknown>) ?? {}
  } catch {
    fm = {}
  }
  return { fm, body: content.slice(m[0].length) }
}

/** Coerce one raw `nnn_schema` entry (string shorthand or object) into a TemplateField. */
function normalizeField(raw: unknown): TemplateField | null {
  // String shorthand: "owner" → a text field keyed "owner".
  if (typeof raw === 'string') {
    const key = raw.trim()
    if (!key) return null
    return { key, label: titleCase(key), kind: 'text', options: [], required: false }
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const key = typeof o.key === 'string' ? o.key.trim() : ''
  if (!key) return null
  const kind: TemplateFieldKind =
    typeof o.kind === 'string' && FIELD_KINDS.includes(o.kind as TemplateFieldKind)
      ? (o.kind as TemplateFieldKind)
      : 'text'
  const options = Array.isArray(o.options) ? o.options.map((x) => String(x)).filter(Boolean) : []
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : titleCase(key)
  const description = typeof o.description === 'string' ? o.description : undefined
  const required = o.required === true
  let def: string | number | boolean | undefined
  if (typeof o.default === 'string' || typeof o.default === 'number' || typeof o.default === 'boolean') {
    def = o.default
  }
  return { key, label, kind, options, default: def, required, description }
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/** Parse a single note into a TemplateSpec, or null if the note is not a usable
 *  template. A note qualifies when it sets `nnn_template: true` OR carries a
 *  non-empty `nnn_schema`. The bundled guide (`nnn_guide: true`) and any other
 *  plain note in the folder are excluded so they never show in the picker. */
export async function parseTemplate(app: App, file: TFile): Promise<TemplateSpec | null> {
  const content = await app.vault.cachedRead(file)
  const { fm, body } = splitFrontmatter(content)

  const hasSchema = Array.isArray(fm.nnn_schema) && fm.nnn_schema.length > 0
  const isTemplate = fm.nnn_template === true || hasSchema
  if (fm.nnn_guide === true || !isTemplate) return null

  const fields: TemplateField[] = []
  const rawSchema = fm.nnn_schema
  if (Array.isArray(rawSchema)) {
    for (const entry of rawSchema) {
      const f = normalizeField(entry)
      if (f) fields.push(f)
    }
  }

  const passthrough: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fm)) {
    if (!isControlKey(k)) passthrough[k] = v
  }

  return {
    file,
    name: file.basename,
    fields,
    body,
    frontmatter: passthrough,
    titlePattern: typeof fm.nnn_title === 'string' ? fm.nnn_title : undefined,
    targetPattern: typeof fm.nnn_target === 'string' ? fm.nnn_target : undefined,
  }
}

/** Parse every markdown note directly inside `folder` (non-recursive shallow
 *  scan is intentional — templates are a flat library). */
export async function listTemplates(app: App, folder: string): Promise<TemplateSpec[]> {
  const prefix = folder ? folder.replace(/\/+$/g, '') + '/' : ''
  const out: TemplateSpec[] = []
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(prefix)) continue
    // shallow: the path after the prefix must contain no further slash
    const rest = f.path.slice(prefix.length)
    if (rest.includes('/')) continue
    const spec = await parseTemplate(app, f)
    if (spec) out.push(spec)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Replace `{{ token }}` occurrences using the supplied values. Unknown tokens
 *  are left intact so a typo is visible rather than silently blanked. */
export function fillTokens(text: string, values: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (whole, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return stringifyValue(values[key])
    }
    return whole
  })
}

/** Render a value for inline (body / frontmatter-string) substitution. */
export function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ')
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

/** Coerce a raw form value into the typed value written to frontmatter. */
export function coerceFieldValue(field: TemplateField, raw: string | boolean | undefined): unknown {
  switch (field.kind) {
    case 'checkbox':
      return raw === true || raw === 'true'
    case 'number': {
      const n = Number(raw)
      return Number.isFinite(n) ? n : undefined
    }
    case 'tags':
      return typeof raw === 'string'
        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
        : []
    default:
      return typeof raw === 'string' ? raw : raw === undefined ? '' : String(raw)
  }
}
