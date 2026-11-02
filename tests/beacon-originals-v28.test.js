import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Beacon app and tray icons are distinct from prior branding', () => {
    const app = read('icons/zumi.svg');
    const tray = read('icons/zumi-symbolic.svg');
    assert.match(app, /beacon-blue/);
    assert.notEqual(app, tray);
    assert.match(app, /rotate\(45 128 128\)/);
    assert.match(tray, /stroke="currentColor"/);
    assert.match(tray, /fill="currentColor"/);
    assert.doesNotMatch(tray, /#[0-9A-Fa-f]{6}/, 'tray color must be supplied by GNOME');
});

test('symbolic icon contains no filters, gradients or effects that blur at 16 pixels', () => {
    const tray = read('icons/zumi-symbolic.svg');
    assert.doesNotMatch(tray, /<(filter|linearGradient|radialGradient|image)\b/);
    assert.match(tray, /viewBox="0 0 24 24"/);
});
