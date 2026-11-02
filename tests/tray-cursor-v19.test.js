import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function importMocked(path, symbol, mocks) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export class ', 'class ')
        .replace(/import\((['"](?:[^'"]+)['"])\)/g, 'loadFeature($1)');
    return vm.runInNewContext(`${source}\n${symbol}`, mocks);
}

test('tray popup can open on first click, with compact menu and settings-backed shortcuts', () => {
    class Menu {
        constructor() { this.items = []; this.handlers = {}; }
        addMenuItem(item) { this.items.push(item); item._menu = this; }
        connect(signal, fn) { this.handlers[signal] = fn; return 1; }
        disconnect() {}
        open() { this.handlers['open-state-changed']?.(this, true); }
    }
    class Item {
        constructor(text) {
            this.text = text;
            this.label = {text, x_expand: false};
            this.handlers = {};
        }
        connect(signal, fn) { this.handlers[signal] = fn; }
        add_child() {}
        add_style_class_name() {}
        destroy() { this._menu.items.splice(this._menu.items.indexOf(this), 1); }
    }
    class Switch extends Item {
        constructor(text, state) { super(text); this.state = state; }
        setToggleState(state) {
            if (this.state === state) return;
            this.state = state;
            this.handlers.toggled?.(this, state);
        }
    }
    class SubMenu extends Item { constructor(text) { super(text); this.menu = new Menu(); } }
    class PanelButton {
        constructor() { this.menu = new Menu(); }
        set_style(value) { this.style = value; }
        add_child() {}
        destroy() {}
    }
    const settingsState = {enabled: false};
    let menuToggleCalls = 0;
    const settings = {
        bind() {},
        get_boolean: () => settingsState.enabled,
        get_strv: key => key === 'snip-copy' ? [] : key === 'cursor-highlight' ? ['<Control><Alt>h'] : ['<Control>1'],
    };
    const PanelIndicator = importMocked('../src/ui/panel-indicator.js', 'PanelIndicator', {
        Gio: {File: {new_for_path: p => p}, FileIcon: class {}, SettingsBindFlags: {DEFAULT: 0}, Settings: {unbind() {}}},
        St: {Icon: class {constructor() {}}, BoxLayout: class {add_child() {}}, Label: class {constructor(options) {this.text = options.text;}}},
        PopupMenu: {
            PopupMenuItem: Item,
            PopupBaseMenuItem: Item,
            PopupSeparatorMenuItem: class extends Item {},
            PopupImageMenuItem: Item,
            PopupSwitchMenuItem: Switch,
            PopupSubMenuMenuItem: SubMenu,
        },
        PanelMenu: {Button: PanelButton},
        Main: {panel: {addToStatusArea() {}, get_theme_node() {return {get_foreground_color() {return {red: 255, green: 255, blue: 255};}};}, connect() {return 1;}, disconnect() {}}},
    });
    const panel = new PanelIndicator({
        name: 'Zumi', iconDir: '/tmp/icons', settings,
        actions: {highlight() {menuToggleCalls++; settingsState.enabled = !settingsState.enabled;}},
    });
    assert.equal(panel.actor.style, '-natural-hpadding: 6px; -minimum-hpadding: 6px;');
    assert.equal(panel.actor.menu.items.length, 1);
    assert.match(panel.actor.menu.items[0].text, /Loading Zumi/);
    panel.actor.menu.open();
    const menu = panel.actor.menu;
    assert.equal(menu.items.filter(x => x.text === 'Keyboard shortcuts').length, 1);
    assert.equal(menu.items.filter(x => x.text === 'Loading Zumi…').length, 0);
    assert.equal(panel._shortcutLabels.get('snip-copy').text, 'Off');
    assert.equal(panel._shortcutLabels.get('cursor-highlight').text, 'Ctrl+Alt+h');
    const count = menu.items.length;
    menu.open();
    assert.equal(menu.items.length, count);
    // Settings changes must refresh the switch without toggling the setting back.
    settingsState.enabled = true;
    panel.refresh();
    assert.equal(panel._highlightItem.state, true);
    assert.equal(menuToggleCalls, 0);
    panel._highlightItem.setToggleState(false);
    assert.equal(menuToggleCalls, 1);
    panel.destroy();
});

