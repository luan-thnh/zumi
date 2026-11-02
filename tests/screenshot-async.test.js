import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function screenshotHarness({failCapture = false, failClose = false} = {}) {
    const source = fs.readFileSync(new URL('../src/capture/screenshot-service.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export class ', 'class ')
        .replace('export function ', 'function ');
    let uuid = 0;
    const operations = [];
    const existing = new Set();
    class OutputStream {
        async close_async() {
            operations.push('close');
            if (failClose)
                throw new Error('disk full');
        }
    }
    class File {
        static new_for_path(path) {
            return {
                async create_async() {
                    operations.push('create');
                    if (existing.has(path)) throw new Error('already exists');
                    existing.add(path);
                    return new OutputStream();
                },
                async replace_async() {
                    operations.push('replace');
                    existing.add(path);
                    return new OutputStream();
                },
                async delete_async() {
                    operations.push('delete');
                    existing.delete(path);
                },
                async replace_contents_bytes_async() {
                    operations.push('write-bytes');
                },
            };
        }
    }
    class Screenshot {
        async screenshot(_cursor, _stream) {
            operations.push('capture');
            if (failCapture) throw new Error('capture failed');
        }
        async screenshot_area(_x, _y, _w, _h, _stream) {
            operations.push('capture-area');
            if (failCapture) throw new Error('capture failed');
        }
    }
    const ScreenshotService = vm.runInNewContext(`${source}\nScreenshotService`, {
        Gio: {
            _promisify() {}, File, OutputStream,
            FileCreateFlags: {NONE: 0, REPLACE_DESTINATION: 1},
            MemoryOutputStream: {new_resizable() {}},
        },
        GLib: {
            UserDirectory: {DIRECTORY_PICTURES: 1},
            get_user_special_dir: () => '/Pictures',
            get_home_dir: () => '/home/user',
            DateTime: {new_now_local: () => ({format: () => '2026-10-30_19-55-00'})},
            uuid_string_random: () => `unique-id-${++uuid}`,
            build_filenamev: parts => parts.join('/'),
            PRIORITY_DEFAULT: 0,
        },
        Shell: {Screenshot},
        St: {},
    });
    return {service: new ScreenshotService(), operations, existing};
}

test('default screenshots have distinct filenames and never use replace', async () => {
    const h = screenshotHarness();
    const first = await h.service.saveScreen();
    const second = await h.service.saveScreen();
    assert.notEqual(first, second);
    assert.equal(h.existing.size, 2);
    assert.deepEqual(h.operations, ['create', 'capture', 'close', 'create', 'capture', 'close']);
});

test('explicit OCR temp path uses async replace and closes the stream', async () => {
    const h = screenshotHarness();
    assert.equal(await h.service.saveArea({x: 1, y: 2, width: 3, height: 4}, '/tmp/ocr.png'), '/tmp/ocr.png');
    assert.deepEqual(h.operations, ['replace', 'capture-area', 'close']);
});

test('capture errors clean up new files and propagate without reporting success', async () => {
    const h = screenshotHarness({failCapture: true});
    await assert.rejects(h.service.saveScreen(), /capture failed/);
    assert.deepEqual(h.operations, ['create', 'capture', 'close', 'delete']);
    assert.equal(h.existing.size, 0);
});

test('errors closing a new file do not result in a success notification or leftover screenshot', async () => {
    const h = screenshotHarness({failClose: true});
    await assert.rejects(h.service.saveScreen(), /disk full/);
    assert.equal(h.existing.size, 0);
    assert.equal(h.operations.at(-1), 'delete');
});

test('saveBytes now writes with the asynchronous bytes API', async () => {
    const h = screenshotHarness();
    assert.equal(await h.service.saveBytes({}, '/tmp/bytes.png'), '/tmp/bytes.png');
    assert.deepEqual(h.operations, ['write-bytes']);
});

test('failure replacing an explicit temp path never deletes the caller-owned file', async () => {
    const h = screenshotHarness({failCapture: true});
    await assert.rejects(h.service.saveArea({x: 0, y: 0, width: 10, height: 10}, '/tmp/ocr.png'));
    assert.deepEqual(h.operations, ['replace', 'capture-area', 'close']);
    assert.equal(h.existing.has('/tmp/ocr.png'), true);
});
