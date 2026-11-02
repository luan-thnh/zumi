import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Run the extension's real dispatch code with mocked GNOME objects; Node cannot load gi://.
function makeHarness(loadSession) {
    const source = fs.readFileSync(new URL('../extension.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export default class ZumiExtension', 'class ZumiExtension')
        .replace("import('./src/core/session-manager.js')", 'loadSession()');

    class Extension {
        getSettings() { return {
            get_boolean: () => false,
            connect: () => 1,
            disconnect: () => {},
        }; }
        getLogger() { return {error: () => {}}; }
    }
    class ShortcutManager {
        constructor() { this.handlers = new Map(); }
        add(name, callback) { this.handlers.set(name, callback); }
        destroy() { this.handlers.clear(); }
    }
    class PanelIndicator {
        constructor(options) { this.actions = options.actions; }
        destroy() {}
    }
    class MonitorManager { destroy() {} }

    const ExtensionClass = vm.runInNewContext(`${source}\nZumiExtension`, {
        Extension, MonitorManager, ShortcutManager, PanelIndicator, loadSession,
    });
    const extension = new ExtensionClass();
    extension.path = '/tmp/lumalens';
    extension.uuid = 'lumalens@test';
    extension.metadata = {name: 'Zumi'};
    extension.enable();
    return extension;
}

test('login registers shortcuts without loading the drawing/recording modules', async () => {
    const calls = [];
    let loads = 0;
    class SessionManager {
        toggleDraw() { calls.push('draw'); }
        toggleStaticZoom() { calls.push('zoom'); }
        destroy() {}
    }
    const extension = makeHarness(async () => {
        loads++;
        return {SessionManager};
    });
    assert.equal(loads, 0);
    assert.equal(extension._sessionManager, null);
    assert.equal(extension._shortcuts.handlers.size, 15);

    await Promise.all([
        extension._shortcuts.handlers.get('draw-mode')(),
        extension._shortcuts.handlers.get('zoom-mode')(),
    ]);
    assert.equal(loads, 1);
    assert.deepEqual(calls, ['draw', 'zoom']);
    extension.disable();
});

test('a delayed first import must not initialize a disabled extension', async () => {
    let release;
    let constructions = 0;
    class SessionManager {
        constructor() { constructions++; }
        toggleDraw() { throw new Error('should not be invoked'); }
    }
    const extension = makeHarness(() => new Promise(resolve => {
        release = () => resolve({SessionManager});
    }));
    const pending = extension._shortcuts.handlers.get('draw-mode')();
    await Promise.resolve(); // let dispatch start the import
    extension.disable();
    release();
    await pending;
    assert.equal(constructions, 0);
});

test('rapid shortcuts serialize and an old load cannot cross disable/enable', async () => {
    const calls = [];
    let release;
    class SessionManager {
        toggleDraw() { calls.push('draw'); }
        destroy() {}
    }
    let count = 0;
    const extension = makeHarness(() => {
        count++;
        if (count === 1)
            return new Promise(resolve => { release = () => resolve({SessionManager}); });
        return Promise.resolve({SessionManager});
    });
    const pending = extension._shortcuts.handlers.get('draw-mode')();
    await Promise.resolve();
    extension.disable();
    extension.enable();
    release();
    await pending;
    assert.deepEqual(calls, []);

    await extension._shortcuts.handlers.get('draw-mode')();
    assert.equal(count, 2);
    assert.deepEqual(calls, ['draw']);
    extension.disable();
});

test('DemoType never builds a new character array inside its per-character timer', () => {
    const source = fs.readFileSync(new URL('../src/demo/demo-type-service.js', import.meta.url), 'utf8');
    assert.match(source, /this\._text = Array\.from\(/);
    assert.doesNotMatch(source, /GLib\.timeout_add\([\s\S]*?const chars = Array\.from\(/);
    assert.match(source, /_engage\(\)[\s\S]*?create_virtual_device\(/);
});
