// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';

import {CanvasMode} from './canvas-mode.js';
import {StatusOsd} from '../overlay/status-osd.js';

export class SessionManager {
    constructor({settings, monitorManager, logger}) {
        this._settings = settings;
        this._monitorManager = monitorManager;
        this._logger = logger;
        this._screenshotService = null;
        this._ocrService = null;
        this._featureImports = new Map();
        this._status = new StatusOsd({
            monitorProvider: () => this._monitorManager?.getCurrentMonitor?.(),
        });
        // Recorder D-Bus proxy and DemoType are unnecessary for most sessions.
        this._recorder = null;
        this._demoType = null;

        this._overlay = null;
        this._timer = null;
        this._liveZoom = null;
        this._liveZoomInput = null;
        this._selector = null;
        this._ocrOverlay = null;
        this._ocrRequest = 0;
        this._focusSpotlight = null;
        this._cursorHighlight = null;
        this._sources = new Map();
        this._selectorGeneration = 0;
        this._generation = 0;
        this._destroyed = false;
    }

    getPanelState() {
        return {
            canvasMode: this._overlay?.mode ?? null,
            timerActive: Boolean(this._timer),
            timerMinimized: Boolean(this._timer && !this._timer.visible),
            liveZoom: Boolean(this._liveZoom),
            recordingActive: Boolean(this._recorder?.active),
            focusSpotlight: Boolean(this._focusSpotlight),
            cursorHighlight: this._settings?.get_boolean('cursor-highlight-enabled') ?? false,
            timerPaused: Boolean(this._timer?.paused),
            timerRemaining: this._timer?.remaining ?? null,
        };
    }

    restoreBreakTimer() {
        if (!this._timer)
            return false;

        this._timer.show();
        return true;
    }

    async setCursorHighlight(enabled) {
        if (!enabled) {
            this._stopCursorHighlight();
            return;
        }
        if (this._cursorHighlight)
            return;
        const feature = await this._load('cursorHighlight', () => import('../presentation/cursor-highlight.js'));
        if (!feature || !this._settings.get_boolean('cursor-highlight-enabled'))
            return;
        this._cursorHighlight = new feature.CursorHighlight({settings: this._settings});
    }

    _stopCursorHighlight() {
        this._cursorHighlight?.destroy();
        this._cursorHighlight = null;
    }

    async toggleFocusSpotlight() {
        if (this._focusSpotlight) {
            this._stopFocusSpotlight();
            return;
        }

        this._stopOverlay();
        this._stopTimer();
        this._stopLiveZoom();
        this._demoType?.stop();
        const feature = await this._load('focus', () => import('../presentation/focus-spotlight-overlay.js'));
        if (!feature)
            return;
        this._focusSpotlight = new feature.FocusSpotlightOverlay({
            radius: this._settings.get_int('focus-radius'),
            dimOpacity: this._settings.get_int('focus-dim-opacity'),
            monitorProvider: () => this._monitorManager?.getCurrentMonitor?.(),
            onClose: () => this._stopFocusSpotlight(),
        });
        this._focusSpotlight.show();
        this._status?.show('Focus Spotlight · scroll to resize');
    }

    async toggleStaticZoom() {
        if (this._overlay?.mode === CanvasMode.STATIC_ZOOM) {
            this._stopOverlay();
            return;
        }
        this._stopOverlay();
        this._stopTimer();
        this._stopLiveZoom();
        this._demoType?.stop();
        this._stopFocusSpotlight();
        await this._startCapturedOverlay(CanvasMode.STATIC_ZOOM);
    }

    async toggleDraw() {
        if (this._overlay?.mode === CanvasMode.DRAW) {
            this._stopOverlay();
            return;
        }
        this._stopOverlay();
        this._stopTimer();
        this._stopLiveZoom();
        this._demoType?.stop();
        this._stopFocusSpotlight();
        await this._startCapturedOverlay(CanvasMode.DRAW);
    }

