// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// SPDX-License-Identifier: GPL-3.0-or-later

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {MonitorManager} from './src/core/monitor-manager.js';
import {ShortcutManager} from './src/core/shortcut-manager.js';
import {PanelIndicator} from './src/ui/panel-indicator.js';

export default class ZumiExtension extends Extension {
    enable() {
        this._enabled = true;
        this._lifecycleId = (this._lifecycleId ?? 0) + 1;
        this._sessionManager = null;
        this._sessionPromise = null;
        this._actionQueue = Promise.resolve();
        this._logger = typeof this.getLogger === 'function' ? this.getLogger() : console;
        this._settings = this.getSettings();
        this._monitorManager = new MonitorManager();
        this._shortcuts = new ShortcutManager(this._settings);

        const actions = {
            'zoom-mode': () => this._dispatch('toggleStaticZoom'),
            'draw-mode': () => this._dispatch('toggleDraw'),
            'break-timer': () => this._dispatch('toggleBreakTimer'),
            'live-zoom': () => this._dispatch('toggleLiveZoom'),
            'live-draw': () => this._dispatch('toggleLiveDraw'),
            'record-full': () => this._dispatch('recordFull'),
            'record-region': () => this._dispatch('recordRegion'),
            'record-window': () => this._dispatch('recordWindow'),
            'snip-copy': () => this._dispatch('snipCopy'),
            'snip-save': () => this._dispatch('snipSave'),
            'snip-ocr': () => this._dispatch('snipOcr'),
            'demo-type': () => this._dispatch('toggleDemoType'),
            'demo-type-previous': () => this._dispatch('previousDemoSnippet'),
            'panorama': () => this._dispatch('recordPanorama'),
            'cursor-highlight': () => this._toggleCursorHighlight(),
        };

        for (const [name, handler] of Object.entries(actions))
            this._shortcuts.add(name, handler);

        this._panelIndicator = new PanelIndicator({
            uuid: this.uuid,
            iconDir: `${this.path}/icons`,
            name: this.metadata.name,
            settings: this._settings,
            logger: this._logger,
            getState: () => this._sessionManager?.getPanelState?.() ?? {},
            actions: {
                zoom: actions['zoom-mode'],
                draw: actions['draw-mode'],
                timer: actions['break-timer'],
                liveZoom: actions['live-zoom'],
                liveDraw: actions['live-draw'],
                focus: () => this._dispatch('toggleFocusSpotlight'),
                highlight: () => this._toggleCursorHighlight(),
                record: actions['record-full'],
                snip: actions['snip-copy'],
                saveSnip: actions['snip-save'],
                ocr: actions['snip-ocr'],
                restoreTimer: () => this._dispatch('restoreBreakTimer'),
                preferences: () => this.openPreferences(),
            },
        });
        this._highlightSettingId = this._settings.connect('changed::cursor-highlight-enabled', () => {
            this._dispatch('setCursorHighlight', this._settings.get_boolean('cursor-highlight-enabled'));
            this._panelIndicator?.refresh();
        });
        if (this._settings.get_boolean('cursor-highlight-enabled'))
            this._dispatch('setCursorHighlight', true);
    }

    _toggleCursorHighlight() {
        const enabled = this._settings.get_boolean('cursor-highlight-enabled');
        this._settings.set_boolean('cursor-highlight-enabled', !enabled);
    }

    async _ensureSession(lifecycleId) {
        if (!this._sessionPromise) {
            // Loading every drawing/capture/recording module at login stalls GNOME Shell.
            this._sessionPromise = import('./src/core/session-manager.js').then(({SessionManager}) => {
                if (!this._enabled || lifecycleId !== this._lifecycleId)
                    return null;
                this._sessionManager = new SessionManager({
                    settings: this._settings,
                    monitorManager: this._monitorManager,
                    logger: this._logger,
                });
                return this._sessionManager;
            });
        }
        return this._sessionPromise;
    }

    _dispatch(method, ...args) {
        const lifecycleId = this._lifecycleId;
        // Preserve shortcut order while the first feature is loading asynchronously.
        const task = this._actionQueue.then(async () => {
            if (!this._enabled || lifecycleId !== this._lifecycleId)
                return;
            const session = await this._ensureSession(lifecycleId);
            if (session && this._enabled && lifecycleId === this._lifecycleId)
                return session[method](...args);
        });
        this._actionQueue = task.catch(error => {
            if (this._enabled && lifecycleId === this._lifecycleId)
                this._logger?.error?.(`Zumi ${method} failed: ${error.message}`);
        });
        return this._actionQueue;
    }

    disable() {
        this._enabled = false;
        this._lifecycleId++;
        if (this._settings && this._highlightSettingId)
            this._settings.disconnect(this._highlightSettingId);
        this._highlightSettingId = 0;
        this._panelIndicator?.destroy();
        this._panelIndicator = null;

        this._shortcuts?.destroy();
        this._shortcuts = null;

        this._sessionManager?.destroy();
        this._sessionManager = null;
        this._sessionPromise = null;
        this._actionQueue = null;

        this._monitorManager?.destroy();
        this._monitorManager = null;

        this._settings = null;
        this._logger = null;
    }
}
