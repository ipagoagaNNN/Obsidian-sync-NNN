// Auth modals — the only places a password is collected from the user.
// Both consume the password in a single fetch and never persist it to disk.

import { App, ButtonComponent, Modal, Setting } from 'obsidian'
import { PLUGIN_VERSION } from '../version'

// ── Password-change modal ─────────────────────────────────────────────────────

export class PasswordChangeModal extends Modal {
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

// ── Re-auth modal — Phase 6a (no stored password) ────────────────────────────
//
// Shown whenever the plugin needs to log in but the password isn't already
// in memory. This is the ONLY place a password is collected from the user
// outside of the temp-password first-login flow. The password is consumed
// in a single /auth/login call and never persisted to disk.
//
// Triggers:
//   - First time the user clicks Connect (no session yet)
//   - Session token expires/invalidated and the plugin needs to reconnect
//   - Username changed in settings; previous session no longer applies

export class ReauthModal extends Modal {
  private username: string
  private spaceUrl: string
  private resolve!: (result: { sessionToken: string; expiresAt: string; password: string }) => void
  private reject!: (reason: Error) => void

  constructor(app: App, username: string, spaceUrl: string) {
    super(app)
    this.username = username
    this.spaceUrl = spaceUrl
  }

  waitForResult(): Promise<{ sessionToken: string; expiresAt: string; password: string }> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      this.open()
    })
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: '🔐 Log in' })
    contentEl.createEl('p', {
      text: `Logging in as ${this.username}. Your password is only used to obtain a session token — it is never stored on disk by this plugin.`,
      cls: 'nnn-modal-desc',
    })

    let password = ''
    const errorEl = contentEl.createEl('p', { cls: 'nnn-modal-error' })
    errorEl.style.color = 'var(--text-error, red)'
    errorEl.style.minHeight = '1.2em'

    new Setting(contentEl)
      .setName('Password')
      .addText(text => {
        text.inputEl.type = 'password'
        text.inputEl.autocomplete = 'current-password'
        text.inputEl.focus()
        text.onChange(v => { password = v })
        // Enter submits
        text.inputEl.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            loginBtn?.buttonEl.click()
          }
        })
      })

    // addButton's callback receives the ButtonComponent but the chain returns
    // the Setting, so capture the component here to wire up Enter-to-submit.
    let loginBtn: ButtonComponent | null = null
    const actions = new Setting(contentEl)
    actions
      .addButton(btn => (loginBtn = btn)
        .setButtonText('Log in')
        .setCta()
        .onClick(async () => {
          errorEl.setText('')
          if (!password) {
            errorEl.setText('Enter your password.')
            return
          }
          btn.setDisabled(true).setButtonText('Logging in…')
          try {
            const url = this.spaceUrl.replace(/\/$/, '') + '/auth/login'
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Plugin-Version': PLUGIN_VERSION },
              body: JSON.stringify({ username: this.username, password }),
            })
            if (res.status === 403) {
              const body = await res.json().catch(() => ({}))
              if (body.requiresPasswordChange) {
                // Hand off to the password-change modal (chained flow).
                this.close()
                const changeModal = new PasswordChangeModal(this.app, this.username, password, this.spaceUrl)
                const result = await changeModal.waitForResult()
                this.resolve({ ...result, password: '' })
                return
              }
            }
            if (!res.ok) {
              const text = await res.text().catch(() => res.statusText)
              throw new Error(`Login failed (${res.status}): ${text}`)
            }
            const body = await res.json()
            this.close()
            this.resolve({
              sessionToken: body.sessionToken,
              expiresAt:    body.expiresAt,
              password:     '', // we deliberately drop the password here
            })
          } catch (e) {
            errorEl.setText((e as Error).message)
            btn.setDisabled(false).setButtonText('Log in')
          }
        }))

    actions.addButton(btn => btn
      .setButtonText('Cancel')
      .onClick(() => {
        this.close()
        this.reject(new Error('Login cancelled by user.'))
      }))
  }

  onClose() {
    this.contentEl.empty()
  }
}
