import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {parseOcrTsv, stageOcrRects} from '../src/capture/ocr-result.js';

const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '1\t1\t0\t0\t0\t0\t0\t0\t400\t200\t-1\t',
    '5\t1\t1\t1\t1\t1\t40\t20\t90\t20\t91.5\tTiếng',
    '5\t1\t1\t1\t1\t2\t140\t20\t75\t20\t95.0\tViệt',
    '5\t1\t1\t1\t2\t1\t40\t55\t150\t25\t89.2\txin chào',
    '5\t1\t1\t1\t2\t2\t200\t55\t80\t25\t-1\tnoise',
].join('\n');

test('Vietnamese diacritics and line breaks are preserved from TSV', () => {
    const result = parseOcrTsv(tsv);
    assert.equal(result.text, 'Tiếng Việt\nxin chào');
    assert.equal(result.words.length, 3);
    assert.equal(result.imageWidth, 400);
    assert.equal(result.imageHeight, 200);
});

test('OCR bounding boxes scale from screenshot pixels to HiDPI stage coordinates', () => {
    const words = stageOcrRects(parseOcrTsv(tsv), {x: 200, y: 100, width: 200, height: 100});
    assert.deepEqual(words[0], {x: 220, y: 110, width: 45, height: 10});
    assert.deepEqual(words[1], {x: 270, y: 110, width: 37.5, height: 10});
});

test('malformed or empty Tesseract TSV fails safely', () => {
    assert.deepEqual(parseOcrTsv(''), {text: '', words: [], imageWidth: 0, imageHeight: 0});
    assert.deepEqual(stageOcrRects({words: [{x: 1, y: 2, width: 3, height: 4}], imageWidth: 0, imageHeight: 4}, {x: 0, y: 0, width: 5, height: 5}), []);
    assert.equal(parseOcrTsv(tsv + '\n5\t1\t1\t1\t3\t1\tx\t2\t3\t4\t99\tBAD').words.length, 3);
});

test('OCR subprocess chooses Vietnamese and English and does not copy prematurely', () => {
    const source = fs.readFileSync(new URL('../src/capture/ocr-service.js', import.meta.url), 'utf8');
    assert.match(source, /'vie\+eng'/);
    assert.match(source, /'--psm', '11', 'tsv'/);
    assert.doesNotMatch(source, /set_text\(/);
    assert.match(source, /force_exit\(/);
    assert.match(source, /onCaptured\?\.\(\)/);
});

test('OCR overlay stays open with copy button and cancels with manager destroy', () => {
    const source = fs.readFileSync(new URL('../src/core/session-manager.js', import.meta.url), 'utf8');
    const overlay = fs.readFileSync(new URL('../src/capture/ocr-result-overlay.js', import.meta.url), 'utf8');
    assert.match(source, /_ocrService\?\.cancel\(\)/);
    assert.match(source, /this\._stopOcr\(\);\s*this\._stopSelector\(\);/);
    assert.match(overlay, /showResult\(result\)/);
    assert.match(overlay, /set_text\(St\.ClipboardType\.CLIPBOARD/);
    assert.match(overlay, /Copy All/);
    assert.match(overlay, /queue_repaint\(\)/);
});

function makeOcrService({languages = 'eng\nvie\n', pendingOcr = false} = {}) {
    const source = fs.readFileSync(new URL('../src/capture/ocr-service.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export class OcrService', 'class OcrService');
    const actions = [];
    let finishOcr;
    class Cancellable {
        constructor() { this.canceled = false; }
        cancel() { this.canceled = true; }
        is_cancelled() { return this.canceled; }
    }
    const Gio = {
        _promisify() {},
        File: class {
            static new_for_path(path) { return {delete_async: async () => { actions.push(`delete:${path}`); }}; }
        },
        Cancellable,
        SubprocessFlags: {STDOUT_PIPE: 1, STDERR_PIPE: 2},
        Subprocess: {new(argv) {
            const listing = argv.includes('--list-langs');
            actions.push(listing ? 'list-langs' : 'ocr-start');
            const proc = {
                communicate_utf8_async(_stdin, cancellable, callback) {
                    if (pendingOcr && !listing) {
                        finishOcr = () => callback(proc, {});
                    } else queueMicrotask(() => callback(proc, {}));
                },
                communicate_utf8_finish() {
                    if (this.canceled) throw new Error('cancelled');
                    return [true, listing ? languages : tsv, ''];
                },
                get_successful() { return true; },
                force_exit() { this.canceled = true; actions.push('force-exit'); },
            };
            return proc;
        }},
    };
    const GLib = {find_program_in_path: () => '/usr/bin/tesseract', PRIORITY_DEFAULT: 0};
    const OcrService = vm.runInNewContext(`${source}\nOcrService`, {Gio, GLib, parseOcrTsv});
    return {
        service: new OcrService({screenshotService: {
            nextTempPath: () => '/tmp/test-zumi-ocr.png',
            saveArea: async () => { actions.push('capture'); },
        }}),
        actions,
        finish: () => finishOcr?.(),
    };
}

test('OCR checks Vietnamese language, captures before showing highlight, and cleans temp', async () => {
    const {service, actions} = makeOcrService();
    const result = await service.recognizeArea({x: 0, y: 0, width: 200, height: 100}, {
        onCaptured: () => actions.push('show-loading'),
    });
    assert.equal(result.text, 'Tiếng Việt\nxin chào');
    assert.deepEqual(actions, ['list-langs', 'capture', 'show-loading', 'ocr-start',
        'delete:/tmp/test-zumi-ocr.png']);
});

test('OCR refuses missing Vietnamese model instead of silently using English', async () => {
    const {service, actions} = makeOcrService({languages: 'eng\n'});
    await assert.rejects(() => service.recognizeArea({}), /tesseract-ocr-vie/);
    assert.deepEqual(actions, ['list-langs']);
});

test('OCR close kills background recognizer and cleans temporary screenshot', async () => {
    const {service, actions, finish} = makeOcrService({pendingOcr: true});
    let ready;
    const loaded = new Promise(resolve => { ready = resolve; });
    const pending = service.recognizeArea({}, {onCaptured: ready});
    await loaded;
    // allow communicate_utf8_async to register its callback
    await new Promise(resolve => setImmediate(resolve));
    service.cancel();
    finish();
    await assert.rejects(pending, /cancelled/);
    assert.ok(actions.includes('force-exit'));
    assert.ok(actions.some(action => action.startsWith('delete:')));
});
