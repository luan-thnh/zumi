// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';

export class LiveZoomInputController {
    constructor({zoomController, onClose, onFactorChanged = null}) {
        this._zoom = zoomController;
        this._onClose = onClose;
        this._onFactorChanged = onFactorChanged;
        this._eventId = 0;
    }

    start() {
        if (this._eventId)
            return;
        this._eventId = global.stage.connect('captured-event', (_stage, event) => this._handle(event));
    }

    _handle(event) {
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS) {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                this._onClose?.();
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Up) {
                this._onFactorChanged?.(this._zoom.zoomIn());
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Down) {
                this._onFactorChanged?.(this._zoom.zoomOut());
                return Clutter.EVENT_STOP;
            }
        }

        if (type === Clutter.EventType.SCROLL) {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP) {
                this._onFactorChanged?.(this._zoom.zoomIn());
                return Clutter.EVENT_STOP;
            }
            if (dir === Clutter.ScrollDirection.DOWN) {
                this._onFactorChanged?.(this._zoom.zoomOut());
                return Clutter.EVENT_STOP;
            }
            if (dir === Clutter.ScrollDirection.SMOOTH && typeof event.get_scroll_delta === 'function') {
                const [, dy] = event.get_scroll_delta();
                if (dy < -0.05) {
                    this._onFactorChanged?.(this._zoom.zoomIn());
                    return Clutter.EVENT_STOP;
                }
                if (dy > 0.05) {
                    this._onFactorChanged?.(this._zoom.zoomOut());
                    return Clutter.EVENT_STOP;
                }
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        if (this._eventId)
            global.stage.disconnect(this._eventId);
        this._eventId = 0;
        this._zoom = null;
        this._onClose = null;
        this._onFactorChanged = null;
    }
}
