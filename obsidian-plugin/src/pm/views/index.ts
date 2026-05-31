// Built-in view registration (ADR-014). main.ts calls registerBuiltinViews()
// once at load, before the host + code-block processor are wired. Future views
// (table, gantt, data-analysis) add one register() line here.

import { pmViews } from '../registry'
import { boardView } from './board'
import { tableView } from './table'
import { roadmapView } from './roadmap'
import { dataView } from './data'

let registered = false

export function registerBuiltinViews(): void {
  if (registered) return // idempotent — plugin reloads call onload again
  pmViews.register(boardView)
  pmViews.register(tableView)
  pmViews.register(roadmapView)
  pmViews.register(dataView)
  registered = true
}
