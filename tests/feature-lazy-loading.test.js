import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/core/session-manager.js', import.meta.url), 'utf8');

function makeSession(loadFeature, GLib = {}) {
    const compiled = source
        .replace(/^import .*;\n/gm, '')
        .replace('export class SessionManager', 'class SessionManager')
        .replace(/import\(('(?:[^']+)')\)/g, 'loadFeature($1)');
    const SessionManager = vm.runInNewContext(`${compiled}\nSessionManager`, {
        loadFeature,
        GLib,
        CanvasMode: {STATIC_ZOOM: 'static-zoom', DRAW: 'draw', LIVE_DRAW: 'live-draw'},
        StatusOsd: class {show() {} hide() {} destroy() {}},
    });
    return new SessionManager({settings: {}, monitorManager: {}, logger: console});
}

test('initial SessionManager imports are lightweight, features are dynamic', () => {
    const staticImports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]);
    assert.deepEqual(staticImports, [
        'gi://GLib', './canvas-mode.js', '../overlay/status-osd.js',
    ]);
    assert.match(source, /import\('\.\.\/recording\/native-recorder-service\.js'\)/);
    assert.match(source, /import\('\.\.\/overlay\/zoomit-canvas-overlay\.js'\)/);
    assert.match(source, /import\('\.\.\/capture\/ocr-service\.js'\)/);
});

test('canceled screenshot cannot construct canvas or reactivate after stop', async () => {
    let releaseCapture;
    let captured;
    let canvasLoads = 0;
    const capturedStarted = new Promise(resolve => { captured = resolve; });
    const session = makeSession(async path => {
        if (path.includes('screenshot-service')) {
            return {ScreenshotService: class {
                captureStage() {
                    captured();
                    return new Promise(resolve => { releaseCapture = resolve; });
                }
                destroy() {}
            }};
        }
        if (path.includes('zoomit-canvas')) {
            canvasLoads++;
            throw new Error('canvas should never load for a canceled capture');
        }
        throw new Error(`unexpected import: ${path}`);
    });
    const pending = session.toggleDraw();
    await capturedStarted;
    session._stopOverlay();
    releaseCapture({content: {}});
    await pending;
    assert.equal(canvasLoads, 0);
    assert.equal(session._overlay, null);
    session.destroy();
});

test('destroy cancels pending UI settle promises instead of hanging them', async () => {
    const removed = [];
    const session = makeSession(async () => ({}), {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        timeout_add: () => 123,
        Source: {remove: id => removed.push(id)},
    });
    const pending = session._afterUiSettles();
    session.destroy();
    assert.equal(await pending, false);
    assert.deepEqual(removed, [123]);
});

test('late selector import cannot open a canceled selector', async () => {
    let release;
    let constructions = 0;
    const session = makeSession(() => new Promise(resolve => {release = resolve;}));
    const pending = session._selectRegion(() => {});
    session._stopSelector();
    release({RegionSelectorOverlay: class {constructor() {constructions++;}}});
    await pending;
    assert.equal(constructions, 0);
    session.destroy();
});
