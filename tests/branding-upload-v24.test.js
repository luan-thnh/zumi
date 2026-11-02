import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Zumi branding keeps the installed extension identity and stored preferences', () => {
    const meta = JSON.parse(read('metadata.json'));
    assert.equal(meta.name, 'Zumi');
    assert.equal(meta.version, 32);
    assert.equal(meta.uuid, 'lumalens@luanthnh.dev');
    assert.equal(meta['settings-schema'], 'org.gnome.shell.extensions.lumalens');
    assert.match(read('src/ui/panel-indicator.js'), /new St\.Icon/);
    assert.match(read('prefs.js'), /title: 'Zumi'/);
    for (const asset of ['icons/zumi.svg', 'icons/zumi-symbolic.svg', 'branding/zumi-store-icon.png'])
        assert.ok(fs.existsSync(path.join(root, asset)), `${asset} is missing`);
    assert.match(read('icons/zumi.svg'), /id="beacon-blue"/);
});

test('EGO build requires public project URL and rejects placeholder URLs', () => {
    const run = (url) => spawnSync('node', ['scripts/ego-preflight.mjs', '--require-url'], {
        cwd: root,
        encoding: 'utf8',
        env: {...process.env, ZUMI_REPOSITORY_URL: url, LUMALENS_REPOSITORY_URL: ''},
    });
    const missing = run('');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /repository URL missing/);
    const fake = run('https://github.com/YOUR_ACCOUNT/zumi');
    assert.equal(fake.status, 1);
    assert.match(fake.stderr, /placeholder repository URL/);
});

test('GNOME package script includes source, schema, and symbolic icon at ZIP root', () => {
    const script = read('scripts/pack-ego.sh');
    for (const item of ['extension.js', 'metadata.json', 'prefs.js', 'stylesheet.css', 'src/', 'schemas/'])
        assert.ok(script.includes(item), `packager missing ${item}`);
    assert.match(script, /cp .*icons\/.*\*\.svg/);
    assert.match(script, /metadata\.url = process\.env\.REPO_URL/);
    assert.match(script, /delete metadata\.version/);
});
