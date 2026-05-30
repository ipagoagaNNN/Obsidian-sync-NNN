// Built-in view registration (ADR-014). main.ts calls registerBuiltinViews()
// once at load, before the host + code-block processor are wired. Future views
// (table, gantt, data-analysis) add one register() line here.

import { pmViews } from '../registry'
import { boardView } from './board'

let registered = false

export function registerBuiltinViews(): void {
  if (registered) return // idempotent — plugin reloads call onload again
  pmViews.register(boardView)
  registered = true
}
