import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function read(relative) {
    return fs.readFileSync(path.join(root, relative), 'utf8');
}

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

test('GNOME 50 source does not call removed Clutter raise_top()', () => {
    const files = [path.join(root, 'extension.js'), ...walk(path.join(root, 'src'))];
    for (const file of files)
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\.raise_top\s*\(/, file);
});

test('recorder does not import removed screenshot UIMode export', () => {
    const source = read('src/recording/native-recorder-service.js');
    assert.doesNotMatch(source, /import\s*\{\s*UIMode\s*\}.*screenshot\.js/);
});

test('all registered global bindings exist in the GSettings schema', () => {
    const extension = read('extension.js');
    const schema = read('schemas/org.gnome.shell.extensions.lumalens.gschema.xml');
    const actionBlock = extension.match(/const actions = \{([\s\S]*?)\n\s*\};/u)?.[1] ?? '';
    const actions = [...actionBlock.matchAll(/'([^']+)'\s*:/g)].map(match => match[1]);
    const keys = new Set([...schema.matchAll(/<key\s+name="([^"]+)"/g)].map(match => match[1]));
    assert.ok(actions.length >= 14);
    for (const action of actions)
        assert.ok(keys.has(action), `Missing schema key for ${action}`);
    assert.equal(keys.has('toggle-zoom'), false, 'obsolete toggle-zoom key should not be used');
});

test('metadata targets the tested GNOME 50 line', () => {
    const metadata = JSON.parse(read('metadata.json'));
    assert.deepEqual(metadata['shell-version'], ['50']);
    assert.equal(metadata.version, 32);
    assert.equal(metadata.name, 'Zumi');
    assert.equal(metadata.uuid, 'lumalens@luanthnh.dev');
});


test('Zumi packages a native top-bar indicator and minimal symbolic SVG icon', () => {
    const extension = read('extension.js');
    const indicator = read('src/ui/panel-indicator.js');
    const schema = read('schemas/org.gnome.shell.extensions.lumalens.gschema.xml');
    const icon = read('icons/zumi-symbolic.svg');

    assert.match(extension, /new PanelIndicator\s*\(/);
    assert.match(indicator, /new PanelMenu\.Button\s*\(/);
    assert.match(indicator, /Main\.panel\.addToStatusArea\s*\(/);
    assert.match(indicator, /show-panel-indicator/);
    assert.match(schema, /<key\s+name="show-panel-indicator"\s+type="b">/);
    assert.match(schema, /<default>true<\/default>/);
    assert.match(icon, /stroke="currentColor"/);
    assert.match(icon, /fill="none"/);
    assert.match(icon, /<path/);
    assert.doesNotMatch(extension, /iconPath:/);
    assert.match(indicator, /new St\.Icon/);
});

test('drawing and typing Arrow keys change size without requiring Ctrl', () => {
    const overlay = read('src/overlay/zoomit-canvas-overlay.js');

    assert.match(
        overlay,
        /if \(key === Clutter\.KEY_Up \|\| key === Clutter\.KEY_Down\) \{\s*this\._changeStrokeWidth/s
    );
    assert.match(
        overlay,
        /_typingKeyPress\(event\)[\s\S]*?if \(key === Clutter\.KEY_Up \|\| key === Clutter\.KEY_Down\) \{\s*this\._changeFontSize/s
    );
});

test('preferences describe the ZoomIt 12.11 shortcut layout', () => {
    const prefs = read('prefs.js');
    assert.match(prefs, /ZoomIt 12\.11 layout/);
});


test('clipboard keyboard shortcuts require explicit opt-in for EGO compliance', () => {
    const schema = read('schemas/org.gnome.shell.extensions.lumalens.gschema.xml');
    const metadata = JSON.parse(read('metadata.json'));
    const prefs = read('prefs.js');
    const overlay = read('src/overlay/zoomit-canvas-overlay.js');

    assert.match(metadata.description, /clipboard/i);
    assert.match(schema, /<key name="snip-copy" type="as"><default>\[\]<\/default>/);
    assert.match(schema, /<key name="snip-ocr" type="as"><default>\[\]<\/default>/);
    assert.match(schema, /<key name="clipboard-shortcuts-enabled" type="b"><default>false<\/default>/);
    assert.match(prefs, /Enable clipboard keyboard shortcuts/);
    assert.match(overlay, /_clipboardShortcutsEnabled\(\)/);
});

test('EGO packaging assets exist and store artwork is separate from runtime icon', () => {
    assert.ok(fs.existsSync(path.join(root, 'scripts/ego-preflight.mjs')));
    assert.ok(fs.existsSync(path.join(root, 'scripts/pack-ego.sh')));
    assert.ok(fs.existsSync(path.join(root, 'PUBLISHING.md')));
    assert.ok(fs.existsSync(path.join(root, 'LICENSE')));
    assert.ok(fs.existsSync(path.join(root, 'branding/zumi-store-icon.png')));
});


test('Phase 4.7 Draw text mode uses a real GNOME text editor instead of manual key reconstruction', () => {
    const overlay = read('src/overlay/zoomit-canvas-overlay.js');
    assert.match(overlay, /new St\.Entry\s*\(/);
    assert.match(overlay, /get_clutter_text\s*\(\)/);
    assert.match(overlay, /set_single_line_mode\s*\(false\)/);
    assert.match(overlay, /set_line_wrap\s*\(true\)/);
    assert.doesNotMatch(overlay, /keysym_to_unicode\s*\(/);
    assert.match(overlay, /return Clutter\.EVENT_PROPAGATE;[\s\S]*underlying Clutter\.Text|underlying Clutter\.Text[\s\S]*Clutter\.EVENT_PROPAGATE/);
});

test('Phase 4.7 uses lightweight monitor-aware Break Timer and Focus Spotlight', () => {
    const timer = read('src/timer/break-timer-overlay.js');
    const focus = read('src/presentation/focus-spotlight-overlay.js');
    const panel = read('src/ui/panel-indicator.js');
    const schema = read('schemas/org.gnome.shell.extensions.lumalens.gschema.xml');

    assert.match(timer, /new St\.DrawingArea\s*\(/);
    assert.match(timer, /lumalens-break-card/);
    assert.match(timer, /Until /);
    assert.match(timer, /monitorProvider/);
    assert.match(timer, /set_position\(x, y\)/);
    assert.match(timer, /RING_SIZE = 216/);
    assert.match(timer, /_paintRing\(area\)/);
    assert.match(timer, /Clutter\.KEY_space/);
    assert.match(focus, /Cairo\.Operator\.CLEAR/);
    assert.match(focus, /monitorProvider/);
    assert.match(focus, /stageX - this\._monitor\.x/);
    assert.match(panel, /Focus spotlight/);
    assert.match(schema, /<key name="focus-radius"/);
    assert.match(schema, /<key name="break-message"/);
});
