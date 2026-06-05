// Starter templates + user guide (Phase 3).
//
// Scaffolds a ready-to-use Templates/ library into the vault on demand (a
// Settings button). The guide is written FOR non-technical users — it explains
// what templates are, how to run them, and the one block they ever need to edit
// (`nnn_schema`). Existing files are never overwritten.

import { App, TFolder } from 'obsidian'
import { normalizeFolder } from './config'

interface StarterFile {
  name: string // basename without extension
  content: string
}

const GUIDE = `---
nnn_guide: true
type: guide
---
# How to use Templates

Templates let you create properly-structured notes by filling in a short form —
no copy-pasting, no remembering which fields a note needs. Pick a template,
answer a few questions, and a new note is created with everything in the right
place.

## Make a note from a template

1. Open the command palette (**Ctrl/Cmd + P**).
2. Run **“NNN: New from template”**.
3. Pick a template (e.g. *Meeting note*).
4. Fill in the little form and press **Create**.

That's it. The new note opens automatically, with its properties already set.

> Tip: you can also add a **“New from template”** card to your Home tab
> (Home → Edit → add a card of type *Command*).

## What's in this folder

Each note here is a *template*. Three examples are included:

- **Meeting note** — title, date, attendees, status.
- **Project doc** — owner, department, priority, due date.
- **Task** — owner, status, due date, done checkbox.

Open any of them to see how they're built. Copy one to make your own.

## Making your own template (the only technical part)

A template is a normal note with one special block at the very top, between the
\`---\` lines. That block is called **nnn_schema** and it lists the questions the
form should ask. Here is a complete, copy-paste example:

\`\`\`
---
nnn_template: true
nnn_title: "{{title}}"
nnn_target: "Meetings"
nnn_schema:
  - { key: title,     label: Meeting title, kind: text,  required: true }
  - { key: date,      kind: date }
  - { key: attendees, kind: tags }
  - { key: status,    kind: enum, options: [scheduled, done, cancelled], default: scheduled }
type: meeting
---
# {{title}}

**Date:** {{date}}
**Attendees:** {{attendees}}
\`\`\`

### The pieces

- **nnn_template: true** — marks this note as a template (optional but tidy).
- **nnn_title** — what to name the new note. \`{{title}}\` means “use the Title
  answer”.
- **nnn_target** — which folder the new note goes in (leave it out to be asked).
- **nnn_schema** — the list of questions. One line per field.
- Anything in **{{double braces}}** in the body or in other properties gets
  replaced with the matching answer.

### Field kinds you can use

| kind       | what the user sees                  |
|------------|-------------------------------------|
| \`text\`     | a one-line text box                 |
| \`textarea\` | a multi-line text box               |
| \`date\`     | a date picker                       |
| \`number\`   | a number box                        |
| \`enum\`     | a dropdown (give it \`options: [...]\`) |
| \`tags\`     | comma-separated values → a list     |
| \`checkbox\` | a yes/no toggle                     |

Optional extras on any field: \`label\` (nicer name), \`required: true\`,
\`default: …\`, \`description\` (help text under the field).

That's everything. If you can copy the example above and change the lines under
\`nnn_schema\`, you can build any template you need.
`

const MEETING = `---
nnn_template: true
nnn_title: "{{title}}"
nnn_target: "Meetings"
nnn_schema:
  - { key: title,     label: Meeting title, kind: text, required: true }
  - { key: date,      kind: date }
  - { key: attendees, label: Attendees, kind: tags }
  - { key: status,    kind: enum, options: [scheduled, done, cancelled], default: scheduled }
type: meeting
---
# {{title}}

**Date:** {{date}}
**Attendees:** {{attendees}}

## Agenda
-

## Notes


## Action items
- [ ]
`

const PROJECT = `---
nnn_template: true
nnn_title: "{{title}}"
nnn_schema:
  - { key: title,      label: Project name, kind: text, required: true }
  - { key: owner,      kind: text }
  - { key: department, kind: enum, options: [Engineering, Design, Operations, Marketing] }
  - { key: priority,   kind: enum, options: [low, medium, high], default: medium }
  - { key: due,        label: Due date, kind: date }
  - { key: tags,       kind: tags }
type: canonical
canonical: project
---
# {{title}}

**Owner:** {{owner}} · **Department:** {{department}} · **Priority:** {{priority}}

## Overview


## Milestones


## Notes
`

const TASK = `---
nnn_template: true
nnn_title: "{{title}}"
nnn_target: "Tasks"
nnn_schema:
  - { key: title,  label: Task, kind: text, required: true }
  - { key: owner,  kind: text }
  - { key: status, kind: enum, options: [todo, doing, blocked, done], default: todo }
  - { key: due,    label: Due date, kind: date }
  - { key: done,   label: Completed, kind: checkbox }
type: task
---
# {{title}}

- **Status:** {{status}}
- **Owner:** {{owner}}
- **Due:** {{due}}

## Details
`

const STARTERS: StarterFile[] = [
  { name: 'How to use Templates', content: GUIDE },
  { name: 'Meeting note', content: MEETING },
  { name: 'Project doc', content: PROJECT },
  { name: 'Task', content: TASK },
]

export interface ScaffoldResult {
  created: string[]
  skipped: string[]
}

/** Create the templates folder + starter files. Never overwrites an existing
 *  file (those land in `skipped`). */
export async function scaffoldStarterTemplates(app: App, folderRaw: string): Promise<ScaffoldResult> {
  const folder = normalizeFolder(folderRaw) || 'Templates'
  const result: ScaffoldResult = { created: [], skipped: [] }

  if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
    try {
      await app.vault.createFolder(folder)
    } catch {
      // already exists (race) — fine
    }
  }

  for (const s of STARTERS) {
    const path = `${folder}/${s.name}.md`
    if (app.vault.getAbstractFileByPath(path)) {
      result.skipped.push(s.name)
      continue
    }
    try {
      await app.vault.create(path, s.content)
      result.created.push(s.name)
    } catch {
      result.skipped.push(s.name)
    }
  }
  return result
}
