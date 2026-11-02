// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class DemoTypeService {
    constructor({settings, notify = null, logger = console}) {
        this._settings = settings;
        this._notify = notify;
        this._logger = logger;
        this._sourceId = 0;
        this._eventId = 0;
        this._engaged = false;
        this._index = 0;
        this._snippetIndex = 0;
        this._text = [];
        this._virtualDevice = null;
    }

    get active() {
        return this._engaged;
    }

    toggle() {
        if (this._engaged) {
            this.stop();
            this._notify?.('DemoType off');
            return false;
        }

        this._engage();
        return this.startCurrent();
    }

    previous() {
        this._engage();
        this._stopTyping();
        const snippets = this._snippets();
        if (!snippets.length) {
            this._notify?.('DemoType: add snippets in Preferences');
            return false;
        }
        this._snippetIndex = (this._snippetIndex - 1 + snippets.length) % snippets.length;
        return this._start(snippets[this._snippetIndex]);
    }

    next() {
        this._engage();
        this._stopTyping();
        const snippets = this._snippets();
        if (!snippets.length)
            return false;
        this._snippetIndex = (this._snippetIndex + 1) % snippets.length;
        return this._start(snippets[this._snippetIndex]);
    }

    startCurrent() {
        const snippets = this._snippets();
        if (!snippets.length) {
            this._notify?.('DemoType: add snippets in Preferences');
            return false;
        }
        this._snippetIndex = Math.min(this._snippetIndex, snippets.length - 1);
        return this._start(snippets[this._snippetIndex]);
    }

    stop() {
        this._stopTyping();
        if (this._eventId)
            global.stage.disconnect(this._eventId);
        this._eventId = 0;
        this._engaged = false;
        this._text = [];
    }

    _engage() {
        if (this._engaged)
            return;
        if (!this._virtualDevice) {
            try {
                const seat = global.stage.context.get_backend().get_default_seat();
                this._virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            } catch (error) {
                this._logger?.warn?.(`DemoType virtual keyboard unavailable: ${error.message}`);
            }
        }
        this._engaged = true;
        this._eventId = global.stage.connect('captured-event', (_stage, event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS)
                return Clutter.EVENT_PROPAGATE;

            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                this.stop();
                this._notify?.('DemoType off');
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_space && !this._sourceId) {
                this.next();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _start(text) {
        this._text = Array.from(String(text ?? ''));
        this._index = 0;
        if (!this._text.length)
            return false;

        const speed = this._settings.get_int('demo-type-speed');
        const delay = Math.max(10, Math.round(125 - speed * 1.15));
        this._notify?.(`DemoType ${this._snippetIndex + 1}/${this._snippets().length}`);

        this._sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            if (this._index >= this._text.length) {
                this._sourceId = 0;
                this._notify?.('Space → next snippet');
                return GLib.SOURCE_REMOVE;
            }

            const char = this._text[this._index++];
            if (!this._injectCharacter(char)) {
                this._sourceId = 0;
                this._notify?.('DemoType could not type into this app');
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        return true;
    }

    _stopTyping() {
        if (this._sourceId)
            GLib.Source.remove(this._sourceId);
        this._sourceId = 0;
        this._index = 0;
    }

    _injectCharacter(char) {
        try {
            if (Main.inputMethod?.currentFocus && typeof Main.inputMethod.commit === 'function') {
                Main.inputMethod.commit(char);
                return true;
            }
        } catch (_error) {
            // Fallback below covers non-IME/XWayland/Electron fields.
        }

        if (!this._virtualDevice)
            return false;

        let keyval;
        if (char === '\n')
            keyval = Clutter.KEY_Return;
        else if (char === '\t')
            keyval = Clutter.KEY_Tab;
        else
            keyval = Clutter.unicode_to_keysym(char.codePointAt(0));

        if (!keyval)
            return false;

        try {
            const time = GLib.get_monotonic_time();
            this._virtualDevice.notify_keyval(time, keyval, Clutter.KeyState.PRESSED);
            this._virtualDevice.notify_keyval(time + 1, keyval, Clutter.KeyState.RELEASED);
            return true;
        } catch (error) {
            this._logger?.warn?.(`DemoType key injection failed: ${error.message}`);
            return false;
        }
    }

    _snippets() {
        return this._settings.get_strv('demo-type-snippets')
            .map(value => value.trim())
            .filter(Boolean);
    }

    destroy() {
        this.stop();
        this._virtualDevice = null;
        this._settings = null;
        this._notify = null;
        this._logger = null;
    }
}