    async toggleBreakTimer() {
        if (this._timer) {
            if (!this._timer.visible) {
                this._timer.show();
                return;
            }
            this._stopTimer();
            return;
        }

        this._stopOverlay();
        this._stopLiveZoom();
        this._demoType?.stop();
        this._stopFocusSpotlight();
        const feature = await this._load('timer', () => import('../timer/break-timer-overlay.js'));
        if (!feature)
            return;
        this._timer = new feature.BreakTimerOverlay({
            minutes: this._settings.get_int('break-minutes'),
            opacity: this._settings.get_int('break-opacity'),
            message: this._settings.get_string('break-message'),
            showEndTime: this._settings.get_boolean('break-show-end-time'),
            appearance: this._settings.get_string('break-appearance'),
            settings: this._settings,
            monitorProvider: () => this._monitorManager?.getCurrentMonitor?.(),
            onClose: () => this._stopTimer(),
            onAction: action => this._handleOverlayAction(action),
        });
        this._timer.show();
    }

    async toggleLiveZoom() {
        if (this._liveZoom) {
            this._stopLiveZoom();
            return;
        }

        this._stopOverlay();
        this._stopTimer();
        this._demoType?.stop();
        this._stopFocusSpotlight();
        const feature = await this._load('magnifier', () => import('../zoom/native-magnifier-controller.js'));
        if (!feature)
            return;
        this._liveZoom = new feature.NativeMagnifierController({
            factor: this._settings.get_double('default-zoom-factor'),
            step: this._settings.get_double('zoom-step'),
            maxFactor: this._settings.get_double('max-zoom-factor'),
        });
        this._liveZoom.start();
        const controller = this._liveZoom;
        await this._startLiveZoomInput();
        if (this._liveZoom === controller)
            this._status?.show(`LiveZoom ${controller.factor.toFixed(2)}×`);
    }

    async toggleLiveDraw() {
        if (this._overlay?.mode === CanvasMode.LIVE_DRAW) {
            this._stopOverlay();
            return;
        }

        this._stopOverlay();
        this._stopTimer();
        this._demoType?.stop();
        this._stopFocusSpotlight();
        const feature = await this._load('canvas', () => import('../overlay/zoomit-canvas-overlay.js'));
        if (!feature)
            return;
        this._overlay = new feature.ZoomItCanvasOverlay({
            mode: CanvasMode.LIVE_DRAW,
            settings: this._settings,
            monitorProvider: () => this._monitorManager?.getCurrentMonitor?.(),
            onClose: () => this._stopOverlay(),
            onAction: action => this._handleOverlayAction(action),
        });
        this._overlay.show();
    }

    async recordFull() {
        this._prepareRecorder();
        const recorder = await this._ensureRecorder();
        if (recorder)
            await recorder.toggle('full');
    }

    async recordRegion() {
        if (this._recorder?.active) {
            await this._recorder.stop();
            return;
        }
        this._prepareRecorder();
        await this._selectRegion(async rect => {
            const recorder = await this._ensureRecorder();
            if (recorder)
                await recorder.start('region', rect);
        });
    }

    async recordWindow() {
        if (this._recorder?.active) {
            await this._recorder.stop();
            return;
        }
        this._prepareRecorder();
        const rect = this._windowRectUnderPointer();
        if (!rect) {
            this._status?.show('No window under pointer');
            return;
        }
        const recorder = await this._ensureRecorder();
        if (recorder)
            await recorder.start('window', rect);
    }

    async recordPanorama() {
        this._prepareRecorder();
        const recorder = await this._ensureRecorder();
        if (recorder)
            await recorder.toggle('panorama');
    }

    async snipCopy() {
        this._prepareGlobalCapture();
        await this._selectRegion(async rect => {
            const service = await this._ensureScreenshot();
            if (!service) return;
            await service.copyArea(rect);
            this._status?.show('Copied region');
        });
    }

    async snipSave() {
        this._prepareGlobalCapture();
        await this._selectRegion(async rect => {
            const service = await this._ensureScreenshot();
            if (!service) return;
            const path = await service.saveArea(rect);
            this._status?.show(`Saved · ${basename(path)}`, 1400);
        });
    }

