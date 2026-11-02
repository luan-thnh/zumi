// SPDX-License-Identifier: GPL-3.0-or-later

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {showOnTop} from '../core/actor-utils.js';

export class RegionSelectorOverlay {
    constructor({onSelected, onCancel = null}) {
        this._onSelected = onSelected;
        this._onCancel = onCancel;
        this._start = null;
        this._current = null;

        this.actor = new St.Widget({
            style_class: 'lumalens-region-selector',
            reactive: true,
            can_focus: true,
            width: global.stage.width,
            height: global.stage.height,
            layout_manager: new Clutter.BinLayout(),
        });

        this._canvas = new St.DrawingArea({x_expand: true, y_expand: true});
        this.actor.add_child(this._canvas);
        this._repaintId = this._canvas.connect('repaint', area => this._paint(area));
        this._eventId = this.actor.connect('captured-event', (_actor, event) => this._handle(event));
    }

    show() {
        showOnTop(this.actor);
        this.actor.grab_key_focus();
    }

    destroy() {
        if (this._canvas && this._repaintId)
            this._canvas.disconnect(this._repaintId);
        if (this.actor && this._eventId)
            this.actor.disconnect(this._eventId);
        this.actor?.destroy();
        this.actor = null;
        this._canvas = null;
        this._onSelected = null;
        this._onCancel = null;
        this._repaintId = 0;
        this._eventId = 0;
    }

    _handle(event) {
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this._onCancel?.();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS) {
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                this._onCancel?.();
                return Clutter.EVENT_STOP;
            }
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                const [x, y] = event.get_coords();
                this._start = {x, y};
                this._current = {x, y};
                this._canvas.queue_repaint();
            }
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.MOTION && this._start) {
            const [x, y] = event.get_coords();
            this._current = {x, y};
            this._canvas.queue_repaint();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE && event.get_button() === Clutter.BUTTON_PRIMARY && this._start) {
            const [x, y] = event.get_coords();
            this._current = {x, y};
            const rect = this._rect();
            this._start = null;
            this._current = null;
            if (rect.width >= 4 && rect.height >= 4)
                this._onSelected?.(rect);
            else
                this._onCancel?.();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_STOP;
    }

    _paint(area) {
        const cr = area.get_context();
        try {
            const width = this.actor.width;
            const height = this.actor.height;
            cr.setSourceRGBA(0, 0, 0, 0.34);
            cr.rectangle(0, 0, width, height);
            cr.fill();

            if (!this._start || !this._current)
                return;

            const rect = this._rect();
            cr.save();
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.rectangle(rect.x, rect.y, rect.width, rect.height);
            cr.fill();
            cr.restore();

            cr.setSourceRGBA(1, 1, 1, 0.96);
            cr.setLineWidth(2);
            cr.rectangle(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2));
            cr.stroke();
        } finally {
            cr.$dispose();
        }
    }

    _rect() {
        const x = Math.min(this._start.x, this._current.x);
        const y = Math.min(this._start.y, this._current.y);
        return {
            x,
            y,
            width: Math.abs(this._current.x - this._start.x),
            height: Math.abs(this._current.y - this._start.y),
        };
    }
}
