// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot_stage_to_content');
Gio._promisify(Shell.Screenshot.prototype, 'screenshot_area');
Gio._promisify(Shell.Screenshot.prototype, 'screenshot');
Gio._promisify(Gio.File.prototype, 'create_async');
Gio._promisify(Gio.File.prototype, 'replace_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.OutputStream.prototype, 'close_async');

export class ScreenshotService {
    async captureStage() {
        const shooter = new Shell.Screenshot();
        const result = await shooter.screenshot_stage_to_content();
        const values = Array.isArray(result) ? result : [result];
        const [content, scale = 1, cursorContent = null, cursorPoint = null, cursorScale = 1] = values;

        if (!content)
            throw new Error('GNOME Shell returned no screenshot content.');

        return {
            content,
            scale,
            cursorContent,
            cursorPoint,
            cursorScale,
        };
    }

    async copyArea(rect) {
        const bytes = await this.captureAreaBytes(rect);
        St.Clipboard.get_default().set_content(
            St.ClipboardType.CLIPBOARD,
            'image/png',
            bytes
        );
        return true;
    }

    async copyScreen() {
        const bytes = await this.captureScreenBytes();
        St.Clipboard.get_default().set_content(
            St.ClipboardType.CLIPBOARD,
            'image/png',
            bytes
        );
        return true;
    }

    async captureAreaBytes(rect) {
        const normalized = normalizeRect(rect);
        const stream = Gio.MemoryOutputStream.new_resizable();
        const shooter = new Shell.Screenshot();
        await shooter.screenshot_area(
            normalized.x,
            normalized.y,
            normalized.width,
            normalized.height,
            stream
        );
        stream.close(null);
        return stream.steal_as_bytes();
    }

    async captureScreenBytes() {
        const stream = Gio.MemoryOutputStream.new_resizable();
        const shooter = new Shell.Screenshot();
        await shooter.screenshot(false, stream);
        stream.close(null);
        return stream.steal_as_bytes();
    }

    async saveArea(rect, path = null) {
        const normalized = normalizeRect(rect);
        const finalPath = path ?? this.nextScreenshotPath('Zumi-Snip');
        return this._saveScreenshot(finalPath, path !== null, stream => {
            const shooter = new Shell.Screenshot();
            return shooter.screenshot_area(
                normalized.x, normalized.y, normalized.width, normalized.height, stream);
        });
    }

    async saveScreen(path = null) {
        const finalPath = path ?? this.nextScreenshotPath('Zumi');
        return this._saveScreenshot(finalPath, path !== null, stream => {
            const shooter = new Shell.Screenshot();
            return shooter.screenshot(false, stream);
        });
    }

    async saveBytes(bytes, path) {
        const file = Gio.File.new_for_path(path);
        await file.replace_contents_bytes_async(
            bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        return path;
    }

    nextScreenshotPath(prefix = 'Zumi') {
        const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES)
            ?? GLib.get_home_dir();
        const stamp = GLib.DateTime.new_now_local().format('%Y-%m-%d_%H-%M-%S');
        // Distinct within the same second; create_async also refuses to overwrite.
        return GLib.build_filenamev([pictures, `${prefix}-${stamp}-${GLib.uuid_string_random()}.png`]);
    }

    nextTempPath(prefix = 'lumalens') {
        const stamp = `${GLib.get_monotonic_time()}`;
        return GLib.build_filenamev([GLib.get_tmp_dir(), `${prefix}-${stamp}.png`]);
    }

    async _saveScreenshot(path, replace, capture) {
        const file = Gio.File.new_for_path(path);
        const stream = replace
            ? await file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION,
                GLib.PRIORITY_DEFAULT, null)
            : await file.create_async(Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null);

        try {
            await capture(stream);
            await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            return path;
        } catch (error) {
            try {
                await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            } catch (_closeError) {
                // Preserve the screenshot error.
            }
            if (!replace) {
                try {
                    await file.delete_async(GLib.PRIORITY_DEFAULT, null);
                } catch (_deleteError) {
                    // A failed screenshot must never mask its original error.
                }
            }
            throw error;
        }
    }

    destroy() {
    }
}

export function normalizeRect(rect) {
    const x1 = Math.round(Math.min(rect.x1 ?? rect.x, rect.x2 ?? (rect.x + rect.width)));
    const y1 = Math.round(Math.min(rect.y1 ?? rect.y, rect.y2 ?? (rect.y + rect.height)));
    const x2 = Math.round(Math.max(rect.x1 ?? rect.x, rect.x2 ?? (rect.x + rect.width)));
    const y2 = Math.round(Math.max(rect.y1 ?? rect.y, rect.y2 ?? (rect.y + rect.height)));
    return {
        x: Math.max(0, x1),
        y: Math.max(0, y1),
        width: Math.max(1, x2 - x1),
        height: Math.max(1, y2 - y1),
    };
}