test('cursor ring follows pointer via a coalesced signal, never captures mouse, cleans up', () => {
    let position = [240, 120];
    let handler;
    const disconnected = [];
    const callbacks = new Map();
    let nextId = 1;
    const tracker = {
        connect(_signal, fn) {handler = fn; return 7;},
        disconnect(id) { disconnected.push(id); },
    };
    const settings = {
        size: 52, color: '#ffcc33',
        connect(signal, fn) { const id = nextId++; callbacks.set(signal, {fn, id}); return id; },
        disconnect(id) { disconnected.push(id); },
        get_int() {return this.size;},
        get_string() {return this.color;},
    };
    const work = new Map();
    let nextSourceId = 100;
    const GLib = {
        PRIORITY_DEFAULT_IDLE: 1, SOURCE_REMOVE: false,
        idle_add(_priority, callback) {const id = nextSourceId++; work.set(id, callback); return id;},
        Source: {remove(id) { work.delete(id); }},
    };
    const actors = [];
    class Widget {
        constructor(options) {Object.assign(this, options); actors.push(this);}
        set_size(w, h) { this.size = [w, h]; }
        set_style(style) {this.style = style;}
        set_position(x, y) {this.position = [x, y];}
        destroy() {this.destroyed = true;}
    }
    const CursorHighlight = importMocked('../src/presentation/cursor-highlight.js', 'CursorHighlight', {
        St: {Widget}, GLib,
        Main: {uiGroup: {add_child() {}, set_child_above_sibling() {}}},
        global: {get_pointer: () => position, backend: {get_cursor_tracker: () => tracker}},
    });
    const ring = new CursorHighlight({settings});
    assert.equal(ring.actor.reactive, false);
    assert.equal(ring.actor.can_focus, false);
    assert.deepEqual(ring.actor.size, [52, 52]);
    assert.deepEqual(ring.actor.position, [214, 94]);
    position = [345, 165];
    for (let i = 0; i < 30; i++) handler();
    assert.equal(work.size, 1, '30 position signals should schedule only one actor update');
    [...work.values()][0]();
    work.clear();
    assert.deepEqual(ring.actor.position, [319, 139]);
    settings.size = 78;
    settings.color = '#6dd6ff';
    callbacks.get('changed::cursor-highlight-size').fn();
    callbacks.get('changed::cursor-highlight-color').fn();
    assert.deepEqual(ring.actor.size, [78, 78]);
    assert.match(ring.actor.style, /#6dd6ff/);
    settings.color = 'invalid-color); background: red';
    callbacks.get('changed::cursor-highlight-color').fn();
    assert.match(ring.actor.style, /#ffcc33/);
    handler();
    assert.equal(work.size, 1);
    const actor = ring.actor;
    ring.destroy();
    assert.equal(work.size, 0);
    assert.equal(actor.destroyed, true);
    assert.equal(disconnected.length, 3);
});

test('disabling cursor before import resolves cannot resurrect ring after disable', async () => {
    let resolveImport;
    let created = 0;
    const module = {CursorHighlight: class { constructor() {created++;} destroy() {} }};
    const SessionManager = importMocked('../src/core/session-manager.js', 'SessionManager', {
        GLib: {}, CanvasMode: {}, StatusOsd: class {destroy() {}},
        loadFeature: () => new Promise(resolve => {resolveImport = resolve;}),
    });
    let enabled = true;
    const session = new SessionManager({
        settings: {get_boolean: () => enabled}, monitorManager: {}, logger: console,
    });
    const pending = session.setCursorHighlight(true);
    enabled = false;
    await session.setCursorHighlight(false);
    resolveImport(module);
    await pending;
    assert.equal(created, 0);
    session.destroy();
});
