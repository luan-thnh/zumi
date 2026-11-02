// SPDX-License-Identifier: GPL-3.0-or-later

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {showOnTop} from '../core/actor-utils.js';
import {BreakTimerModel} from './timer-model.js';

const CARD_WIDTH = 312;
const CARD_HEIGHT = 364;
const RING_SIZE = 216;

export class BreakTimerOverlay {
    constructor({
        minutes = 10,
        opacity = 96,
        message = 'Back in a moment',
        showEndTime = true,
        appearance = 'auto',
        settings = null,
        monitorProvider = null,
        onClose,
        onAction = null,
    }) {
        this._model = new BreakTimerModel(Math.max(1, Math.round(minutes * 60)));
        this._monitorProvider = monitorProvider;
        this._onClose = onClose;
        this._onAction = onAction;
        this._showEndTime = Boolean(showEndTime);
        this._appearance = appearance;
        this._settings = settings;
        this._appearanceChangedId = 0;
        this._tickId = 0;
        this._visible = false;
        this._ringPaintId = 0;
        this._capturedId = 0;
        this._opacity = Math.max(75, Math.min(100, opacity)) / 100;
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._themeChangedIds = [];
        this._isDark = false;
        // The settings source can be out of sync with a custom Shell theme.
        // Auto follows GNOME; Dark/Light in Preferences is the explicit fallback.

        // Only the small card receives pointer input; the desktop stays usable.
        this.actor = new St.BoxLayout({
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            style_class: 'lumalens-break-card',
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
        });
        this.actor.set_accessible_name(String(message || 'Countdown'));
        for (const key of ['color-scheme', 'gtk-theme']) {
            this._themeChangedIds.push(this._interfaceSettings.connect(`changed::${key}`,
                () => this._applyTheme()));
        }

        this._ring = new St.Widget({
            style_class: 'lumalens-break-ring',
            width: RING_SIZE,
            height: RING_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        this.actor.add_child(this._ring);
        this._ringArea = new St.DrawingArea({
            reactive: false,
            width: RING_SIZE,
            height: RING_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ring.add_child(this._ringArea);
        this._ringPaintId = this._ringArea.connect('repaint', area => this._paintRing(area));

        const center = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'lumalens-break-center',
        });
        this._ring.add_child(center);

        this._label = new St.Label({
            text: '00:00',
            style_class: 'lumalens-break-time',
            x_align: Clutter.ActorAlign.CENTER,
        });
        center.add_child(this._label);
        this._endLabel = new St.Label({
            text: '',
            style_class: 'lumalens-break-end',
            x_align: Clutter.ActorAlign.CENTER,
        });
        center.add_child(this._endLabel);

        this._controls = new St.BoxLayout({
            style_class: 'lumalens-break-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._controls);

        this._resetButton = this._createActionButton('view-refresh-symbolic', 'Reset', '', () => {
            this._model.reset();
            this._update();
        });
        this._pauseButton = this._createActionButton('media-playback-pause-symbolic', 'Pause',
            'lumalens-timer-action-primary', () => {
                this._model.togglePause();
                this._update();
            });
        this._stopButton = this._createActionButton('media-playback-stop-symbolic', 'Stop', '', () => this._onClose?.());
        this._controls.add_child(this._resetButton);
        this._controls.add_child(this._pauseButton);
        this._controls.add_child(this._stopButton);

        if (this._settings) {
            this._appearanceChangedId = this._settings.connect('changed::break-appearance', () => {
                this._appearance = this._settings.get_string('break-appearance');
                this._applyTheme();
            });
        }
        this._applyTheme();

        this._capturedId = this.actor.connect('captured-event', (_actor, event) => this._handle(event));
        this._syncMonitorBounds();
        this._update();
    }

    get visible() { return this._visible; }
    get paused() { return this._model?.paused ?? false; }
    get remaining() { return this._model?.remaining ?? 0; }

    show() {
        this._syncMonitorBounds();
        showOnTop(this.actor);
        this.actor.grab_key_focus();
        this._visible = true;
        if (!this._tickId) {
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (this._model.tick())
                    this._update();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    minimize() {
        this.actor?.hide();
        this._visible = false;
    }

    destroy() {
        for (const id of this._themeChangedIds)
            this._interfaceSettings?.disconnect(id);
        this._themeChangedIds = [];
        if (this._settings && this._appearanceChangedId)
            this._settings.disconnect(this._appearanceChangedId);
        this._appearanceChangedId = 0;
        this._settings = null;
        this._interfaceSettings = null;
        if (this._tickId)
            GLib.Source.remove(this._tickId);
        if (this._ringArea && this._ringPaintId)
            this._ringArea.disconnect(this._ringPaintId);
        if (this.actor && this._capturedId)
            this.actor.disconnect(this._capturedId);
        this.actor?.destroy();
        this.actor = null;
        this._ring = null;
        this._ringArea = null;
        this._label = null;
        this._endLabel = null;
        this._controls = null;
        this._pauseButton = null;
        this._resetButton = null;
        this._stopButton = null;
        this._model = null;
        this._tickId = 0;
        this._ringPaintId = 0;
        this._capturedId = 0;
        this._visible = false;
        this._monitorProvider = null;
        this._appearance = null;
        this._onClose = null;
        this._onAction = null;
        this._showEndTime = false;
    }

    _applyTheme() {
        const scheme = this._interfaceSettings.get_string('color-scheme');
        const gtkTheme = this._interfaceSettings.get_string('gtk-theme');
        const dark = this._appearance === 'dark' ||
            (this._appearance !== 'light' &&
                (scheme === 'prefer-dark' ||
                (scheme !== 'prefer-light' && /dark/i.test(gtkTheme))));
        this._isDark = dark;
        this.actor.style_class = `lumalens-break-card lumalens-break-card-${dark ? 'dark' : 'light'}`;
        // Inline colors prevent a stale Shell theme stylesheet from overriding the palette.
        this.actor.style = dark
            ? `background-color: rgba(18, 25, 40, ${this._opacity}); border: 1px solid #34455f;`
            : `background-color: rgba(245, 249, 255, ${this._opacity}); border: 1px solid #c7d6ef;`;
        if (this._label) {
            this._label.style = dark ? 'color: #f5f8ff;' : 'color: #14243c;';
            this._endLabel.style = dark ? 'color: #b5c6dd;' : 'color: #526783;';
            const secondary = dark
                ? 'color: #e7f0ff; background-color: #2a3954;'
                : 'color: #243957; background-color: #ffffff;';
            this._resetButton.style = secondary;
            this._stopButton.style = secondary;
            this._pauseButton.style = 'color: #ffffff; background-color: #387af9;';
        }
        this._ringArea?.queue_repaint();
    }

    _syncMonitorBounds() {
        const monitor = this._monitorProvider?.() ?? {
            x: 0, y: 0, width: global.stage.width, height: global.stage.height,
        };
        const x = monitor.x + Math.max(0, Math.floor((monitor.width - CARD_WIDTH) / 2));
        const y = monitor.y + Math.max(0, Math.floor((monitor.height - CARD_HEIGHT) / 2));
        this.actor.set_position(x, y);
    }

    _createActionButton(iconName, label, extraClass, callback) {
        const button = new St.Button({
            style_class: `lumalens-timer-action ${extraClass}`.trim(),
            can_focus: true,
            reactive: true,
            accessible_name: label,
            child: new St.Icon({icon_name: iconName, icon_size: 20}),
        });
        button.connect('clicked', callback);
        return button;
    }

    _handle(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS && this._isControlEvent(event))
            return Clutter.EVENT_PROPAGATE;
        if (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === Clutter.BUTTON_SECONDARY) {
            this.minimize();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.KEY_PRESS) {
            const key = event.get_key_symbol();
            if (event.has_control_modifier()) {
                const action = this._zoomItActionForKey(key, {
                    shift: event.has_shift_modifier(), alt: this._hasAlt(event),
                });
                if (action) {
                    this._onAction?.(action);
                    return Clutter.EVENT_STOP;
                }
            }
            if (key === Clutter.KEY_Escape || key === Clutter.KEY_h || key === Clutter.KEY_H) {
                this.minimize();
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Tab && this._hasAlt(event)) {
                this.minimize();
                return Clutter.EVENT_PROPAGATE;
            }
            if (key === Clutter.KEY_space) {
                this._model.togglePause();
                this._update();
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_r || key === Clutter.KEY_R) {
                this._model.reset();
                this._update();
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Up || key === Clutter.KEY_Down) {
                this._model.adjustMinutes(key === Clutter.KEY_Up ? 1 : -1);
                this._update();
                return Clutter.EVENT_STOP;
            }
        }
        if (type === Clutter.EventType.SCROLL && event.has_control_modifier()) {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP)
                this._model.adjustMinutes(1);
            if (dir === Clutter.ScrollDirection.DOWN)
                this._model.adjustMinutes(-1);
            this._update();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _isControlEvent(event) {
        try {
            const source = event.get_source();
            return Boolean(source && this._controls?.contains?.(source));
        } catch (_error) {
            return false;
        }
    }

    _zoomItActionForKey(key, {shift = false, alt = false} = {}) {
        if (key === Clutter.KEY_1) return 'zoom-mode';
        if (key === Clutter.KEY_2) return 'draw-mode';
        if (key === Clutter.KEY_3) return 'break-timer';
        if (key === Clutter.KEY_4) return shift ? 'live-draw' : 'live-zoom';
        if (key === Clutter.KEY_5) return alt ? 'record-window' : shift ? 'record-region' : 'record-full';
        if (key === Clutter.KEY_6) return alt ? 'snip-ocr' : shift ? 'snip-save' : 'snip-copy';
        if (key === Clutter.KEY_7) return shift ? 'demo-type-previous' : 'demo-type';
        if (key === Clutter.KEY_8) return 'panorama';
        return null;
    }

    _hasAlt(event) {
        try {
            return Boolean(event.get_state() & Clutter.ModifierType.MOD1_MASK);
        } catch (_error) {
            return false;
        }
    }

    _update() {
        if (!this._model)
            return;
        this._label.text = this._model.displayText;
        if (this._model.paused)
            this._endLabel.text = 'Paused';
        else if (this._model.overtime)
            this._endLabel.text = 'Overtime';
        else if (this._showEndTime) {
            const end = GLib.DateTime.new_now_local().add_seconds(this._model.remaining);
            this._endLabel.text = `Until ${end.format('%H:%M')}`;
        } else
            this._endLabel.text = 'Remaining time';
        this._pauseButton.child.icon_name = this._model.paused
            ? 'media-playback-start-symbolic'
            : 'media-playback-pause-symbolic';
        this._pauseButton.accessible_name = this._model.paused ? 'Resume' : 'Pause';
        this._ringArea?.queue_repaint();
    }

    _paintRing(area) {
        const cr = area.get_context();
        try {
            const [width, height] = area.get_surface_size();
            const cx = width / 2;
            const cy = height / 2;
            const radius = Math.max(0, Math.min(width, height) / 2 - 13);
            const start = -Math.PI / 2;
            const progress = this._model?.progress ?? 0;
            cr.setLineWidth(11);
            cr.setLineCap(Cairo.LineCap.ROUND);
            if (this._isDark)
                cr.setSourceRGBA(0.30, 0.39, 0.54, 0.80);
            else
                cr.setSourceRGBA(0.84, 0.89, 0.97, 1);
            cr.arc(cx, cy, radius, 0, Math.PI * 2);
            cr.stroke();
            // Keep a blue starting dot even at 00:00 elapsed; never use the old green accent.
            cr.setSourceRGBA(56 / 255, 122 / 255, 249 / 255, 1);
            cr.arc(cx, cy, radius, start, start + Math.PI * 2 * Math.max(progress, 0.001));
            cr.stroke();
        } finally {
            cr.$dispose();
        }
    }
}
