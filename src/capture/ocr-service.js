// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseOcrTsv} from './ocr-result.js';

Gio._promisify(Gio.File.prototype, 'delete_async');

export class OcrService {
    constructor({screenshotService, logger = console}) {
        this._screenshotService = screenshotService;
        this._logger = logger;
        this._running = new Set();
        this._languagesReady = null;
    }

    get available() {
        return Boolean(GLib.find_program_in_path('tesseract'));
    }

    async ensureLanguages() {
        if (!this.available)
            throw new Error('Install tesseract-ocr.');
        if (!this._languagesReady) {
            this._languagesReady = (async () => {
                const proc = Gio.Subprocess.new([GLib.find_program_in_path('tesseract'), '--list-langs'],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                const [, stdout, stderr] = await communicateUtf8(proc, null);
                if (!proc.get_successful()) throw new Error(stderr || 'Cannot list OCR languages.');
                const installed = new Set(String(stdout).split(/\r?\n/).map(lang => lang.trim()));
                if (!installed.has('vie') || !installed.has('eng'))
                    throw new Error('Install tesseract-ocr-vie and tesseract-ocr-eng.');
            })().catch(error => {
                this._languagesReady = null;
                throw error;
            });
        }
        return this._languagesReady;
    }

    async recognizeArea(rect, {onCaptured = null} = {}) {
        const tesseract = GLib.find_program_in_path('tesseract');
        if (!tesseract)
            throw new Error('Install tesseract-ocr and tesseract-ocr-vie.');

        await this.ensureLanguages();
        const tempPath = this._screenshotService.nextTempPath('zumi-ocr');
        const operation = {cancellable: new Gio.Cancellable(), process: null};
        this._running.add(operation);
        try {
            await this._screenshotService.saveArea(rect, tempPath);
            if (operation.cancellable.is_cancelled()) return null;
            onCaptured?.();
            const proc = Gio.Subprocess.new(
                [tesseract, tempPath, 'stdout', '-l', 'vie+eng', '--oem', '1', '--psm', '11', 'tsv'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            operation.process = proc;
            const [, stdout, stderr] = await communicateUtf8(proc, operation.cancellable);
            if (!proc.get_successful()) {
                const message = stderr?.trim() || 'Tesseract OCR failed.';
                if (/Error opening data file|Failed loading language|Could not initialize tesseract/i.test(message))
                    throw new Error('Missing Vietnamese OCR data. Install tesseract-ocr-vie and tesseract-ocr-eng.');
                throw new Error(message);
            }
            return parseOcrTsv(stdout ?? '');
        } finally {
            this._running.delete(operation);
            try {
                await Gio.File.new_for_path(tempPath).delete_async(GLib.PRIORITY_DEFAULT, null);
            } catch (error) {
                this._logger?.debug?.(`Unable to delete OCR temp file: ${error.message}`);
            }
        }
    }

    cancel() {
        for (const operation of this._running) {
            operation.cancellable.cancel();
            try { operation.process?.force_exit(); } catch (_error) { /* Process already exited. */ }
        }
    }

    destroy() {
        this.cancel();
        this._screenshotService = null;
        this._logger = null;
    }
}

function communicateUtf8(proc, cancellable) {
    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(null, cancellable, (source, result) => {
            try {
                resolve(source.communicate_utf8_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}