    async snipOcr() {
        this._prepareGlobalCapture();
        const ocr = await this._ensureOcr();
        if (!ocr) return;
        try {
            await ocr.ensureLanguages();
        } catch (error) {
            this._logger?.error?.(`OCR language data unavailable: ${error.message}`);
            this._status?.show('Cài tesseract-ocr-vie và tesseract-ocr-eng', 3600);
            return;
        }
        await this._selectRegion(async rect => {
            const request = ++this._ocrRequest;
            try {
                const feature = await this._load('ocrOverlay', () => import('../capture/ocr-result-overlay.js'));
                if (!feature || request !== this._ocrRequest) return;
                const result = await ocr.recognizeArea(rect, {
                    onCaptured: () => {
                        if (this._destroyed || request !== this._ocrRequest) return;
                        this._ocrOverlay = new feature.OcrResultOverlay({
                            rect,
                            onClose: () => this._stopOcr(),
                            onCopy: () => {
                                this._status?.show('Đã sao chép văn bản');
                                this._stopOcr();
                            },
                        });
                        this._ocrOverlay.show();
                    },
                });
                if (request === this._ocrRequest && result)
                    this._ocrOverlay?.showResult(result);
            } catch (error) {
                if (this._destroyed || request !== this._ocrRequest) return;
                this._logger?.error?.(`OCR failed: ${error.message}`);
                if (this._ocrOverlay)
                    this._ocrOverlay.showError(error.message);
                else
                    this._status?.show('OCR lỗi: kiểm tra tesseract-ocr-vie', 2600);
            }
        });
    }

    async toggleDemoType() {
        this._stopOverlay();
        this._stopTimer();
        this._stopLiveZoom();
        this._stopFocusSpotlight();
        (await this._ensureDemoType())?.toggle();
    }

    async previousDemoSnippet() {
        this._stopOverlay();
        this._stopTimer();
        this._stopLiveZoom();
        this._stopFocusSpotlight();
        (await this._ensureDemoType())?.previous();
    }

    async nextDemoSnippet() {
        (await this._ensureDemoType())?.next();
    }

    async _load(name, loader) {
        if (this._destroyed)
            return null;
        if (!this._featureImports.has(name)) {
            const pending = loader().catch(error => {
                this._featureImports?.delete(name);
                throw error;
            });
            this._featureImports.set(name, pending);
        }
        const feature = await this._featureImports.get(name);
        return this._destroyed ? null : feature;
    }

    async _ensureScreenshot() {
        if (this._screenshotService)
            return this._screenshotService;
        const feature = await this._load('screenshot', () => import('../capture/screenshot-service.js'));
        if (!feature) return null;
        return this._screenshotService ??= new feature.ScreenshotService();
    }

    async _ensureOcr() {
        if (this._ocrService)
            return this._ocrService;
        const screenshotService = await this._ensureScreenshot();
        if (!screenshotService) return null;
        const feature = await this._load('ocr', () => import('../capture/ocr-service.js'));
        if (!feature) return null;
        return this._ocrService ??= new feature.OcrService({screenshotService, logger: this._logger});
    }

    async _ensureRecorder() {
        if (this._recorder)
            return this._recorder;
        const feature = await this._load('recorder', () => import('../recording/native-recorder-service.js'));
        if (!feature) return null;
        return this._recorder ??= new feature.NativeRecorderService({
            notify: text => this._status?.show(text, 1300),
            logger: this._logger,
        });
    }

    async _ensureDemoType() {
        if (this._demoType)
            return this._demoType;
        const feature = await this._load('demo', () => import('../demo/demo-type-service.js'));
        if (!feature) return null;
        return this._demoType ??= new feature.DemoTypeService({
            settings: this._settings,
            notify: text => this._status?.show(text, 1300),
            logger: this._logger,
        });
    }

