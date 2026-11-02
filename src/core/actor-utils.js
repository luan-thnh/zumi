// SPDX-License-Identifier: GPL-3.0-or-later

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Add an actor to Main.uiGroup if needed and move it above the other children.
 *
 * The old actor-level raise-to-top helper is not part of the GNOME 50 Clutter API. The
 * supported child-ordering API lives on the parent actor.
 */
export function showOnTop(actor, parent = Main.uiGroup) {
    if (!actor || !parent)
        return false;

    const currentParent = actor.get_parent?.() ?? null;
    if (!currentParent)
        parent.add_child(actor);
    else if (currentParent !== parent) {
        currentParent.remove_child(actor);
        parent.add_child(actor);
    }

    parent.set_child_above_sibling(actor, null);
    actor.show();
    return true;
}
