/**
 * NNN HF Sync — Obsidian plugin
 * v1.1.0 — Space is now public; native WebSocket used (no ws polyfill needed).
 *
 * Auth flow
 * ─────────
 * 1. POST /auth/login  { username, password }
 *      → 200 { sessionToken, expiresAt, role }        normal login
 *      → 403 { requiresPasswordChange: true }          temp-password user
 *
 * 2. If 403+requiresPasswordChange:
 *      Show PasswordChangeModal.
 *      POST /auth/first-login { username, tempPassword, newPassword }
 *      → 200 { sessionToken, expiresAt, role }
 *      Store sessionToken; password field cleared from settings.
 *
 * 3. POST /token  { sessionToken, docId }
 *      → { clientToken, role, pathAcls }
 *    If 401 → re-login (may trigger modal again if reset occurred).
 *
 * 4. POST /auth/logout  Authorization: Bearer <sessionToken>
 *    Called on stopSync() and onunload().
 *
 * WebSocket transport
 * ───────────────────
 * The HF Space is public — no Authorization header required on WebSocket
 * upgrades. Electron's native WebSocket is used directly. No ws polyfill.
 * Mobile support: deferred — see ADR-008.
 */

import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from 'obsidian'
import * as Y from 'yjs'
import { YSweetProvider } from '@y-sweet/client'
import type { ClientToken } from '@y-sweet/sdk'

const PLUGIN_VERSION = '1.1.0'

// ── Settings ──────────────────────────────────────────────────────────────────

interface NNNSyncSettings {
  /** Full URL of the HF Space, e.g. https://ipagoaga-obsidian-sync.hf.space */
  spaceUrl: string
  /** @deprecated No longer used — Space is public. Kept to avoid breaking saved data. */
  hfToken: string
  /** Username for our auth-server */
  username: string
  /** Temp/initial password — used once to obtain sessionToken, then cleared */
  password: string
  /** Active session JWT — obtained from POST /auth/login or /auth/first-login */
  sessionToken: string
  /** ISO-8601 expiry of the session token */
  sessionExpiresAt: string
  /** y-sweet logical document ID for this vault */
  docId: string
  /** Whether sync is enabled */
  enabled: boolean
}

const DEFAULT_SETTINGS: NNNSyncSettings = {
  spaceUrl: 'https://ipagoaga-obsidian-sync.hf.space',
  hfToken: '',
  username: '',
  password: '',
  sessionToken: '',
  sessionExpiresAt: '',
  docId: '',
  enabled: false,
}

// ── Password-change modal ─────────────────────────────────────────────────────

/**
 * Shown when POST /auth/login returns 403 + requiresPasswordChange:true.
 * Prompts the user to set a permanent password before sync can proceed.
 * Resolves with the new sessionToken on success, or rejects if the user cancels.
 */
class PasswordChangeModal extends Modal {
  private username: string
  private tempPassword: string
  private spaceUrl: string
  private resolve!: (result: { sessionToken: string; expiresAt: string }) => void
  private reject!: (reason: Error) => void

  constructor(app: App, username: string, tempPassword: string, spaceUrl: string) {
    super(app)
    this.username = username
    this.tempPassword = tempPassword
    this.spaceUrl = spaceUrl
  }

  waitForResult(): Promise<{ sessionToken: string; expiresAt: string }> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      this.open()
    })
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: '🔐 Set your password' })
    contentEl.createEl('p', {
      text: 'Your account was created with a temporary password. Please set a new permanent password to continue.',
      cls: 'nnn-modal-desc',
    })

    let newPassword = ''
    let confirmPassword = ''
    const errorEl = contentEl.createEl('p', { cls: 'nnn-modal-error' })
    errorEl.style.color = 'var(--text-error, red)'
    errorEl.style.minHeight = '1.2em'

    new Setting(contentEl)
      .setName('New password')
      .setDesc('Minimum 10 characters.')
      .addText(text => {
        text.inputEl.type = 'password'
        text.inputEl.autocomplete = 'new-password'
        text.onChange(v => { newPassword = v })
      })

    new Setting(contentEl)
      .setName('Confirm password')
      .addText(text => {
        text.inputEl.type = 'password'
        text.inputEl.autocomplete = 'new-password'
        text.onChange(v => { confirmPassword = v })
      })

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Set password & connect')
        .setCta()
        .onClick(async () => {
          errorEl.setText('')
          if (newPassword.length < 10) {
            errorEl.setText('Password must be at least 10 characters.')
            return
          }
          if (newPassword !== confirmPassword) {
            errorEl.setText('Passwords do not match.')
            return
          }
          if (newPassword === this.tempPassword) {
            errorEl.setText('New password must differ from your temporary password.')
            return
          }
          btn.setDisabled(true).setButtonText('Setting password…')
          try {
            const url = this.spaceUrl.replace(/\/$/, '') + '/auth/first-login'
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
              body: JSON.stringify({
                username: this.username,
                tempPassword: this.tempPassword,
                newPassword,
              }),
            })
            if (!res.ok) {
              const text = await res.text().catch(() => res.statusText)
              throw new Error(`Server error (${res.status}): ${text}`)
            }
            const body = await res.json()
            this.close()
            this.resolve({ sessionToken: body.sessionToken, expiresAt: body.expiresAt })
          } catch (e) {
            errorEl.setText((e as Error).message)
            btn.setDisabled(false).setButtonText('Set password & connect')
          }
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => {
          this.close()
          this.reject(new Error('Password change cancelled by user.'))
        }))
  }

  onClose() {
    this.contentEl.empty()
  }
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

