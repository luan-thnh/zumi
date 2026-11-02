// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ZumiPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(720, 780);

        const page = new Adw.PreferencesPage({title: 'Zumi', icon_name: 'zoom-in-symbolic'});
        window.add(page);

        const general = new Adw.PreferencesGroup({
            title: 'General',
            description: 'Keep Zumi one click away from the GNOME top bar.',
        });
        page.add(general);

        const showIndicator = new Adw.SwitchRow({
            title: 'Show top bar icon',
            subtitle: 'Single-color Zumi focus icon with quick actions and a shortcut to Preferences',
        });
        general.add(showIndicator);
        settings.bind('show-panel-indicator', showIndicator, 'active', Gio.SettingsBindFlags.DEFAULT);

        const clipboardShortcuts = new Adw.SwitchRow({
            title: 'Enable clipboard keyboard shortcuts',
            subtitle: 'Opt in to Ctrl+6, Ctrl+Alt+6 and Ctrl+C/Ctrl+Shift+C while a Zumi canvas is active',
        });
        general.add(clipboardShortcuts);
        clipboardShortcuts.active = settings.get_boolean('clipboard-shortcuts-enabled');
        clipboardShortcuts.connect('notify::active', row => {
            const enabled = row.active;
            settings.set_boolean('clipboard-shortcuts-enabled', enabled);
            settings.set_strv('snip-copy', enabled ? ['<Control>6'] : []);
            settings.set_strv('snip-ocr', enabled ? ['<Control><Alt>6'] : []);
        });

        const shortcuts = new Adw.PreferencesGroup({
            title: 'ZoomIt shortcuts',
            description: 'ZoomIt 12.11 layout. Clipboard shortcuts are disabled until you explicitly opt in above, as required for extensions.gnome.org review.',
        });
        page.add(shortcuts);
        for (const [title, subtitle] of [
            ['Zoom / Draw / Break', 'Ctrl+1 · Ctrl+2 · Ctrl+3'],
            ['Live Zoom / LiveDraw', 'Ctrl+4 · Ctrl+Shift+4'],
            ['Recording', 'Ctrl+5 full · Ctrl+Shift+5 area · Ctrl+Alt+5 window'],
            ['Snip / OCR', 'Ctrl+Shift+6 save · Ctrl+6 copy and Ctrl+Alt+6 OCR after clipboard opt-in'],
            ['DemoType / Panorama', 'Ctrl+7 · Ctrl+Shift+7 previous · Ctrl+8 panorama'],
            ['Cursor highlight', 'Ctrl+Alt+H · or top-bar menu'],
            ['Pen colors', 'R G B Y O P · Shift+color = highlighter · X = blur'],
            ['Line / font size', 'Arrow Up/Down · Ctrl+wheel'],
            ['Shapes', 'Hold Shift line · Ctrl rectangle · Tab ellipse · Ctrl+Shift arrow'],
            ['Text / boards', 'T left · Shift+T right · W whiteboard · K blackboard'],
            ['Capture while Zoom/Draw', 'Ctrl+S save · Ctrl+Shift+S crop save · Ctrl+C/Ctrl+Shift+C after clipboard opt-in'],
            ['Edit / exit', 'Ctrl+Z undo · Ctrl+Shift+Z/Ctrl+Y redo · E clear · Space center cursor · Esc/right-click exit'],
        ])
            shortcuts.add(this._infoRow(title, subtitle));

        const zoom = new Adw.PreferencesGroup({title: 'Zoom', description: 'Smooth zoom is on by default. Turn animations off if you prefer instant scaling.'});
        page.add(zoom);
        const factor = this._spin('Initial zoom', 1.25, 4, 0.25, 2);
        zoom.add(factor);
        settings.bind('default-zoom-factor', factor, 'value', Gio.SettingsBindFlags.DEFAULT);
        const step = this._spin('Zoom step', 0.1, 1, 0.05, 2);
        zoom.add(step);
        settings.bind('zoom-step', step, 'value', Gio.SettingsBindFlags.DEFAULT);
        const max = this._spin('Maximum zoom', 2, 8, 0.5, 1);
        zoom.add(max);
        settings.bind('max-zoom-factor', max, 'value', Gio.SettingsBindFlags.DEFAULT);
        const animate = new Adw.SwitchRow({title: 'Animate entry', subtitle: '280 ms ease-out on Ctrl+1, enabled by default'});
        zoom.add(animate);
        settings.bind('animate-zoom', animate, 'active', Gio.SettingsBindFlags.DEFAULT);
        const smooth = new Adw.SwitchRow({title: 'Animate zoom steps', subtitle: '180 ms ease-out transition for smoother zoom steps'});
        zoom.add(smooth);
        settings.bind('smooth-zoom', smooth, 'active', Gio.SettingsBindFlags.DEFAULT);

        const draw = new Adw.PreferencesGroup({title: 'Drawing', description: 'Press T in Draw mode for a real GNOME text editor with caret, multiline input and IME support. Shift+T anchors text to the right.'});
        page.add(draw);
        const width = this._spin('Initial line width', 1, 48, 1, 0);
        draw.add(width);
        settings.bind('annotation-width', width, 'value', Gio.SettingsBindFlags.DEFAULT);
        const font = this._spin('Text size', 12, 96, 2, 0);
        draw.add(font);
        settings.bind('text-font-size', font, 'value', Gio.SettingsBindFlags.DEFAULT);

        const timer = new Adw.PreferencesGroup({
            title: 'Break timer',
            description: 'Floating countdown with blue progress. Appearance follows GNOME by default.',
        });
        page.add(timer);
        const minutes = this._spin('Minutes', 1, 180, 1, 0);
        timer.add(minutes);
        settings.bind('break-minutes', minutes, 'value', Gio.SettingsBindFlags.DEFAULT);
        const opacity = this._spin('Card opacity', 75, 100, 5, 0);
        timer.add(opacity);
        settings.bind('break-opacity', opacity, 'value', Gio.SettingsBindFlags.DEFAULT);
        const appearanceOptions = ['auto', 'dark', 'light'];
        const appearance = new Adw.ComboRow({
            title: 'Countdown appearance',
            subtitle: 'System follows GNOME; choose Dark or Light if your custom Shell theme differs.',
            model: Gtk.StringList.new(['System', 'Dark', 'Light']),
        });
        appearance.selected = Math.max(0, appearanceOptions.indexOf(settings.get_string('break-appearance')));
        appearance.connect('notify::selected', row => {
            if (row.selected < appearanceOptions.length)
                settings.set_string('break-appearance', appearanceOptions[row.selected]);
        });
        timer.add(appearance);
        const breakMessage = new Adw.EntryRow({title: 'Headline'});
        breakMessage.text = settings.get_string('break-message');
        breakMessage.connect('changed', row => settings.set_string('break-message', row.text));
        timer.add(breakMessage);
        const showEndTime = new Adw.SwitchRow({
            title: 'Show expected return time',
            subtitle: 'Displays the local clock time when the break is expected to end',
        });
        timer.add(showEndTime);
        settings.bind('break-show-end-time', showEndTime, 'active', Gio.SettingsBindFlags.DEFAULT);
        timer.add(this._infoRow('Timer controls', 'Space pause · R reset · Stop ends · Esc/Alt+Tab hides · Ctrl+3 opens again'));

        const focus = new Adw.PreferencesGroup({
            title: 'Focus Spotlight',
            description: 'Zumi extra: dim everything except a cursor-following spotlight. Open it from the top-bar menu; scroll changes the radius.',
        });
        page.add(focus);
        const focusRadius = this._spin('Spotlight radius', 90, 640, 10, 0);
        focus.add(focusRadius);
        settings.bind('focus-radius', focusRadius, 'value', Gio.SettingsBindFlags.DEFAULT);
        const focusDim = this._spin('Background dim', 20, 95, 5, 0);
        focus.add(focusDim);
        settings.bind('focus-dim-opacity', focusDim, 'value', Gio.SettingsBindFlags.DEFAULT);
        focus.add(this._statusRow(
            'No shortcut conflict',
            'Focus Spotlight is intentionally launched from the Zumi top-bar menu so the ZoomIt Ctrl+1…8 shortcut contract stays untouched.',
            'find-location-symbolic'
        ));

        const cursor = new Adw.PreferencesGroup({
            title: 'Cursor highlight',
            description: 'Lightweight yellow ring that follows the pointer without blocking clicks. Off at startup unless enabled.',
        });
        page.add(cursor);
        const cursorOn = new Adw.SwitchRow({
            title: 'Enable cursor highlight',
            subtitle: 'Shortcut: Ctrl+Alt+H · also available from the top-bar menu',
        });
        cursor.add(cursorOn);
        settings.bind('cursor-highlight-enabled', cursorOn, 'active', Gio.SettingsBindFlags.DEFAULT);
        const cursorSize = this._spin('Circle diameter (px)', 24, 120, 4, 0);
        cursor.add(cursorSize);
        settings.bind('cursor-highlight-size', cursorSize, 'value', Gio.SettingsBindFlags.DEFAULT);
        const colors = ['#ffcc33', '#ffe000', '#6dd6ff', '#f8f8ff', '#ff7373'];
        const cursorColor = new Adw.ComboRow({
            title: 'Ring color',
            model: Gtk.StringList.new(['Amber', 'Yellow', 'Sky blue', 'White', 'Coral']),
        });
        cursor.add(cursorColor);
        cursorColor.selected = Math.max(0, colors.indexOf(settings.get_string('cursor-highlight-color')));
        cursorColor.connect('notify::selected', row => {
            if (row.selected < colors.length)
                settings.set_string('cursor-highlight-color', colors[row.selected]);
        });

        const demo = new Adw.PreferencesGroup({
            title: 'DemoType',
            description: 'Separate snippets with |. Ctrl+7 types the current snippet; Ctrl+Shift+7 goes back.',
        });
        page.add(demo);
        const speed = this._spin('Typing speed', 10, 100, 5, 0);
        demo.add(speed);
        settings.bind('demo-type-speed', speed, 'value', Gio.SettingsBindFlags.DEFAULT);
        const snippets = new Adw.EntryRow({title: 'Snippets'});
        snippets.text = settings.get_strv('demo-type-snippets').join(' | ');
        snippets.connect('changed', row => {
            settings.set_strv('demo-type-snippets', row.text.split('|').map(item => item.trim()).filter(Boolean));
        });
        demo.add(snippets);

        const platform = new Adw.PreferencesGroup({title: 'Linux / GNOME integration'});
        page.add(platform);
        platform.add(this._statusRow(
            'Recording',
            'Uses GNOME Shell’s screencast service for direct start/stop, with the native recorder UI as fallback.',
            'media-record-symbolic'
        ));
        platform.add(this._statusRow(
            'OCR',
            GLib.find_program_in_path('tesseract')
                ? 'Tesseract detected. Ctrl+Alt+6 is ready.'
                : 'Install tesseract-ocr to enable Ctrl+Alt+6.',
            GLib.find_program_in_path('tesseract') ? 'emblem-ok-symbolic' : 'dialog-warning-symbolic'
        ));
        platform.add(this._statusRow(
            'Clipboard',
            'Clipboard access happens only after an explicit menu action or after you enable clipboard keyboard shortcuts in Preferences.',
            'edit-paste-symbolic'
        ));
    }

    _spin(title, lower, upper, step, digits) {
        return new Adw.SpinRow({
            title,
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: step,
                page_increment: Math.max(step, 1),
            }),
            digits,
        });
    }

    _infoRow(title, subtitle) {
        const row = new Adw.ActionRow({title, subtitle});
        row.add_suffix(new Gtk.Image({icon_name: 'input-keyboard-symbolic'}));
        return row;
    }

    _statusRow(title, subtitle, iconName) {
        const row = new Adw.ActionRow({title, subtitle});
        row.add_suffix(new Gtk.Image({icon_name: iconName}));
        return row;
    }
}
