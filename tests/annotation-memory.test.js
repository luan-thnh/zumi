import test from 'node:test';
import assert from 'node:assert/strict';

import {AnnotationStore} from '../src/annotation/annotation-store.js';
import {AnnotationController} from '../src/annotation/annotation-controller.js';
import {AnnotationTool} from '../src/annotation/annotation-tools.js';

test('thousands of additions retain one small history action per stroke', () => {
    const store = new AnnotationStore();
    const count = 5000;
    for (let i = 0; i < count; i++)
        store.add({id: i});

    assert.equal(store.items.length, count);
    assert.equal(store._past.length, count);
    assert.ok(store._past.every(a => a.type === 'add' && !('annotations' in a)),
        'normal strokes must not retain duplicate array snapshots');
    for (let i = 0; i < count; i++)
        assert.equal(store.undo(), true);
    assert.equal(store.canUndo, false);
    assert.equal(store.items.length, 0);
    for (let i = 0; i < count; i++)
        assert.equal(store.redo(), true);
    assert.equal(store.items.length, count);
    assert.equal(store.items[4999].id, 4999);
});

test('clear, undo, redo and branching preserve exact snapshots', () => {
    const store = new AnnotationStore();
    const snapshot = () => store.items.map(a => a.id);
    store.add({id: 1});
    store.add({id: 2});
    assert.equal(store.clear(), true);
    store.add({id: 3});
    assert.deepEqual(snapshot(), [3]);
    store.undo(); assert.deepEqual(snapshot(), []);
    store.undo(); assert.deepEqual(snapshot(), [1, 2]);
    store.undo(); assert.deepEqual(snapshot(), [1]);
    store.redo(); assert.deepEqual(snapshot(), [1, 2]);
    store.redo(); assert.deepEqual(snapshot(), []);
    store.redo(); assert.deepEqual(snapshot(), [3]);
    store.undo(); store.undo(); assert.deepEqual(snapshot(), [1, 2]);
    store.add({id: 4});
    assert.equal(store.canRedo, false);
    assert.deepEqual(snapshot(), [1, 2, 4]);
    store.reset();
    assert.deepEqual(snapshot(), []);
    assert.equal(store.canUndo, false);
    assert.equal(store.canRedo, false);
});

test('straight pen samples compact, but sharp corners and reversals remain', () => {
    const controller = new AnnotationController();
    controller.beginStroke(0, 0);
    for (let x = 1; x <= 2000; x++)
        controller.updateStroke(x, 0);
    assert.equal(controller.draftAnnotation.points.length, 2);
    controller.updateStroke(1990, 0); // Reverse direction must retain the turning point.
    controller.updateStroke(1990, 20); // A corner must not be lost.
    assert.equal(controller.draftAnnotation.points.length, 4);
    const draft = controller.draftAnnotation;
    const points = draft.points;
    const firstPoint = points[0];
    assert.equal(controller.endStroke(1990, 20), true);
    const saved = controller.committedAnnotations[0];
    assert.strictEqual(saved.points, points, 'commit should reuse the points array');
    assert.strictEqual(saved.points[0], firstPoint, 'commit should not copy point objects');
    assert.ok(Object.isFrozen(saved.points));
    assert.ok(Object.isFrozen(saved.points[0]));
    controller.undo();
    controller.redo();
    assert.strictEqual(controller.committedAnnotations[0], saved);
    controller.destroy();
});

test('curved pen strokes and blur sampling remain intact', () => {
    const controller = new AnnotationController();
    controller.beginStroke(0, 0, {tool: AnnotationTool.HIGHLIGHTER});
    for (let x = 1; x <= 50; x++)
        controller.updateStroke(x, Math.sin(x / 3) * 10);
    assert.ok(controller.draftAnnotation.points.length > 20,
        'curved paths must retain enough detail for the same visible shape');
    controller.endStroke(50, Math.sin(50 / 3) * 10);

    controller.beginStroke(0, 0, {tool: AnnotationTool.BLUR});
    for (let x = 4; x <= 40; x += 4)
        controller.updateStroke(x, 0);
    assert.equal(controller.draftAnnotation.points.length, 11,
        'blur mosaic depends on the existing sample sequence');
    controller.endStroke(40, 0);
    controller.destroy();
});

test('edit-log history agrees with snapshot history across mixed operations', () => {
    const store = new AnnotationStore();
    const snapshots = [[]];
    let cursor = 0;
    let seed = 123456789;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
    };

    for (let i = 0; i < 1200; i++) {
        const action = Math.floor(random() * 5);
        if (action <= 1) {
            const next = [...snapshots[cursor], i];
            snapshots.splice(cursor + 1);
            snapshots.push(next);
            cursor++;
            store.add({id: i});
        } else if (action === 2) {
            if (snapshots[cursor].length > 0) {
                snapshots.splice(cursor + 1);
                snapshots.push([]);
                cursor++;
                assert.equal(store.clear(), true);
            } else {
                assert.equal(store.clear(), false);
            }
        } else if (action === 3) {
            assert.equal(store.undo(), cursor > 0);
            if (cursor > 0) cursor--;
        } else {
            assert.equal(store.redo(), cursor < snapshots.length - 1);
            if (cursor < snapshots.length - 1) cursor++;
        }
        assert.deepEqual(store.items.map(a => a.id), snapshots[cursor],
            `mismatch at randomized action ${i}`);
        assert.equal(store.canUndo, cursor > 0);
        assert.equal(store.canRedo, cursor < snapshots.length - 1);
    }
});
