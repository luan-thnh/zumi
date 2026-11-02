import assert from 'node:assert/strict';
import test from 'node:test';

import {centeredRect, containsPoint, monitorAtPoint} from '../src/core/monitor-geometry.js';

const monitors = [
    {index: 0, x: 0, y: 0, width: 1920, height: 1080},
    {index: 1, x: 1920, y: 0, width: 2560, height: 1440},
    {index: 2, x: -1280, y: 160, width: 1280, height: 1024},
];

test('containsPoint respects monitor offsets instead of assuming origin 0,0', () => {
    assert.equal(containsPoint(monitors[1], 2200, 400), true);
    assert.equal(containsPoint(monitors[1], 1500, 400), false);
    assert.equal(containsPoint(monitors[2], -900, 500), true);
});

test('monitorAtPoint resolves the display under the pointer in a mixed layout', () => {
    assert.equal(monitorAtPoint(monitors, 50, 50)?.index, 0);
    assert.equal(monitorAtPoint(monitors, 3000, 900)?.index, 1);
    assert.equal(monitorAtPoint(monitors, -640, 500)?.index, 2);
});

test('monitorAtPoint returns null outside every logical monitor', () => {
    assert.equal(monitorAtPoint(monitors, 5000, 5000), null);
});

test('centeredRect centers inside the selected monitor coordinate space', () => {
    assert.deepEqual(centeredRect(monitors[1], 600, 420), {
        x: 2900,
        y: 510,
        width: 600,
        height: 420,
    });
    assert.deepEqual(centeredRect(monitors[2], 600, 400), {
        x: -940,
        y: 472,
        width: 600,
        height: 400,
    });
});
