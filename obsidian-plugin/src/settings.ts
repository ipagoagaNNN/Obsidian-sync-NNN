// Settings tab + post-update reload prompt. Reads/writes plugin state through
// the public plugin surface; imports the plugin type only (no runtime cycle).

import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian'
import type NNNSyncPlugin from './main'
import { PLUGIN_VERSION } from './version'
import { isSessionValid } from './auth/session'
import { ensureHomeConfig } from './home/config'
import { ensureSpacesConfig } from './spaces/config'

export class NNNSyncSettingTab extends PluginSettingTab {
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
      .setName('Authentication')
      .setDesc(
        isSessionValid(this.plugin.settings)
          ? '✅ Session active — no login needed until session expires.'
          : 'Click Connect (below) to log in. Your password is never stored on disk — it is used once to obtain a session token.'
      )
      // No password field: Phase 6a removed plaintext storage. Login happens
      // through the ReauthModal that pops up when you click Connect.
      .addButton(btn => btn
        .setButtonText(isSessionValid(this.plugin.settings) ? 'Re-authenticate' : 'Log in')
        .onClick(async () => {
          // Invalidate the current session and force a fresh login modal.
          this.plugin.settings.sessionToken = ''
          this.plugin.settings.sessionExpiresAt = ''
          this.plugin.settings.password = ''
          await this.plugin.saveSettings()
          await this.plugin.startSync()
          this.display() // re-render to update the button label
        }))

    new Setting(containerEl)
      .setName('Document ID')
      .setDesc('Vault ID for this shared workspace (e.g. "nnn/main"). All users connecting to the same ID share one vault.')
      .addText(text => text
        .setPlaceholder('nnn/main')
        .setValue(this.plugin.settings.docId)
        .onChange(async (v) => {
          this.plugin.settings.docId = v.trim()
          await this.plugin.saveSettings()
        }))

    const sessionDesc = isSessionValid(this.plugin.settings)
      ? `✅ Session active — expires ${new Date(this.plugin.settings.sessionExpiresAt).toLocaleString()}`
      : '⚠️ No active session — will authenticate on connect.'
    containerEl.createEl('p', { text: sessionDesc, cls: 'setting-item-description' })

    // Plugin version + in-app updater (rerenders whenever update state changes)
    this.renderVersionSection(containerEl)

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

