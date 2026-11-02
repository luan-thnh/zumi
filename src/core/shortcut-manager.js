// SPDX-License-Identifier: GPL-3.0-or-later


import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ShortcutManager {
    constructor(settings) {
        this._settings = settings;
        this._bindings = new Set();
    }

    add(name, handler) {
        Main.wm.addKeybinding(
            name,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            handler
        );
        this._bindings.add(name);
    }

    remove(name) {
        if (!this._bindings.has(name))
            return;

        Main.wm.removeKeybinding(name);
        this._bindings.delete(name);
    }

    destroy() {
        for (const name of this._bindings)
            Main.wm.removeKeybinding(name);

        this._bindings.clear();
        this._settings = null;
    }
}
