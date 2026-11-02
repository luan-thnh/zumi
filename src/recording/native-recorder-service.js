// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const RecordingMode = Object.freeze({
    FULL: 'full',
    REGION: 'region',
    WINDOW: 'window',
    PANORAMA: 'panorama',
});

const BUS_NAME = 'org.gnome.Shell.Screencast';
const OBJECT_PATH = '/org/gnome/Shell/Screencast';
const INTERFACE = 'org.gnome.Shell.Screencast';
const FILE_TEMPLATE = 'Zumi-%d-%t.webm';

const ScreencastProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.gnome.Shell.Screencast">
    <method name="Screencast">
      <arg type="s" direction="in" name="file_template"/>
      <arg type="a{sv}" direction="in" name="options"/>
      <arg type="b" direction="out" name="success"/>
      <arg type="s" direction="out" name="filename_used"/>
    </method>
    <method name="ScreencastArea">
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="i" direction="in" name="width"/>
      <arg type="i" direction="in" name="height"/>
      <arg type="s" direction="in" name="file_template"/>
      <arg type="a{sv}" direction="in" name="options"/>
      <arg type="b" direction="out" name="success"/>
      <arg type="s" direction="out" name="filename_used"/>
    </method>
    <method name="StopScreencast">
      <arg type="b" direction="out" name="success"/>
    </method>
  </interface>
</node>`);

export class NativeRecorderService {
    constructor({notify = null, logger = console} = {}) {
        this._notify = notify;
        this._logger = logger;
        this._active = false;
        this._mode = null;
        this._filename = '';
        this._proxy = null;
        this._proxyPromise = null;
        this._startPromise = null;
        this._stopPromise = null;
        this._destroyed = false;
    }

    get active() {
        return this._active;
    }

    get mode() {
        return this._mode;
    }

    async toggle(mode = RecordingMode.FULL, rect = null) {
        if (this._active || this._startPromise)
            return this.stop();
        return this.start(mode, rect);
    }

    async start(mode = RecordingMode.FULL, rect = null) {
        if (this._destroyed)
            return false;
        if (this._startPromise)
            return this._startPromise;
        if (this._stopPromise)
            await this._stopPromise;
        if (this._destroyed)
            return false;
        if (this._active)
            return true;

        const pending = this._start(mode, rect);
        this._startPromise = pending;
        try {
            return await pending;
        } finally {
            if (this._startPromise === pending)
                this._startPromise = null;
        }
    }

    async _start(mode, rect) {
        try {
            const proxy = await this._ensureProxy();
            if (this._destroyed)
                return false;

            const result = rect
                ? await this._startArea(proxy, rect)
                : await this._startFull(proxy);
            if (!result.success)
                throw new Error('GNOME Shell refused to start screencast.');

            this._active = true;
            this._mode = mode;
            this._filename = result.filename;
            // A D-Bus start request can succeed after destroy(); stop() is
            // waiting for this Promise and will then release the recorder.
            if (this._destroyed)
                return true;

            const label = mode === RecordingMode.PANORAMA
                ? 'Panorama recording · pan the desktop'
                : mode === RecordingMode.WINDOW
                    ? 'Window recording started'
                    : mode === RecordingMode.REGION
                        ? 'Region recording started'
                        : 'Recording started';
            this._notify?.(label, 1500);
            return true;
        } catch (error) {
            if (this._destroyed)
                return false;
            this._logger?.warn?.(`Direct GNOME recording unavailable: ${error.message}`);
            return this._openFallback(mode);
        }
    }

    async stop() {
        if (this._stopPromise)
            return this._stopPromise;

        const pending = this._stop();
        this._stopPromise = pending;
        try {
            return await pending;
        } finally {
            if (this._stopPromise === pending)
                this._stopPromise = null;
        }
    }

    async _stop() {
        if (this._startPromise)
            await this._startPromise;
        if (!this._active)
            return false;

        try {
            const [success] = await remoteCall(this._proxy, 'StopScreencastRemote', []);
            if (!success)
                throw new Error('GNOME Shell did not stop the screencast.');
            if (!this._destroyed)
                this._notify?.(this._filename ? `Recording saved · ${basename(this._filename)}` : 'Recording stopped', 1800);
            this._resetState();
            return true;
        } catch (error) {
            this._logger?.error?.(`Unable to stop GNOME recorder: ${error.message}`);
            if (!this._destroyed)
                this._notify?.('Could not stop recording');
            // Keep the active state so the user can retry stopping a live recorder.
            return false;
        }
    }

    async _ensureProxy() {
        if (this._proxy)
            return this._proxy;
        if (!this._proxyPromise) {
            this._proxyPromise = new Promise((resolve, reject) => {
                try {
                    new ScreencastProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH,
                        (proxy, error) => error ? reject(error) : resolve(proxy));
                } catch (error) {
                    reject(error);
                }
            }).then(proxy => {
                if (!proxy)
                    throw new Error('GNOME screencast D-Bus proxy is unavailable.');
                if (!this._destroyed)
                    this._proxy = proxy;
                return proxy;
            }).catch(error => {
                this._proxyPromise = null;
                throw error;
            });
        }
        return this._proxyPromise;
    }

    async _startFull(proxy) {
        const [success, filename = ''] = await remoteCall(
            proxy, 'ScreencastRemote', [FILE_TEMPLATE, {}]);
        return {success: Boolean(success), filename};
    }

    async _startArea(proxy, rect) {
        const normalized = normalizeRect(rect);
        const [success, filename = ''] = await remoteCall(
            proxy,
            'ScreencastAreaRemote',
            [normalized.x, normalized.y, normalized.width, normalized.height, FILE_TEMPLATE, {}]
        );
        return {success: Boolean(success), filename};
    }

    _openFallback(mode) {
        try {
            if (!Main.screenshotUI || typeof Main.screenshotUI.open !== 'function')
                throw new Error('GNOME screenshot/screencast UI is unavailable.');

            // GNOME 50.1 does not export screenshot.js/UIMode.
            Main.screenshotUI.open();
            const hint = {
                [RecordingMode.FULL]: 'Capture UI opened · switch to Record if needed',
                [RecordingMode.REGION]: 'Capture UI opened · choose Area + Record',
                [RecordingMode.WINDOW]: 'Capture UI opened · choose Window + Record',
                [RecordingMode.PANORAMA]: 'Capture UI opened · choose Screen + Record',
            }[mode] ?? 'Recorder';
            this._notify?.(hint, 1800);
            return true;
        } catch (error) {
            this._logger?.error?.(`Unable to open GNOME recorder: ${error.message}`);
            this._notify?.('Recorder unavailable');
            return false;
        }
    }

    _resetState() {
        this._active = false;
        this._mode = null;
        this._filename = '';
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        // Do not cancel an in-flight D-Bus Start: GNOME may already have
        // started recording. Wait for its result and then explicitly stop it.
        this.stop().catch(error => {
            this._logger?.error?.(`Recorder teardown failed: ${error.message}`);
        }).finally(() => {
            this._proxy = null;
            this._proxyPromise = null;
            this._notify = null;
            this._logger = null;
        });
    }
}

function remoteCall(proxy, method, args) {
    return new Promise((resolve, reject) => {
        if (!proxy || typeof proxy[method] !== 'function') {
            reject(new Error(`Missing D-Bus method ${method}.`));
            return;
        }
        proxy[method](...args, (result, error) => {
            if (error)
                reject(error);
            else
                resolve(Array.isArray(result) ? result : [result]);
        });
    });
}

function normalizeRect(rect) {
    return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
    };
}

function basename(path) {
    return String(path).split('/').pop() ?? String(path);
}
