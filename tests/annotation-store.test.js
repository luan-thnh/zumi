import assert from 'node:assert/strict';
import test from 'node:test';

import {AnnotationStore} from '../src/annotation/annotation-store.js';

test('add, undo and redo preserve annotation history', () => {
    const store = new AnnotationStore();
    const first = Object.freeze({type: 'line', x1: 0, y1: 0, x2: 10, y2: 10});
    const second = Object.freeze({type: 'rectangle', x1: 4, y1: 5, x2: 20, y2: 25});

    store.add(first);
    store.add(second);
    assert.deepEqual(store.items, [first, second]);

    assert.equal(store.undo(), true);
    assert.deepEqual(store.items, [first]);

    assert.equal(store.redo(), true);
    assert.deepEqual(store.items, [first, second]);
});

test('new annotation after undo invalidates redo stack', () => {
    const store = new AnnotationStore();

    store.add({id: 1});
    store.add({id: 2});
    store.undo();
    store.add({id: 3});

    assert.deepEqual(store.items, [{id: 1}, {id: 3}]);
    assert.equal(store.canRedo, false);
});

test('clear is undoable', () => {
    const store = new AnnotationStore();

    store.add({id: 1});
    store.add({id: 2});
    assert.equal(store.clear(), true);
    assert.deepEqual(store.items, []);

    assert.equal(store.undo(), true);
    assert.deepEqual(store.items, [{id: 1}, {id: 2}]);
});
