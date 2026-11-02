import assert from 'node:assert/strict';
import test from 'node:test';

import {BreakTimerModel} from '../src/timer/timer-model.js';

test('break timer counts down and exposes progress', () => {
    const timer = new BreakTimerModel(120);
    assert.equal(timer.displayText, '02:00');
    timer.tick();
    assert.equal(timer.remaining, 119);
    assert.ok(timer.progress > 0);
});

test('break timer pause prevents ticking and reset restores duration', () => {
    const timer = new BreakTimerModel(120);
    timer.togglePause();
    timer.tick();
    assert.equal(timer.remaining, 120);
    timer.togglePause();
    timer.tick();
    timer.reset();
    assert.equal(timer.remaining, 120);
    assert.equal(timer.paused, false);
});

test('break timer shows overtime with plus prefix', () => {
    const timer = new BreakTimerModel(60);
    for (let i = 0; i < 61; i++) timer.tick();
    assert.equal(timer.overtime, true);
    assert.equal(timer.displayText, '+00:01');
    assert.equal(timer.progress, 1);
});

test('break timer adjusts by whole minutes', () => {
    const timer = new BreakTimerModel(120);
    timer.adjustMinutes(1);
    assert.equal(timer.displayText, '03:00');
    timer.adjustMinutes(-1);
    assert.equal(timer.displayText, '02:00');
});
