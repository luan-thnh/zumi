// SPDX-License-Identifier: GPL-3.0-or-later

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {containsPoint, monitorAtPoint} from './monitor-geometry.js';

export class MonitorManager {
    get monitors() {
        return Main.layoutManager.monitors.map((monitor, index) => ({
            index,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        }));
    }

    /**
     * Resolve the logical monitor that currently owns the pointer.
     *
     * Mutter's get_current_monitor() is pointer based, but we also verify the
     * geometry against Shell.Global.get_pointer() so mixed layouts / monitor
     * reconfiguration cannot leave an overlay centered on the wrong display.
     */
    getCurrentMonitor() {
        const monitors = this.monitors;
        const [pointerX, pointerY] = global.get_pointer();
        const currentIndex = global.display.get_current_monitor();
        const reported = monitors.find(monitor => monitor.index === currentIndex) ?? null;

        if (reported && containsPoint(reported, pointerX, pointerY))
            return reported;

        const byPointer = monitorAtPoint(monitors, pointerX, pointerY);
        if (byPointer)
            return byPointer;

        if (reported)
            return reported;

        const primary = Main.layoutManager.primaryMonitor;
        if (primary) {
            const index = Main.layoutManager.monitors.indexOf(primary);
            return {
                index,
                x: primary.x,
                y: primary.y,
                width: primary.width,
                height: primary.height,
            };
        }

        return {
            index: 0,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        };
    }

    destroy() {
    }
}