    async _startCapturedOverlay(mode) {
        const generation = ++this._generation;
        try {
            const screenshot = await this._ensureScreenshot();
            if (!screenshot || generation !== this._generation)
                return;
            const capture = await screenshot.captureStage();
            if (this._destroyed || generation !== this._generation)
                return;

            const feature = await this._load('canvas', () => import('../overlay/zoomit-canvas-overlay.js'));
            if (!feature || generation !== this._generation)
                return;
            this._overlay = new feature.ZoomItCanvasOverlay({
                mode,
                capture,
                settings: this._settings,
                monitorProvider: () => this._monitorManager?.getCurrentMonitor?.(),
                onClose: () => this._stopOverlay(),
                onAction: action => this._handleOverlayAction(action),
            });
            this._overlay.show();
        } catch (error) {
            if (this._destroyed || generation !== this._generation)
                return;
            this._logger?.error?.(`Unable to start ${mode}: ${error.message}`);
            this._status?.show('Capture failed');
        }
    }

    async _handleOverlayAction(action) {
        try {
            if (action === 'zoom-mode') {
                await this.toggleStaticZoom();
                return;
            }
            if (action === 'draw-mode') {
                await this.toggleDraw();
                return;
            }
            if (action === 'copy-screen') {
                if (!await this._afterUiSettles()) return;
                const screenshot = await this._ensureScreenshot();
                if (!screenshot) return;
                await screenshot.copyScreen();
                this._status?.show('Copied screenshot');
                return;
            }
            if (action === 'save-screen') {
                if (!await this._afterUiSettles()) return;
                const screenshot = await this._ensureScreenshot();
                if (!screenshot) return;
                const path = await screenshot.saveScreen();
                this._status?.show(`Saved · ${basename(path)}`, 1400);
                return;
            }
            if (action === 'crop-copy') {
                await this._selectRegion(async rect => {
                    const screenshot = await this._ensureScreenshot();
                    if (!screenshot) return;
                    await screenshot.copyArea(rect);
                    this._status?.show('Copied crop');
                });
                return;
            }
            if (action === 'crop-save') {
                await this._selectRegion(async rect => {
                    const screenshot = await this._ensureScreenshot();
                    if (!screenshot) return;
                    const path = await screenshot.saveArea(rect);
                    this._status?.show(`Saved · ${basename(path)}`, 1400);
                });
                return;
            }
            if (action === 'snip-copy') {
                await this.snipCopy();
                return;
            }
            if (action === 'snip-save') {
                await this.snipSave();
                return;
            }
            if (action === 'snip-ocr') {
                await this.snipOcr();
                return;
            }
            if (action === 'record-full') {
                await this.recordFull();
                return;
            }
            if (action === 'record-region') {
                await this.recordRegion();
                return;
            }
            if (action === 'record-window') {
                await this.recordWindow();
                return;
            }
            if (action === 'panorama') {
                await this.recordPanorama();
                return;
            }
            if (action === 'break-timer') {
                this._stopOverlay();
                await this.toggleBreakTimer();
                return;
            }
            if (action === 'live-zoom') {
                await this.toggleLiveZoom();
                return;
            }
            if (action === 'live-draw') {
                await this.toggleLiveDraw();
                return;
            }
            if (action === 'demo-type') {
                await this.toggleDemoType();
                return;
            }
            if (action === 'demo-type-previous')
                await this.previousDemoSnippet();
        } catch (error) {
            this._logger?.error?.(`Overlay action ${action} failed: ${error.message}`);
            this._status?.show('Action failed');
        }
    }

    async _selectRegion(onSelected) {
        const generation = ++this._selectorGeneration;
        this._selector?.destroy();
        this._selector = null;
        const feature = await this._load('selector', () => import('../capture/region-selector-overlay.js'));
        if (!feature || generation !== this._selectorGeneration) return;
        this._selector = new feature.RegionSelectorOverlay({
            onCancel: () => this._stopSelector(),
            onSelected: rect => {
                this._stopSelector();
                this._afterUiSettles()
                    .then(ready => ready ? onSelected(rect) : undefined)
                    .catch(error => {
                        this._logger?.error?.(`Region action failed: ${error.message}`);
                        this._status?.show('Region action failed');
                    });
            },
        });
        this._selector.show();
    }

