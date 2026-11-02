// SPDX-License-Identifier: GPL-3.0-or-later


import Gio from 'gi://Gio';

import {ZoomModel} from './zoom-model.js';

const APPLICATIONS_SCHEMA = 'org.gnome.desktop.a11y.applications';
const MAGNIFIER_SCHEMA = 'org.gnome.desktop.a11y.magnifier';
const ENABLED_KEY = 'screen-magnifier-enabled';
const FACTOR_KEY = 'mag-factor';

export class NativeMagnifierController {
    constructor({factor, step, maxFactor}) {
        this._applicationsSettings = new Gio.Settings({schema_id: APPLICATIONS_SCHEMA});
        this._magnifierSettings = new Gio.Settings({schema_id: MAGNIFIER_SCHEMA});
        this._model = new ZoomModel({
            factor,
            step,
            min: 1,
            max: maxFactor,
        });
        this._snapshot = null;
    }

    get active() {
        return this._snapshot !== null;
    }

    get factor() {
        return this._model.factor;
    }

    start() {
        if (this.active)
            return;

        this._snapshot = {
            enabled: this._applicationsSettings.get_boolean(ENABLED_KEY),
            factor: this._magnifierSettings.get_double(FACTOR_KEY),
        };

        this._magnifierSettings.set_double(FACTOR_KEY, this._model.factor);
        this._applicationsSettings.set_boolean(ENABLED_KEY, true);
    }

    stop() {
        if (!this.active)
            return;

        this._magnifierSettings.set_double(FACTOR_KEY, this._snapshot.factor);
        this._applicationsSettings.set_boolean(ENABLED_KEY, this._snapshot.enabled);
        this._snapshot = null;
    }

    zoomIn() {
        const factor = this._model.zoomIn();
        this._applyFactor(factor);
        return factor;
    }

    zoomOut() {
        const factor = this._model.zoomOut();
        this._applyFactor(factor);
        return factor;
    }

    _applyFactor(factor) {
        if (this.active)
            this._magnifierSettings.set_double(FACTOR_KEY, factor);
    }

    destroy() {
        this.stop();
        this._applicationsSettings = null;
        this._magnifierSettings = null;
        this._model = null;
    }
}
