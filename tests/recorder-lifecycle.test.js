import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function recorderHarness({deferProxy = false, deferStart = false, failStop = false} = {}) {
    const source = fs.readFileSync(new URL('../src/recording/native-recorder-service.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export const ', 'const ')
        .replaceAll('export class ', 'class ');
    let proxyReady;
    let startReply;
    let proxyCreations = 0;
    let startCalls = 0;
    let stopCalls = 0;
    let fallbackCalls = 0;
    const notifications = [];
    class Proxy {
        constructor(_bus, _name, _path, callback) {
            proxyCreations++;
            this.ScreencastRemote = (...args) => {
                startCalls++;
                const reply = args.at(-1);
                if (deferStart) startReply = reply;
                else queueMicrotask(() => reply([true, '/tmp/recording.webm'], null));
            };
            this.StopScreencastRemote = reply => {
                stopCalls++;
                queueMicrotask(() => reply([!failStop], null));
            };
            if (deferProxy) proxyReady = () => callback(this, null);
            else queueMicrotask(() => callback(this, null));
        }
    }
    const NativeRecorderService = vm.runInNewContext(`${source}\nNativeRecorderService`, {
        Gio: {DBus: {session: {}}, DBusProxy: {makeProxyWrapper: () => Proxy}},
        Main: {screenshotUI: {open: () => { fallbackCalls++; }}},
    });
    const service = new NativeRecorderService({
        notify: message => notifications.push(message),
        logger: {warn() {}, error() {}},
    });
    return {
        service, notifications,
        get proxyCreations() { return proxyCreations; },
        get startCalls() { return startCalls; },
        get stopCalls() { return stopCalls; },
        get fallbackCalls() { return fallbackCalls; },
        resolveProxy() { proxyReady(); },
        resolveStart() { startReply([true, '/tmp/recording.webm'], null); },
    };
}

async function flush() {
    await new Promise(resolve => setImmediate(resolve));
}

test('recorder proxy is lazy and created asynchronously on the first request', async () => {
    const h = recorderHarness();
    assert.equal(h.proxyCreations, 0);
    assert.equal(await h.service.start(), true);
    assert.equal(h.proxyCreations, 1);
    assert.equal(h.startCalls, 1);
    assert.equal(h.service.active, true);
    assert.equal(await h.service.stop(), true);
    assert.equal(h.stopCalls, 1);
    assert.equal(h.service.active, false);
    h.service.destroy();
});

test('destroy during a delayed recording start explicitly stops the late recording', async () => {
    const h = recorderHarness({deferStart: true});
    const pending = h.service.start();
    await flush();
    assert.equal(h.startCalls, 1);
    h.service.destroy();
    h.resolveStart();
    assert.equal(await pending, true);
    await flush();
    assert.equal(h.stopCalls, 1);
    assert.equal(h.service.active, false);
    assert.equal(h.notifications.length, 0, 'No notification after teardown');
    assert.equal(h.fallbackCalls, 0, 'Never reopen capture UI after teardown');
});

test('destroy before proxy initialization does not send a start request', async () => {
    const h = recorderHarness({deferProxy: true});
    const pending = h.service.start();
    assert.equal(h.startCalls, 0);
    h.service.destroy();
    h.resolveProxy();
    assert.equal(await pending, false);
    await flush();
    assert.equal(h.startCalls, 0);
    assert.equal(h.fallbackCalls, 0);
});

test('toggle during an in-flight start waits and then stops instead of starting again', async () => {
    const h = recorderHarness({deferStart: true});
    const pending = h.service.toggle();
    await flush();
    const stopping = h.service.toggle();
    h.resolveStart();
    assert.equal(await pending, true);
    assert.equal(await stopping, true);
    assert.equal(h.startCalls, 1);
    assert.equal(h.stopCalls, 1);
    assert.equal(h.service.active, false);
});

test('a failed stop preserves the active flag so the user can retry', async () => {
    const h = recorderHarness({failStop: true});
    await h.service.start();
    assert.equal(await h.service.stop(), false);
    assert.equal(h.service.active, true);
    // Do not destroy this mock, because a real recorder would still be active.
});

test('concurrent recording starts share one D-Bus call', async () => {
    const h = recorderHarness({deferStart: true});
    const first = h.service.start();
    const second = h.service.start();
    await flush();
    assert.equal(h.startCalls, 1);
    h.resolveStart();
    assert.equal(await first, true);
    assert.equal(await second, true);
    await h.service.stop();
});
