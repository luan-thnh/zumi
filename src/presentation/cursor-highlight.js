// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DEFAULT_COLOR = '#ffcc33';

export class CursorHighlight {
    constructor({settings}) {
        this._settings = settings;
        this._tracker = global.backend.get_cursor_tracker();
        this._moveSourceId = 0;
        this.actor = new St.Widget({
            reactive: false,
            can_focus: false,
            style_class: 'lumalens-cursor-highlight',
        });
        // An unreactive actor does not steal mouse clicks from applications.
        Main.uiGroup.add_child(this.actor);
        Main.uiGroup.set_child_above_sibling(this.actor, null);
        this._positionId = this._tracker.connect('position-invalidated', () => this._scheduleMove());
        this._sizeId = settings.connect('changed::cursor-highlight-size', () => this._updateStyle());
        this._colorId = settings.connect('changed::cursor-highlight-color', () => this._updateStyle());
        this._updateStyle();
        this._move();
    }

    _updateStyle() {
        const size = Math.max(24, Math.min(120, this._settings.get_int('cursor-highlight-size')));
        const storedColor = this._settings.get_string('cursor-highlight-color');
        const color = /^#[0-9a-fA-F]{6}$/.test(storedColor) ? storedColor : DEFAULT_COLOR;
        this._size = size;
        this.actor.set_size(size, size);
        // Drawn once as a small Clutter actor; moving it does not repaint the screen with Cairo.
        const red = parseInt(color.slice(1, 3), 16);
        const green = parseInt(color.slice(3, 5), 16);
        const blue = parseInt(color.slice(5, 7), 16);
        this.actor.set_style(`border: 3px solid ${color}; border-radius: ${Math.ceil(size / 2)}px; background-color: transparent; box-shadow: 0 0 12px 3px rgba(${red}, ${green}, ${blue}, 0.36);`);
        this._move();
    }

    _scheduleMove() {
        // Coalesce high-frequency mouse events into one actor update per idle turn.
        if (this._moveSourceId)
            return;
        this._moveSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._moveSourceId = 0;
            this._move();
            return GLib.SOURCE_REMOVE;
        });
    }

    _move() {
        if (!this.actor)
            return;
        const [x, y] = global.get_pointer();
        const left = Math.round(x - this._size / 2);
        const top = Math.round(y - this._size / 2);
        if (this._lastX === left && this._lastY === top)
            return;
        this._lastX = left;
        this._lastY = top;
        this.actor.set_position(left, top);
    }

    destroy() {
        if (this._moveSourceId)
            GLib.Source.remove(this._moveSourceId);
        if (this._positionId)
            this._tracker.disconnect(this._positionId);
        if (this._settings && this._sizeId)
            this._settings.disconnect(this._sizeId);
        if (this._settings && this._colorId)
            this._settings.disconnect(this._colorId);
        this.actor?.destroy();
        this.actor = null;
        this._tracker = null;
        this._settings = null;
        this._positionId = 0;
        this._moveSourceId = 0;
        this._sizeId = 0;
        this._colorId = 0;
    }
}