    this.renderHomeSection(containerEl)
    this.renderSpacesSection(containerEl)
  }

  /** Home-tab preferences (Phase 1). Per-user, local-only. */
  private renderHomeSection(containerEl: HTMLElement) {
    const home = ensureHomeConfig(this.plugin.settings)
    containerEl.createEl('h3', { text: 'Home tab' })

    new Setting(containerEl)
      .setName('Replace new tabs with Home')
      .setDesc('Turn empty/new tabs into your customizable Home view.')
      .addToggle(t => t
        .setValue(home.replaceNewTabs)
        .onChange(async (v) => {
          home.replaceNewTabs = v
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Open Home on startup')
      .setDesc('Show the Home view when Obsidian launches.')
      .addToggle(t => t
        .setValue(home.openOnStartup)
        .onChange(async (v) => {
          home.openOnStartup = v
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Heading')
      .setDesc('Custom title shown at the top of Home (leave blank for “Home”).')
      .addText(text => text
        .setPlaceholder('Home')
        .setValue(home.greeting ?? '')
        .onChange(async (v) => {
          home.greeting = v.trim() || undefined
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Open Home now')
      .addButton(btn => btn
        .setButtonText('Open Home')
        .onClick(() => { void this.plugin.openHome() }))
  }

  /** Spaces preferences (Phase 2). privateRoots feed the sync filter. */
  private renderSpacesSection(containerEl: HTMLElement) {
    const spaces = ensureSpacesConfig(this.plugin.settings)
    containerEl.createEl('h3', { text: 'Spaces' })

    new Setting(containerEl)
      .setName('Private (local-only) folders')
      .setDesc('Comma-separated folder paths kept on this device only and excluded from sync — files under these never leave your machine. Set these BEFORE putting sensitive notes there.')
      .addText(text => text
        .setPlaceholder('Private, Personal')
        .setValue(spaces.privateRoots.join(', '))
        .onChange(async (v) => {
          spaces.privateRoots = v.split(',').map(s => s.trim()).filter(Boolean)
          await this.plugin.saveSettings()
          this.plugin.applyPrivateRoots()
        }))

    new Setting(containerEl)
      .setName('Show dashboards in Organization')
      .setDesc('Surface the project board + canonical docs at the top of the Organization space.')
      .addToggle(t => t
        .setValue(spaces.showDashboards)
        .onChange(async (v) => {
          spaces.showDashboards = v
          await this.plugin.saveSettings()
          this.plugin.refreshSpaces()
        }))

    new Setting(containerEl)
      .setName('Open Spaces on startup')
      .setDesc('Reveal the Spaces sidebar in the left dock when Obsidian launches.')
      .addToggle(t => t
        .setValue(spaces.openOnStartup)
        .onChange(async (v) => {
          spaces.openOnStartup = v
          await this.plugin.saveSettings()
        }))

    new Setting(containerEl)
      .setName('Open Spaces now')
      .addButton(btn => btn
        .setButtonText('Open Spaces')
        .onClick(() => { void this.plugin.openSpaces() }))
  }

  /**
   * Render the "Plugin version" row with an Update button if a newer
   * version is available. Re-rendered in place when the check completes
   * or when an update finishes, via plugin.onUpdateStateChange.
   */
  private renderVersionSection(containerEl: HTMLElement) {
    const wrap = containerEl.createDiv({ cls: 'nnn-version-row' })
    wrap.style.margin = '8px 0 14px 0'
    wrap.style.display = 'flex'
    wrap.style.alignItems = 'center'
    wrap.style.gap = '10px'
    wrap.style.fontSize = '0.85rem'

    const render = () => {
      wrap.empty()
      const label = wrap.createSpan()
      const latest = this.plugin.latestVersion

      if (this.plugin.updating) {
        label.setText(`Plugin version v${PLUGIN_VERSION} — updating…`)
        return
      }
      if (latest === null) {
        // Not checked yet
        label.setText(`Plugin version v${PLUGIN_VERSION} — checking for updates…`)
        return
      }
      if (latest === '') {
        // Check failed
        label.setText(`Plugin version v${PLUGIN_VERSION}  `)
        wrap.createSpan({ cls: 'nnn-version-hint', text: '(couldn’t reach GitHub — try again later)' })
          .setAttr('style', 'color: var(--muted, #888); font-size: 0.78rem;')
        const retry = wrap.createEl('button', { text: 'Retry', cls: 'mod-cta' })
        retry.style.padding = '2px 10px'
        retry.style.fontSize = '0.78rem'
        retry.onclick = async () => {
          this.plugin.latestVersion = null
          render()
          await this.plugin.checkForUpdate()
        }
        return
      }
      if (this.plugin.isUpdateAvailable()) {
        label.setText(`Plugin version v${PLUGIN_VERSION}  →  v${latest} available`)
        label.style.color = 'var(--text-warning, #f59e0b)'
        const updateBtn = wrap.createEl('button', { text: 'Update now', cls: 'mod-cta' })
        updateBtn.style.padding = '3px 12px'
        updateBtn.onclick = () => this.handleUpdateClick(updateBtn)
        return
      }
      // Up to date
      label.setText(`Plugin version v${PLUGIN_VERSION}  `)
      wrap.createSpan({ text: '✓ Up to date' })
        .setAttr('style', 'color: var(--text-success, #4ade80); font-weight: 500;')
    }

    this.plugin.onUpdateStateChange = render
    render()

    // Trigger a check if we haven't yet this session
    if (this.plugin.latestVersion === null && !this.plugin.updateChecking) {
      void this.plugin.checkForUpdate()
    }
  }

  private async handleUpdateClick(btn: HTMLButtonElement) {
    btn.disabled = true
    btn.setText('Downloading…')
    try {
      const { version } = await this.plugin.performUpdate()
      btn.setText('Done')
      new ReloadPromptModal(this.app, version).open()
    } catch (e) {
      btn.disabled = false
      btn.setText('Update now')
      new Notice(`NNN Sync: update failed — ${(e as Error).message}`)
    }
  }
}

/**
 * Shown after a successful in-app update. Offers to reload Obsidian so the
 * new plugin code becomes active. "Later" closes the modal; user can reload
 * manually via Cmd/Ctrl+P → "Reload app without saving" whenever they want.
 */
export class ReloadPromptModal extends Modal {
  private newVersion: string
  constructor(app: App, newVersion: string) {
    super(app)
    this.newVersion = newVersion
  }
  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: `✓ Updated to v${this.newVersion}` })
    contentEl.createEl('p', {
      text: 'The new plugin files are on disk. Obsidian needs to reload to activate them — your current edits are preserved.',
    })
    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('Reload now').setCta().onClick(() => {
        this.close()
        // app:reload is Obsidian's built-in full-restart command.
        ;(this.app as any).commands.executeCommandById('app:reload')
      }))
      .addButton(btn => btn.setButtonText('Later').onClick(() => this.close()))
  }
  onClose() { this.contentEl.empty() }
}