function isSessionValid(settings: NNNSyncSettings): boolean {
  if (!settings.sessionToken || !settings.sessionExpiresAt) return false
  const expiresAt = new Date(settings.sessionExpiresAt).getTime()
  return expiresAt - Date.now() > 5 * 60 * 1000
}

class LoginRequiresPasswordChange extends Error {
  constructor() { super('requiresPasswordChange') }
}

async function login(settings: NNNSyncSettings): Promise<{ sessionToken: string; expiresAt: string }> {
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

function logout(settings: NNNSyncSettings): void {
  if (!settings.sessionToken) return
  const url = settings.spaceUrl.replace(/\/$/, '') + '/auth/logout'
  fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.sessionToken}`, 'X-Plugin-Version': PLUGIN_VERSION },
  }).catch(() => { /* best-effort */ })
}

async function fetchClientToken(
  app: App,
  settings: NNNSyncSettings,
  onSessionRefresh: (token: string, expiresAt: string) => Promise<void>,
): Promise<ClientToken> {

  const ensureSession = async () => {
    if (isSessionValid(settings)) return
    try {
      const { sessionToken, expiresAt } = await login(settings)
      settings.sessionToken = sessionToken
      settings.sessionExpiresAt = expiresAt
      await onSessionRefresh(sessionToken, expiresAt)
    } catch (e) {
      if (e instanceof LoginRequiresPasswordChange) {
        const modal = new PasswordChangeModal(
          app, settings.username, settings.password, settings.spaceUrl,
        )
        const { sessionToken, expiresAt } = await modal.waitForResult()
        settings.sessionToken = sessionToken
        settings.sessionExpiresAt = expiresAt
        settings.password = ''
        await onSessionRefresh(sessionToken, expiresAt)
      } else {
        throw e
      }
    }
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
  if (body.clientToken) return body.clientToken as ClientToken
  return body as ClientToken
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default class NNNSyncPlugin extends Plugin {
  settings!: NNNSyncSettings

  private ydoc: Y.Doc | null = null
  private provider: YSweetProvider | null = null
  private statusBarItem: HTMLElement | null = null

  async onload() {
    await this.loadSettings()
    this.addSettingTab(new NNNSyncSettingTab(this.app, this))

    this.statusBarItem = this.addStatusBarItem()
    this.updateStatusBar('idle')

    this.addCommand({
      id: 'nnn-sync-connect',
      name: 'Connect sync',
      callback: () => this.startSync(),
    })

    this.addCommand({
      id: 'nnn-sync-disconnect',
      name: 'Disconnect sync',
      callback: () => this.stopSync(),
    })

    if (this.settings.enabled && this.settings.username && this.settings.docId) {
      setTimeout(() => this.startSync(), 3000)
    }
  }

  onunload() {
    logout(this.settings)
    this.stopSync()
  }

  async startSync() {
    if (this.provider) {
      new Notice('NNN Sync: already connected.')
      return
    }

    const s = this.settings
    if (!s.username || !s.docId) {
      new Notice('NNN Sync: configure username and document ID before connecting.')
      return
    }
    if (!s.password && !isSessionValid(s)) {
      new Notice('NNN Sync: enter your password (or reconnect to re-authenticate).')
      return
    }

    this.updateStatusBar('connecting')
    new Notice('NNN Sync: connecting…')

    try {
      this.ydoc = new Y.Doc()

      const onSessionRefresh = async (token: string, expiresAt: string) => {
        this.settings.sessionToken = token
        this.settings.sessionExpiresAt = expiresAt
        await this.saveSettings()
      }

      const app = this.app
      // Native WebSocket — no polyfill needed (Space is public, no auth header required)
      this.provider = new YSweetProvider(
        () => fetchClientToken(app, s, onSessionRefresh),
        s.docId,
        this.ydoc,
        { connect: true },
      )

      this.provider.on('connection-status', (status: string) => {
        this.updateStatusBar(status)
        if (status === 'connected') {
          new Notice('NNN Sync: connected ✓')
        } else if (status === 'error') {
          new Notice('NNN Sync: connection error — retrying…')
        }
      })

      this.settings.enabled = true
      await this.saveSettings()

    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'Password change cancelled by user.') {
        new Notice('NNN Sync: cancelled — password change required to connect.')
      } else {
        new Notice(`NNN Sync: failed to connect — ${msg}`)
      }
      this.updateStatusBar('error')
      this.ydoc = null
      this.provider = null
    }
  }

  stopSync() {
    logout(this.settings)
    if (this.provider) {
      this.provider.disconnect()
      this.provider.destroy()
      this.provider = null
    }
    if (this.ydoc) {
      this.ydoc.destroy()
      this.ydoc = null
    }
    this.settings.sessionToken = ''
    this.settings.sessionExpiresAt = ''
    this.settings.enabled = false
    this.saveSettings()
    this.updateStatusBar('idle')
  }

  private updateStatusBar(status: string) {
    if (!this.statusBarItem) return
    const icons: Record<string, string> = {
      idle: '⬜ NNN Sync',
      connecting: '🟡 NNN Sync',
      handshaking: '🟡 NNN Sync',
      connected: '🟢 NNN Sync',
      error: '🔴 NNN Sync',
    }
    this.statusBarItem.setText(icons[status] ?? `⬜ NNN Sync (${status})`)
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }
}

// ── Settings tab ──────────────────────────────────────────────────────────────

class NNNSyncSettingTab extends PluginSettingTab {
  plugin: NNNSyncPlugin

  constructor(app: App, plugin: NNNSyncPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.createEl('h2', { text: 'NNN HF Sync' })

    new Setting(containerEl)
      .setName('Space URL')
      .setDesc('Base URL of the HF Space (no trailing slash).')
      .addText(text => text
        .setPlaceholder('https://ipagoaga-obsidian-sync.hf.space')
        .setValue(this.plugin.settings.spaceUrl)
        .onChange(async (v) => {
          this.plugin.settings.spaceUrl = v.trim()
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Username')
      .setDesc('Your username on the sync server.')
      .addText(text => text
        .setPlaceholder('alice')
        .setValue(this.plugin.settings.username)
        .onChange(async (v) => {
          this.plugin.settings.username = v.trim()
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Password')
      .setDesc(
        isSessionValid(this.plugin.settings)
          ? '✅ Session active — password not needed until session expires.'
          : 'Enter your password (or temp password if this is your first login).'
      )
      .addText(text => {
        text.inputEl.type = 'password'
        text.inputEl.autocomplete = 'current-password'
        text
          .setValue(this.plugin.settings.password)
          .onChange(async (v) => {
            this.plugin.settings.password = v
            this.plugin.settings.sessionToken = ''
            this.plugin.settings.sessionExpiresAt = ''
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Document ID')
      .setDesc('Logical document ID for this vault (e.g. "nnn/main"). See ADR-007 for multi-vault naming.')
      .addText(text => text
        .setPlaceholder('nnn/main')
        .setValue(this.plugin.settings.docId)
        .onChange(async (v) => {
          this.plugin.settings.docId = v.trim()
          await this.plugin.saveSettings()
        }))

    // Session status
    const sessionDesc = isSessionValid(this.plugin.settings)
      ? `✅ Session active — expires ${new Date(this.plugin.settings.sessionExpiresAt).toLocaleString()}`
      : '⚠️ No active session — will authenticate on connect.'
    containerEl.createEl('p', { text: sessionDesc, cls: 'setting-item-description' })

    containerEl.createEl('h3', { text: 'Connection' })

    new Setting(containerEl)
      .setName('Connect / Disconnect')
      .setDesc('Start or stop the sync connection.')
      .addButton(btn => btn
        .setButtonText('Connect')
        .setCta()
        .onClick(() => this.plugin.startSync()))
      .addButton(btn => btn
        .setButtonText('Disconnect')
        .onClick(() => this.plugin.stopSync()))
  }
}
