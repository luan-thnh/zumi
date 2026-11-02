import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../stylesheet.css', import.meta.url), 'utf8');
const src = fs.readFileSync(new URL('../src/timer/break-timer-overlay.js', import.meta.url), 'utf8');

test('timer has a larger layout and blue accent in both GNOME appearance modes', () => {
    assert.match(src, /CARD_WIDTH = 312/);
    assert.match(src, /CARD_HEIGHT = 364/);
    assert.match(src, /RING_SIZE = 216/);
    assert.match(src, /for \(const key of \['color-scheme', 'gtk-theme'\]\)/);
    assert.match(src, /_interfaceSettings\?\.disconnect\(id\)/);
    assert.match(css, /\.lumalens-break-card-dark \.lumalens-break-time/);
    assert.match(css, /\.lumalens-break-card-dark \.lumalens-timer-action/);
    assert.match(css, /background-color: #387af9/);
});

test('panel menu inherits GNOME light and dark typography instead of forced white text', () => {
    const menuCss = css.substring(0, css.indexOf('.lumalens-canvas-overlay'));
    assert.doesNotMatch(menuCss, /color:\s*#fff|color:\s*rgba\(255,\s*255,\s*255/);
});
