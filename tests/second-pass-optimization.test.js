import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function runModule(file, globals, symbol) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export class ', 'class ')
        .replace(/import\(('(?:[^']+)')\)/g, 'loadFeature($1)');
    return vm.runInNewContext(`${source}\n${symbol}`, globals);
}

test('feature modules are loaded only when used and cached per session', async () => {
    const loads = [];
    let recorders = 0;
    let demos = 0;
    const modules = {
        '../timer/break-timer-overlay.js': {BreakTimerOverlay: class {show() {} destroy() {}}},
        '../recording/native-recorder-service.js': {NativeRecorderService: class {
            constructor() {recorders++;}
            async toggle() {return true;}
            destroy() {}
        }},
        '../demo/demo-type-service.js': {DemoTypeService: class {
            constructor() {demos++;}
            stop() {}
            toggle() {}
            destroy() {}
        }},
    };
    const SessionManager = runModule('../src/core/session-manager.js', {
        GLib: {},
        CanvasMode: {DRAW: 'draw', STATIC_ZOOM: 'static-zoom', LIVE_DRAW: 'live-draw'},
        StatusOsd: class { show() {} hide() {} destroy() {} },
        loadFeature: async path => {loads.push(path); return modules[path];},
    }, 'SessionManager');
    const session = new SessionManager({
        settings: {get_int: () => 5, get_string: () => 'Break', get_boolean: () => true},
        monitorManager: {}, logger: console,
    });
    assert.equal(loads.length, 0);
    session.getPanelState();
    await session.toggleBreakTimer();
    assert.deepEqual(loads, ['../timer/break-timer-overlay.js']);
    assert.equal(recorders, 0);
    assert.equal(demos, 0);
    await session.recordFull();
    await session.recordFull();
    assert.equal(recorders, 1);
    assert.equal(loads.filter(s => s.includes('native-recorder')).length, 1);
    await session.toggleDemoType();
    await session.toggleDemoType();
    assert.equal(demos, 1);
    assert.equal(loads.length, 3);
    session.destroy();
});

test('a disabled session never constructs an imported feature', async () => {
    let finish;
    let constructions = 0;
    const SessionManager = runModule('../src/core/session-manager.js', {
        GLib: {},
        CanvasMode: {},
        StatusOsd: class {destroy() {}},
        loadFeature: () => new Promise(resolve => {finish = resolve;}),
    }, 'SessionManager');
    const session = new SessionManager({settings: {}, monitorManager: {}, logger: console});
    const pending = session._ensureRecorder();
    session.destroy();
    finish({NativeRecorderService: class {constructor() {constructions++;}}});
    assert.equal(await pending, null);
    assert.equal(constructions, 0);
});

test('first menu is built on open, not during GNOME login', () => {
    let onOpen;
    const PanelIndicator = runModule('../src/ui/panel-indicator.js', {
        Gio: {
            File: {new_for_path: p => p},
            FileIcon: class {},
            SettingsBindFlags: {DEFAULT: 0},
        },
        St: {Icon: class {constructor() {}}},
        PopupMenu: {PopupMenuItem: class {
            destroy() { this.destroyed = true; }
        }},
        PanelMenu: {Button: class {
            constructor() { this.menu = {
                connect: (_, callback) => {onOpen = callback; return 1;},
                addMenuItem(item) { this.item = item; },
            }; }
            add_child() {}
            set_style(value) { this.style = value; }
        }},
        Main: {panel: {addToStatusArea() {}, get_theme_node() {return {get_foreground_color() {return {red: 255, green: 255, blue: 255};}};}, connect() {return 4;}}},
    }, 'PanelIndicator');
    class TestIndicator extends PanelIndicator {
        _buildMenu() { this.builds = (this.builds ?? 0) + 1; }
    }
    const panel = new TestIndicator({name: 'Zumi', iconDir: '/tmp/icons',
        settings: {bind() {}}, actions: {}});
    assert.equal(panel.builds, undefined);
    onOpen(null, true);
    assert.equal(panel.builds, 1);
    onOpen(null, false);
    onOpen(null, true);
    assert.equal(panel.builds, 1);
});

test('short pointer moves do not cause redundant Cairo repaint', () => {
    class AnnotationStore {
        constructor() { this.items = []; }
        reset() {}
    }
    const AnnotationTool = {PEN: 'pen', HIGHLIGHTER: 'highlighter', BLUR: 'blur', TEXT: 'text'};
    const AnnotationController = runModule('../src/annotation/annotation-controller.js', {
        AnnotationStore,
        AnnotationTool,
        DEFAULT_ANNOTATION_TOOL: 'pen',
        isAnnotationTool: () => true,
    }, 'AnnotationController');
    let changes = 0;
    const controller = new AnnotationController({onChanged: () => changes++});
    controller.beginStroke(10, 10);
    assert.equal(changes, 1);
    controller.updateStroke(10, 10);
    controller.updateStroke(10.5, 10.5);
    assert.equal(changes, 1);
    controller.updateStroke(12, 10);
    assert.equal(changes, 2);
});
