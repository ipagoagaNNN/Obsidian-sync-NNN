// Session / token plumbing. Free functions (no plugin-state coupling) so they
// can be reused verbatim by future API clients (e.g. the PM module).

import { App } from 'obsidian'
import type { ClientToken } from '@y-sweet/sdk'
import type { NNNSyncSettings, PathACL, TokenResult } from '../types'
import { PLUGIN_VERSION } from '../version'
import { ReauthModal } from './modals'

export function isSessionValid(settings: NNNSyncSettings): boolean {
  if (!settings.sessionToken || !settings.sessionExpiresAt) return false
  const expiresAt = new Date(settings.sessionExpiresAt).getTime()
  return expiresAt - Date.now() > 5 * 60 * 1000
}

export class LoginRequiresPasswordChange extends Error {
  constructor() { super('requiresPasswordChange') }
}

export async function login(settings: NNNSyncSettings): Promise<{ sessionToken: string; expiresAt: string }> {
  const url = settings.spaceUrl.replace(/\/$/, '') + '/auth/login'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
    body: JSON.stringify({ username: settings.username, password: settings.password }),
  })
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}))
    if (body.requiresPasswordChange) throw new LoginRequiresPasswordChange()
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Login failed (${res.status}): ${text}`)
  }
  const body = await res.json()
  return { sessionToken: body.sessionToken, expiresAt: body.expiresAt }
}

export function logout(settings: NNNSyncSettings): void {
  if (!settings.sessionToken) return
  const url = settings.spaceUrl.replace(/\/$/, '') + '/auth/logout'
  fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.sessionToken}`, 'X-Plugin-Version': PLUGIN_VERSION },
  }).catch(() => { /* best-effort */ })
}

export async function fetchClientToken(
  app: App,
  settings: NNNSyncSettings,
  onSessionRefresh: (token: string, expiresAt: string) => Promise<void>,
): Promise<TokenResult> {

  const ensureSession = async () => {
    if (isSessionValid(settings)) return

    // Phase 6a: never authenticate from settings.password. If there's a
    // stale password on disk from a pre-v1.5.0 install, drop it before
    // doing anything else.
    if (settings.password) {
      settings.password = ''
      await onSessionRefresh(settings.sessionToken, settings.sessionExpiresAt)
    }

    // No valid session and no in-memory password → ask the user.
    const modal = new ReauthModal(app, settings.username, settings.spaceUrl)
    const { sessionToken, expiresAt } = await modal.waitForResult()
    settings.sessionToken = sessionToken
    settings.sessionExpiresAt = expiresAt
    settings.password = '' // belt-and-suspenders: ReauthModal already drops it
    await onSessionRefresh(sessionToken, expiresAt)
  }

  await ensureSession()

  const tokenUrl = settings.spaceUrl.replace(/\/$/, '') + '/token'
  const attempt = () => fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
    body: JSON.stringify({ sessionToken: settings.sessionToken, docId: settings.docId }),
  })

  let res = await attempt()

  if (res.status === 401) {
    settings.sessionToken = ''
    settings.sessionExpiresAt = ''
    await ensureSession()
    res = await attempt()
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Token fetch failed (${res.status}): ${text}`)
  }

  const body = await res.json()
  // Server returns { clientToken, role, pathAcls } since v1.3.0. If we hit an
  // older server it may still return just the raw clientToken — handle both.
  if (body && typeof body === 'object' && 'clientToken' in body) {
    return {
      clientToken: body.clientToken as ClientToken,
      role:        typeof body.role === 'string' ? body.role : '',
      pathAcls:    Array.isArray(body.pathAcls) ? body.pathAcls as PathACL[] : [],
    }
  }
  return { clientToken: body as ClientToken, role: '', pathAcls: [] }
}