    _windowRectUnderPointer() {
        const [pointerX, pointerY] = global.get_pointer();
        const actors = [...global.get_window_actors()].reverse();
        for (const actor of actors) {
            try {
                const window = actor.get_meta_window?.();
                if (!window || window.minimized)
                    continue;
                const rect = window.get_frame_rect();
                if (pointerX >= rect.x && pointerX < rect.x + rect.width &&
                    pointerY >= rect.y && pointerY < rect.y + rect.height) {
                    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
                }
            } catch (_error) {
                // Ignore an actor that disappeared while enumerating the stack.
            }
        }

        try {
            const window = global.display.focus_window;
            const rect = window?.get_frame_rect?.();
            if (rect)
                return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
        } catch (_error) {
            // No focused window fallback.
        }
        return null;
    }

    _prepareGlobalCapture() {
        this._stopOcr();
        this._stopOverlay();
        this._stopTimer();
        this._stopLiveZoom();
        this._demoType?.stop();
        this._stopFocusSpotlight();
        this._status?.hide();
    }

    _prepareRecorder() {
        this._overlay?.hideStatus();
        this._stopTimer();
        this._demoType?.stop();
        this._stopFocusSpotlight();
        this._status?.hide();
    }

    async _startLiveZoomInput() {
        this._liveZoomInput?.destroy();
        const controller = this._liveZoom;
        const feature = await this._load('zoomInput', () => import('../zoom/live-zoom-input-controller.js'));
        if (!feature || this._liveZoom !== controller) return;
        this._liveZoomInput = new feature.LiveZoomInputController({
            zoomController: this._liveZoom,
            onClose: () => this._stopLiveZoom(),
            onFactorChanged: factor => this._status?.show(`LiveZoom ${factor.toFixed(2)}×`),
        });
        this._liveZoomInput.start();
    }

    _afterUiSettles() {
        if (this._destroyed) return Promise.resolve(false);
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 48, () => {
                this._sources.delete(id);
                resolve(!this._destroyed);
                return GLib.SOURCE_REMOVE;
            });
            this._sources.set(id, resolve);
        });
    }

    _stopOcr() {
        this._ocrRequest++;
        this._ocrOverlay?.destroy();
        this._ocrOverlay = null;
        this._ocrService?.cancel();
    }

    _stopSelector() {
        this._selectorGeneration++;
        this._selector?.destroy();
        this._selector = null;
    }

    _stopOverlay() {
        this._generation++;
        this._overlay?.destroy();
        this._overlay = null;
    }

    _stopTimer() {
        this._timer?.destroy();
        this._timer = null;
    }

    _stopLiveZoom() {
        this._liveZoomInput?.destroy();
        this._liveZoomInput = null;
        this._liveZoom?.destroy();
        this._liveZoom = null;
    }

    _stopFocusSpotlight() {
        this._focusSpotlight?.destroy();
        this._focusSpotlight = null;
    }

    destroy() {
        this._destroyed = true;
        for (const [id, resolve] of this._sources) {
            GLib.Source.remove(id);
            resolve(false);
        }
        this._sources.clear();
        this._featureImports.clear();

        this._stopOcr();
        this._stopSelector();
        this._stopOverlay();
        this._stopTimer();
        this._stopLiveZoom();
        this._stopFocusSpotlight();
        this._stopCursorHighlight();
        this._demoType?.destroy();
        this._recorder?.destroy();
        this._ocrService?.destroy();
        this._screenshotService?.destroy();
        this._status?.destroy();

        this._demoType = null;
        this._recorder = null;
        this._ocrService = null;
        this._screenshotService = null;
        this._status = null;
        this._settings = null;
        this._monitorManager = null;
        this._logger = null;
    }
}

function basename(path) {
    return String(path).split('/').pop() ?? String(path);
}
