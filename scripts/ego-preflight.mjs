#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireUrl = process.argv.includes('--require-url');
const errors = [];
const warnings = [];

function read(relative) {
    return fs.readFileSync(path.join(root, relative), 'utf8');
}

function fail(message) {
    errors.push(message);
}

function warn(message) {
    warnings.push(message);
}

function walk(dir) {
    if (!fs.existsSync(dir))
        return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            out.push(...walk(full));
        else
            out.push(full);
    }
    return out;
}

const metadata = JSON.parse(read('metadata.json'));
const schema = read('schemas/org.gnome.shell.extensions.lumalens.gschema.xml');
const description = String(metadata.description ?? '').toLowerCase();
const repositoryUrl = process.env.ZUMI_REPOSITORY_URL || process.env.LUMALENS_REPOSITORY_URL || metadata.url || '';

if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(metadata.uuid ?? ''))
    fail('metadata uuid must be extension-id@namespace using only supported characters');
if (String(metadata.uuid ?? '').endsWith('@gnome.org'))
    fail('metadata uuid must not use the gnome.org namespace');
if (JSON.stringify(metadata['shell-version']) !== JSON.stringify(['50']))
    fail('shell-version must contain only the tested stable GNOME 50 release');
if (metadata['settings-schema'] !== 'org.gnome.shell.extensions.lumalens')
    fail('metadata settings-schema is missing or incorrect');
if (!description.includes('clipboard'))
    fail('metadata description must declare clipboard access');
if (!fs.existsSync(path.join(root, 'LICENSE')))
    fail('LICENSE is missing');

if (!schema.includes('path="/org/gnome/shell/extensions/lumalens/"'))
    fail('GSettings schema path must be under /org/gnome/shell/extensions');
if (!/<key name="snip-copy" type="as"><default>\[\]<\/default>/.test(schema))
    fail('snip-copy must not ship with a default clipboard shortcut for EGO');
if (!/<key name="snip-ocr" type="as"><default>\[\]<\/default>/.test(schema))
    fail('snip-ocr must not ship with a default clipboard shortcut for EGO');
if (!/<key name="clipboard-shortcuts-enabled" type="b"><default>false<\/default>/.test(schema))
    fail('clipboard shortcut opt-in must default to false');

const shellFiles = [path.join(root, 'extension.js'), ...walk(path.join(root, 'src')).filter(f => f.endsWith('.js'))];
for (const file of shellFiles) {
    const source = fs.readFileSync(file, 'utf8');
    if (/gi:\/\/(Gtk|Gdk|Adw)/.test(source))
        fail(`${path.relative(root, file)} imports GTK/Adwaita in the Shell process`);
    if (/\.raise_top\s*\(/.test(source))
        fail(`${path.relative(root, file)} uses removed raise_top()`);
    if (/import\s*\{\s*UIMode\s*\}[^\n]*screenshot\.js/.test(source))
        fail(`${path.relative(root, file)} imports removed screenshot UIMode`);
}

const prefs = read('prefs.js');
if (/gi:\/\/(Clutter|Meta|St|Shell)/.test(prefs))
    fail('prefs.js imports Shell-only libraries');

for (const file of walk(path.join(root, 'schemas'))) {
    if (path.basename(file) === 'gschemas.compiled')
        fail('schemas/gschemas.compiled must not be shipped for GNOME 50');
}

if (requireUrl) {
    if (!repositoryUrl) {
        fail('repository URL missing: set ZUMI_REPOSITORY_URL to the public GitHub/GitLab repository');
    } else {
        try {
            const parsed = new URL(repositoryUrl);
            if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.pathname === '/')
                fail('repository URL must be an HTTPS link to your actual project');
            if (/YOUR_ACCOUNT|EXAMPLE_ACCOUNT|YOUR_REPO|EXAMPLE_REPO|example\.com/i.test(repositoryUrl))
                fail('replace placeholder repository URL with a real public project URL');
            if (!['github.com', 'gitlab.com'].includes(parsed.hostname))
                warn('reviewers normally expect metadata.url to point to a GitHub or GitLab repository with an issue tracker');
        } catch {
            fail('repository URL is not a valid URL');
        }
    }
}

if (metadata.version !== undefined)
    warn('metadata.version is kept for local development; pack-ego.sh removes it from the EGO upload package');

console.log('=== Zumi EGO preflight ===');
for (const message of warnings)
    console.log(`[WARN] ${message}`);
for (const message of errors)
    console.error(`[FAIL] ${message}`);

if (errors.length > 0)
    process.exit(1);

console.log('[OK] static EGO review checks passed');
if (requireUrl)
    console.log(`[OK] repository: ${repositoryUrl}`);
