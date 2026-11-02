// SPDX-License-Identifier: GPL-3.0-or-later

// and can maintain this code.

export class ZoomModel {
    constructor({factor = 2, step = 0.25, min = 1, max = 8} = {}) {
        this._step = step;
        this._min = min;
        this._max = max;
        this._factor = this._clamp(factor);
    }

    get factor() {
        return this._factor;
    }

    zoomIn() {
        return this.setFactor(this._factor + this._step);
    }

    zoomOut() {
        return this.setFactor(this._factor - this._step);
    }

    setFactor(value) {
        const rounded = Math.round(value * 100) / 100;
        this._factor = this._clamp(rounded);
        return this._factor;
    }

    _clamp(value) {
        return Math.min(this._max, Math.max(this._min, value));
    }
}
