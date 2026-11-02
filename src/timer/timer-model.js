// SPDX-License-Identifier: GPL-3.0-or-later

const MIN_DURATION_SECONDS = 60;

export class BreakTimerModel {
    constructor(seconds = 600) {
        const normalized = Math.max(MIN_DURATION_SECONDS, Math.round(seconds));
        this._duration = normalized;
        this._remaining = normalized;
        this._paused = false;
    }

    get duration() { return this._duration; }
    get remaining() { return this._remaining; }
    get paused() { return this._paused; }
    get overtime() { return this._remaining < 0; }
    get expired() { return this._remaining <= 0; }

    get progress() {
        if (this._remaining <= 0)
            return 1;
        return clamp(1 - this._remaining / Math.max(1, this._duration), 0, 1);
    }

    get displayText() {
        const prefix = this._remaining < 0 ? '+' : '';
        const value = Math.abs(this._remaining);
        const minutes = Math.floor(value / 60);
        const seconds = value % 60;
        return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    tick() {
        if (this._paused)
            return false;
        this._remaining -= 1;
        return true;
    }

    adjustMinutes(delta) {
        const change = Math.round(delta) * 60;
        if (!change)
            return false;

        this._remaining += change;
        // While the timer has not expired, keep progress meaningful after an
        // adjustment by updating the planned duration too.
        if (this._remaining > 0)
            this._duration = Math.max(MIN_DURATION_SECONDS, this._duration + change);
        return true;
    }

    togglePause() {
        this._paused = !this._paused;
        return this._paused;
    }

    reset() {
        this._remaining = this._duration;
        this._paused = false;
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
