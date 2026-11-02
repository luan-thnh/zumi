// SPDX-License-Identifier: GPL-3.0-or-later

export class ZoomViewport {
    constructor({factor = 2, min = 1, max = 8, step = 0.25} = {}) {
        this._min = min;
        this._max = max;
        this._step = step;
        this._factor = clamp(factor, min, max);
        this._anchor = {x: 0, y: 0};
    }

    get factor() {
        return this._factor;
    }

    get anchor() {
        return {...this._anchor};
    }

    setAnchor(x, y) {
        this._anchor = {x, y};
        return this.transform;
    }

    zoomIn() {
        this._factor = clamp(round(this._factor + this._step), this._min, this._max);
        return this._factor;
    }

    zoomOut() {
        this._factor = clamp(round(this._factor - this._step), this._min, this._max);
        return this._factor;
    }

    setFactor(factor) {
        this._factor = clamp(factor, this._min, this._max);
        return this._factor;
    }

    get transform() {
        const {x, y} = this._anchor;
        const factor = this._factor;
        return {
            factor,
            translationX: x - x * factor,
            translationY: y - y * factor,
        };
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}
