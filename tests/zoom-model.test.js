import assert from 'node:assert/strict';
import test from 'node:test';

import {ZoomModel} from '../src/zoom/zoom-model.js';

test('starts at configured factor', () => {
    const model = new ZoomModel({factor: 2.5, step: 0.25, min: 1, max: 8});
    assert.equal(model.factor, 2.5);
});

test('zooms in and out using configured step', () => {
    const model = new ZoomModel({factor: 2, step: 0.25, min: 1, max: 8});
    assert.equal(model.zoomIn(), 2.25);
    assert.equal(model.zoomOut(), 2);
});

test('clamps zoom to configured range', () => {
    const model = new ZoomModel({factor: 2, step: 1, min: 1, max: 3});
    assert.equal(model.setFactor(100), 3);
    assert.equal(model.setFactor(-10), 1);
});

test('avoids floating point drift in normal zoom steps', () => {
    const model = new ZoomModel({factor: 1, step: 0.1, min: 1, max: 8});
    model.zoomIn();
    model.zoomIn();
    model.zoomIn();
    assert.equal(model.factor, 1.3);
});
