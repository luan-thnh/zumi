import assert from 'node:assert/strict';
import test from 'node:test';

import {ZoomViewport} from '../src/zoom/zoom-viewport.js';

test('anchor remains visually fixed during zoom', () => {
    const viewport = new ZoomViewport({factor: 2});
    viewport.setAnchor(300, 200);
    const transform = viewport.transform;
    assert.equal(300 * transform.factor + transform.translationX, 300);
    assert.equal(200 * transform.factor + transform.translationY, 200);
});

test('moving anchor calculates immediate pointer-relative transform', () => {
    const viewport = new ZoomViewport({factor: 2});
    viewport.setAnchor(500, 250);
    assert.deepEqual(viewport.transform, {
        factor: 2,
        translationX: -500,
        translationY: -250,
    });
});

test('zoom stays within configured bounds', () => {
    const viewport = new ZoomViewport({factor: 1.25, min: 1.25, max: 2, step: 0.5});
    viewport.zoomOut();
    assert.equal(viewport.factor, 1.25);
    viewport.zoomIn();
    viewport.zoomIn();
    viewport.zoomIn();
    assert.equal(viewport.factor, 2);
});
