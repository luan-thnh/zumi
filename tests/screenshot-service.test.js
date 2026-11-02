import assert from 'node:assert/strict';
import test from 'node:test';

// The GJS-facing ScreenshotService cannot be imported by Node because it imports gi://.
// Keep geometry independently tested here to catch the common negative-drag bug.
function normalizeRect(rect) {
    const x1 = Math.round(Math.min(rect.x1 ?? rect.x, rect.x2 ?? (rect.x + rect.width)));
    const y1 = Math.round(Math.min(rect.y1 ?? rect.y, rect.y2 ?? (rect.y + rect.height)));
    const x2 = Math.round(Math.max(rect.x1 ?? rect.x, rect.x2 ?? (rect.x + rect.width)));
    const y2 = Math.round(Math.max(rect.y1 ?? rect.y, rect.y2 ?? (rect.y + rect.height)));
    return {x: Math.max(0, x1), y: Math.max(0, y1), width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1)};
}

test('normalizes reverse drag rectangles', () => {
    assert.deepEqual(normalizeRect({x1: 200, y1: 120, x2: 50, y2: 20}), {
        x: 50,
        y: 20,
        width: 150,
        height: 100,
    });
});
