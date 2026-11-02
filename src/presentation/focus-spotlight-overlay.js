// SPDX-License-Identifier: GPL-3.0-or-later

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {showOnTop} from '../core/actor-utils.js';

const MIN_RADIUS = 90;
const MAX_RADIUS = 640;

export class FocusSpotlightOverlay {
    constructor({radius = 220, dimOpacity = 72, monitorProvider = null, onClose}) {
        this._radius = clamp(Math.round(radius), MIN_RADIUS, MAX_RADIUS);
        this._dimOpacity = clamp(dimOpacity / 100, 0.2, 0.95);
        this._monitorProvider = monitorProvider;
        this._onClose = onClose;
        this._monitor = null;
        this._cursor = [0, 0];
        this._repaintSourceId = 0;

        this.actor = new St.DrawingArea({
            style_class: 'lumalens-focus-spotlight',
            reactive: true,
            can_focus: true,
            clip_to_allocation: true,
        });

        this._repaintId = this.actor.connect('repaint', area => this._paint(area));
        this._capturedId = this.actor.connect('captured-event', (_actor, event) => this._handle(event));
        this._syncMonitorBounds();
    }

    show() {
        this._syncMonitorBounds();
        showOnTop(this.actor);
        this.actor.grab_key_focus();
        this.actor.queue_repaint();
    }

    destroy() {
        if (this._repaintSourceId)
            GLib.Source.remove(this._repaintSourceId);
        this._repaintSourceId = 0;
        if (this.actor && this._repaintId)
            this.actor.disconnect(this._repaintId);
        if (this.actor && this._capturedId)
            this.actor.disconnect(this._capturedId);
        this.actor?.destroy();
        this.actor = null;
        this._repaintId = 0;
        this._capturedId = 0;
        this._monitor = null;
        this._monitorProvider = null;
        this._onClose = null;
    }

    _syncMonitorBounds() {
        const monitor = this._monitorProvider?.() ?? {
            index: 0,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        };
        this._monitor = monitor;
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, monitor.height);

        const [pointerX, pointerY] = global.get_pointer();
        this._cursor = [pointerX - monitor.x, pointerY - monitor.y];
    }

    _handle(event) {
        const type = event.type();
        if (type === Clutter.EventType.MOTION) {
            const [stageX, stageY] = event.get_coords();
            this._cursor = [stageX - this._monitor.x, stageY - this._monitor.y];
            if (!this._repaintSourceId) {
                this._repaintSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
                    this._repaintSourceId = 0;
                    this.actor?.queue_repaint();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.SCROLL) {
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP)
                this._radius = clamp(this._radius + 18, MIN_RADIUS, MAX_RADIUS);
            if (direction === Clutter.ScrollDirection.DOWN)
                this._radius = clamp(this._radius - 18, MIN_RADIUS, MAX_RADIUS);
            this.actor.queue_repaint();
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.BUTTON_PRESS && event.get_button() === Clutter.BUTTON_SECONDARY) {
            this._onClose?.();
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this._onClose?.();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    _paint(area) {
        const cr = area.get_context();
        try {
            const [x, y] = this._cursor;
            cr.setOperator(Cairo.Operator.OVER);
            cr.setSourceRGBA(0.015, 0.02, 0.035, this._dimOpacity);
            cr.paint();

            cr.setOperator(Cairo.Operator.CLEAR);
            cr.arc(x, y, this._radius, 0, Math.PI * 2);
            cr.fill();

            cr.setOperator(Cairo.Operator.OVER);
            cr.setLineWidth(2);
            cr.setSourceRGBA(0.75, 0.88, 1.0, 0.78);
            cr.arc(x, y, this._radius + 1, 0, Math.PI * 2);
            cr.stroke();

            cr.setLineWidth(1);
            cr.setSourceRGBA(1, 1, 1, 0.42);
            cr.arc(x, y, Math.max(4, this._radius - 8), 0, Math.PI * 2);
            cr.stroke();
        } finally {
            cr.$dispose();
        }
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
