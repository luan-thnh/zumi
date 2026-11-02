import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const get = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Beacon app icon and GNOME tray symbol share one distinctive mark', () => {
    const app = get('icons/zumi.svg');
    const tray = get('icons/zumi-symbolic.svg');
    assert.match(app, /viewBox="0 0 256 256"/);
    assert.match(app, /id="beacon-blue"/);
    assert.match(app, /stroke="#F8FBFF"/);
    assert.match(app, /<rect x="111" y="111" width="34"/);
    assert.doesNotMatch(app, /<circle cx="108" cy="116"/, 'the old lens symbol must not remain');
    assert.match(tray, /viewBox="0 0 24 24"/);
    assert.match(tray, /stroke="currentColor"/);
    assert.match(tray, /fill="currentColor"/);
    assert.match(tray, /M12 4\.3 A7\.7/);
    assert.doesNotMatch(tray, /stroke="#FFFFFF"/, 'symbolic icon must inherit the shell theme');
    assert.equal(JSON.parse(get('metadata.json')).version, 32);
});

test('store PNG is valid 512px artwork generated from Beacon', () => {
    const store = fs.readFileSync(path.join(root, 'branding/zumi-store-icon.png'));
    assert.equal(store.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(store.readUInt32BE(16), 512);
    assert.equal(store.readUInt32BE(20), 512);
});
