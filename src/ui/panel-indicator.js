// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class PanelIndicator {
    constructor({
        uuid,
        name = 'Zumi',
        settings,
        actions,
        getState = () => ({}),
        logger = console,
        iconDir,
    }) {
        this._settings = settings;
        this._actions = actions;
        this._getState = getState;
        this._logger = logger;
        this._iconDir = iconDir;
        this._panelStyleId = 0;
        this._menuSignalId = 0;

        this.actor = new PanelMenu.Button(0.0, name, false);
        // Only Zumi's hitbox: GNOME themes can give panel buttons very wide side gaps.
        this.actor.set_style('-natural-hpadding: 6px; -minimum-hpadding: 6px;');
        this.actor.accessible_name = name;

        this._icon = this._createIcon(19, 'system-status-icon lumalens-panel-icon', 'zumi-panel-light.svg');
        this.actor.add_child(this._icon);

        this._name = name;
        this._menuBuilt = false;
        // GNOME 50 refuses to open an empty popup: lazy-build needs one real item.
        this._placeholderItem = new PopupMenu.PopupMenuItem('Loading Zumi…', {reactive: false});
        this.actor.menu.addMenuItem(this._placeholderItem);
        Main.panel.addToStatusArea(uuid, this.actor);
        this._updatePanelIcon();
        this._panelStyleId = Main.panel.connect('style-changed', () => this._updatePanelIcon());

        settings.bind(
            'show-panel-indicator',
            this.actor,
            'visible',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._menuSignalId = this.actor.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                if (!this._menuBuilt) {
                    this._buildMenu(this._name);
                    this._menuBuilt = true;
                    this._placeholderItem.destroy();
                    this._placeholderItem = null;
                }
                this.refresh();
            }
        });

        this.refresh();
    }

    refresh() {
        if (!this.actor)
            return;

        const state = this._getState?.() ?? {};
        const timerMinimized = Boolean(state.timerMinimized);
        const timerPaused = Boolean(state.timerPaused);
        const recordingActive = Boolean(state.recordingActive);

        if (this._restoreTimerItem)
            this._restoreTimerItem.visible = timerMinimized;

        if (this._highlightItem)
            this._highlightItem.setToggleState(this._settings.get_boolean('cursor-highlight-enabled'));

        if (this._shortcutLabels) {
            for (const [key, label] of this._shortcutLabels)
                label.text = this._shortcutText(key);
        }

        if (this._recordItem?.label)
            this._recordItem.label.text = recordingActive ? 'Stop recording' : 'Record';

        if (this._statusLabel) {
            if (recordingActive)
                this._statusLabel.text = 'Recording active';
            else if (timerMinimized)
                this._statusLabel.text = timerPaused ? 'Break timer paused' : 'Break timer minimized';
            else if (state.focusSpotlight)
                this._statusLabel.text = 'Focus Spotlight active';
            else if (state.cursorHighlight)
                this._statusLabel.text = 'Cursor highlight on';
            else if (state.canvasMode === 'static-zoom')
                this._statusLabel.text = 'Static Zoom active';
            else if (state.canvasMode === 'draw')
                this._statusLabel.text = 'Draw active';
            else if (state.canvasMode === 'live-draw')
                this._statusLabel.text = 'LiveDraw active';
            else if (state.liveZoom)
                this._statusLabel.text = 'Live Zoom active';
            else
                this._statusLabel.text = 'Ready';
        }
    }

    destroy() {
        if (this._panelStyleId)
            Main.panel.disconnect(this._panelStyleId);
        if (this.actor?.menu && this._menuSignalId)
            this.actor.menu.disconnect(this._menuSignalId);

        if (this.actor) {
            try {
                Gio.Settings.unbind(this.actor, 'visible');
            } catch (_error) {
                // The actor may already have released the binding during teardown.
            }
        }

        this.actor?.destroy();

        this.actor = null;
        this._icon = null;
        this._headerItem = null;
        this._placeholderItem = null;
        this._highlightItem = null;
        this._shortcutLabels = null;
        this._statusLabel = null;
        this._restoreTimerItem = null;
        this._recordItem = null;
        this._menuSignalId = 0;
        this._panelStyleId = 0;
        this._iconDir = null;
        this._settings = null;
        this._actions = null;
        this._getState = null;
        this._logger = null;
        this._name = null;
        this._menuBuilt = false;
    }

    _buildMenu(name) {
        this._headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._headerItem.add_style_class_name('lumalens-menu-header');

        const headerIcon = this._createIcon(28, 'lumalens-menu-logo', 'zumi-menu.svg');
        this._headerItem.add_child(headerIcon);

        const headerText = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'lumalens-menu-header-text',
        });
        headerText.add_child(new St.Label({
            text: name,
            style_class: 'lumalens-menu-title',
        }));
        this._statusLabel = new St.Label({
            text: 'Ready',
            style_class: 'lumalens-menu-status',
            opacity: 165,
        });
        headerText.add_child(this._statusLabel);
        this._headerItem.add_child(headerText);
        this.actor.menu.addMenuItem(this._headerItem);

        this._shortcutLabels = new Map();
        this._restoreTimerItem = this._addShortcutAction(
            'Show break timer', 'break-timer', () => this._invoke('restoreTimer')
        );
        this._restoreTimerItem.visible = false;
        this.actor.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._addShortcutAction('Zoom', 'zoom-mode', () => this._invoke('zoom'));
        this._addShortcutAction('Draw', 'draw-mode', () => this._invoke('draw'));
        this._addShortcutAction('Countdown', 'break-timer', () => this._invoke('timer'));
        this._highlightItem = new PopupMenu.PopupSwitchMenuItem('Cursor highlight',
            this._settings.get_boolean('cursor-highlight-enabled'));
        this._highlightItem.connect('toggled', (_item, state) => {
            if (state !== this._settings.get_boolean('cursor-highlight-enabled'))
                this._invoke('highlight');
        });
        this.actor.menu.addMenuItem(this._highlightItem);
        this._addIconAction('Focus spotlight', 'find-location-symbolic', () => this._invoke('focus'));

        this.actor.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._recordItem = this._addShortcutAction('Record', 'record-full', () => this._invoke('record'));
        this._addShortcutAction('Save region', 'snip-save', () => this._invoke('saveSnip'));
        this._addMenuAction('Copy region', () => this._invoke('snip'));

        const shortcuts = new PopupMenu.PopupSubMenuMenuItem('Keyboard shortcuts');
        for (const [title, key] of [
            ['Zoom', 'zoom-mode'], ['Draw', 'draw-mode'], ['Countdown', 'break-timer'],
            ['Live Zoom', 'live-zoom'], ['Live Draw', 'live-draw'],
            ['Record screen', 'record-full'], ['Record region', 'record-region'],
            ['Record window', 'record-window'], ['Copy region', 'snip-copy'],
            ['Save region', 'snip-save'], ['OCR region', 'snip-ocr'],
            ['DemoType', 'demo-type'], ['Previous snippet', 'demo-type-previous'],
            ['Panorama', 'panorama'], ['Cursor highlight', 'cursor-highlight'],
        ]) {
            const item = new PopupMenu.PopupMenuItem(title, {reactive: false, can_focus: false});
            item.label.x_expand = true;
            const label = new St.Label({
                text: this._shortcutText(key),
                style_class: 'lumalens-menu-shortcut',
                opacity: 165,
            });
            item.add_child(label);
            this._shortcutLabels.set(key, label);
            shortcuts.menu.addMenuItem(item);
        }
        this.actor.menu.addMenuItem(shortcuts);
        this.actor.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._addIconAction(
            'Preferences',
            'emblem-system-symbolic',
            () => this._invoke('preferences')
        );
    }

    _createIcon(size, styleClass, filename) {
        // Let St.Icon rasterize the SVG at the monitor's scale factor.
        return new St.Icon({
            gicon: new Gio.FileIcon({file: Gio.File.new_for_path(`${this._iconDir}/${filename}`)}),
            icon_size: size,
            style_class: styleClass,
        });
    }

    _updatePanelIcon() {
        // FileIcon SVGs do not inherit currentColor, so pick a contrasting asset.
        const color = Main.panel.get_theme_node().get_foreground_color();
        const darkText = (color.red * 299 + color.green * 587 + color.blue * 114) < 128000;
        const filename = darkText ? 'zumi-panel-dark.svg' : 'zumi-panel-light.svg';
        this._icon.gicon = new Gio.FileIcon({
            file: Gio.File.new_for_path(`${this._iconDir}/${filename}`),
        });
    }

    _addShortcutAction(title, key, callback) {
        const item = new PopupMenu.PopupMenuItem(title);
        if (item.label)
            item.label.x_expand = true;

        const shortcutLabel = new St.Label({
            text: this._shortcutText(key),
            style_class: 'lumalens-menu-shortcut',
            opacity: 165,
        });
        item.add_child(shortcutLabel);
        item.connect('activate', callback);
        this.actor.menu.addMenuItem(item);
        return item;
    }

    _shortcutText(key) {
        const values = this._settings?.get_strv(key) ?? [];
        if (!values.length)
            return 'Off';
        return values.map(value => value
            .replaceAll('<Control>', 'Ctrl+')
            .replaceAll('<Shift>', 'Shift+')
            .replaceAll('<Alt>', 'Alt+')
            .replaceAll('<Super>', 'Super+')
            .replace(/\+$/g, '')).join(' / ');
    }

    _addMenuAction(title, callback) {
        const item = new PopupMenu.PopupMenuItem(title);
        item.connect('activate', callback);
        this.actor.menu.addMenuItem(item);
        return item;
    }

    _addIconAction(title, iconName, callback) {
        const item = new PopupMenu.PopupImageMenuItem(title, iconName, {});
        item.connect('activate', callback);
        this.actor.menu.addMenuItem(item);
        return item;
    }

    _invoke(name) {
        const callback = this._actions?.[name];
        if (typeof callback !== 'function')
            return;

        try {
            const result = callback();
            if (result && typeof result.catch === 'function') {
                result.catch(error => {
                    this._logger?.error?.(`Panel action "${name}" failed: ${error.message}`);
                });
            }
        } catch (error) {
            this._logger?.error?.(`Panel action "${name}" failed: ${error.message}`);
        }
    }
}
