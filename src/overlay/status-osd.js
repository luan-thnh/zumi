// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import St from 'gi://St';

import {showOnTop} from '../core/actor-utils.js';

export class StatusOsd {
    constructor({monitorProvider = null} = {}) {
        this._hideId = 0;
        this._monitorProvider = monitorProvider;
        this._label = new St.Label({style_class: 'lumalens-status-osd', opacity: 0});
        this._label.hide();
    }

    show(text, ms = 720) {
        if (!this._label)
            return;

        showOnTop(this._label);
        this._label.show();
        this._label.text = String(text);
        const [, width] = this._label.get_preferred_width(-1);
        const monitor = this._monitorProvider?.() ?? {
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        };
        this._label.set_position(
            monitor.x + Math.round((monitor.width - width) / 2),
            monitor.y + 28
        );
        this._label.remove_all_transitions();
        this._label.opacity = 255;

        if (this._hideId)
            GLib.Source.remove(this._hideId);
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._hideId = 0;
            if (this._label) {
                this._label.remove_all_transitions();
                this._label.opacity = 0;
                this._label.hide();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    hide() {
        if (!this._label)
            return;
        if (this._hideId)
            GLib.Source.remove(this._hideId);
        this._hideId = 0;
        this._label.remove_all_transitions();
        this._label.opacity = 0;
        this._label.hide();
    }

    destroy() {
        if (this._hideId)
            GLib.Source.remove(this._hideId);
        this._label?.remove_all_transitions();
        this._label?.destroy();
        this._label = null;
        this._hideId = 0;
        this._monitorProvider = null;
    }
}
