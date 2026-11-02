import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {AnnotationController} from '../src/annotation/annotation-controller.js';
import {AnnotationTool} from '../src/annotation/annotation-tools.js';

class FakeActor {
    constructor() { this._signals = new Map(); this.repaints = 0; this.children = []; }
    add_child(child) { this.children.push(child); }
    connect(name, handler) { this._signals.set(name, handler); return 1; }
    disconnect(id) { assert.equal(id, 1); this._signals.clear(); }
    queue_repaint() { this.repaints++; }
    get_context() { return {$dispose() {}}; }
    flush() {
        if (!this.repaints) return;
        this.repaints = 0;
        this._signals.get('repaint')?.(this);
    }
}

function makeLayer(controller) {
    const src = fs.readFileSync(new URL('../src/annotation/drawing-layer.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export class ', 'class ')
        .replaceAll('export function ', 'function ');
    const DrawingLayer = vm.runInNewContext(`${src}\nDrawingLayer`, {
        St: {Widget: FakeActor, DrawingArea: FakeActor},
        Clutter: {BinLayout: class {}},
        Cairo: {},
        AnnotationTool,
    });
    return new DrawingLayer({annotationController: controller});
}

test('pointer motion paints only the active draft, even with a large history', () => {
    let layer;
    const controller = new AnnotationController({onChanged: changed => layer?.queueRepaint(changed)});
    layer = makeLayer(controller);
    assert.equal(layer.actor.children.length, 2);
    const painted = [];
    layer._paintAnnotation = (_cr, annotation) => painted.push(annotation);

    for (let i = 0; i < 200; i++) {
        controller.beginStroke(i, 1);
        controller.endStroke(i + 5, 1);
    }
    layer._finished.flush();
    layer._draft.flush();
    assert.equal(painted.length, 200);
    painted.length = 0;

    controller.beginStroke(300, 1);
    for (let i = 0; i < 10; i++) {
        controller.updateStroke(301 + i * 2, 1);
        layer._draft.flush();
    }
    assert.equal(layer._finished.repaints, 0, 'committed strokes must stay cached during motion');
    assert.equal(painted.length, 10, 'only draft is painted for each pointer move');
    assert.equal(painted.every(a => a === controller.draftAnnotation), true);

    controller.endStroke(325, 1);
    painted.length = 0;
    layer._finished.flush();
    layer._draft.flush();
    assert.equal(painted.length, 201, 'commit rebuilds the cached history exactly once');
    layer.destroy();
    assert.equal(layer._finished, null);
    controller.destroy();
});

test('undo/redo/clear and cancelled draft invalidate the correct surface', () => {
    let layer;
    const controller = new AnnotationController({onChanged: changed => layer?.queueRepaint(changed)});
    layer = makeLayer(controller);
    const painted = [];
    layer._paintAnnotation = (_cr, annotation) => painted.push(annotation);

    controller.addText({x: 4, y: 5, text: 'Hello'});
    layer._finished.flush(); layer._draft.flush();
    assert.equal(painted.length, 1);
    painted.length = 0;
    controller.beginStroke(0, 0);
    controller.updateStroke(4, 0);
    controller.cancelStroke();
    assert.equal(layer._finished.repaints, 0);
    layer._draft.flush();
    assert.equal(painted.length, 0, 'a cancelled stroke leaves no pixels behind');

    controller.undo();
    layer._finished.flush(); layer._draft.flush();
    assert.equal(painted.length, 0);
    controller.redo();
    layer._finished.flush(); layer._draft.flush();
    assert.equal(painted.length, 1);
    painted.length = 0;
    controller.clear();
    layer._finished.flush(); layer._draft.flush();
    assert.equal(painted.length, 0);
    controller.addText({x: 5, y: 6, text: 'Next'});
    layer._finished.flush(); layer._draft.flush();
    assert.equal(painted.length, 1);

    layer.destroy();
    controller.destroy();
});

test('committed history is untouched by style and tool changes', () => {
    let layer;
    const controller = new AnnotationController({onChanged: changed => layer?.queueRepaint(changed)});
    layer = makeLayer(controller);
    layer._paintAnnotation = () => {};
    controller.beginStroke(0, 0);
    controller.endStroke(4, 0);
    layer._finished.flush(); layer._draft.flush();
    controller.setStyle({color: '#ffffff'});
    controller.setTool(AnnotationTool.RECTANGLE);
    assert.equal(layer._finished.repaints, 0);
    layer.destroy();
    controller.destroy();
});
