// SPDX-License-Identifier: GPL-3.0-or-later

export function containsPoint(monitor, x, y) {
    if (!monitor)
        return false;

    return x >= monitor.x && x < monitor.x + monitor.width &&
        y >= monitor.y && y < monitor.y + monitor.height;
}

export function monitorAtPoint(monitors, x, y) {
    return monitors.find(monitor => containsPoint(monitor, x, y)) ?? null;
}

export function centeredRect(monitor, width, height) {
    if (!monitor)
        return {x: 0, y: 0, width, height};

    const safeWidth = Math.min(Math.max(1, width), monitor.width);
    const safeHeight = Math.min(Math.max(1, height), monitor.height);

    return {
        x: monitor.x + Math.round((monitor.width - safeWidth) / 2),
        y: monitor.y + Math.round((monitor.height - safeHeight) / 2),
        width: safeWidth,
        height: safeHeight,
    };
}
