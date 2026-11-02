import test from 'node:test';
import assert from 'node:assert/strict';
import {AnnotationController} from '../src/annotation/annotation-controller.js';
import {AnnotationTool} from '../src/annotation/annotation-tools.js';

test('pen commit requires movement', () => {
    const c = new AnnotationController();
    c.beginStroke(0,0); assert.equal(c.endStroke(0,0), false);
    c.beginStroke(0,0); c.updateStroke(3,0); assert.equal(c.endStroke(3,0), true);
    assert.equal(c.annotations.length, 1);
});

test('shape geometry is stored', () => {
    const c = new AnnotationController();
    c.beginStroke(10,20,{tool:AnnotationTool.RECTANGLE});
    c.endStroke(30,50);
    const a=c.annotations[0];
    assert.equal(a.type, AnnotationTool.RECTANGLE);
    assert.equal(a.x1,10); assert.equal(a.y2,50);
});

test('style is captured per annotation', () => {
    const c=new AnnotationController();
    c.setStyle({color:'#00FF00',width:9,opacity:.4});
    c.beginStroke(0,0,{tool:AnnotationTool.HIGHLIGHTER}); c.updateStroke(5,5); c.endStroke(5,5);
    assert.deepEqual(c.annotations[0].style,{color:'#00FF00',width:9,opacity:.4});
});

test('blur is stored as a sampled point stroke', () => {
    const c = new AnnotationController();
    c.beginStroke(0, 0, {tool: AnnotationTool.BLUR});
    c.updateStroke(8, 0);
    c.endStroke(16, 0);
    assert.equal(c.annotations[0].type, AnnotationTool.BLUR);
    assert.ok(c.annotations[0].points.length >= 2);
});

test('text annotations keep alignment and font size', () => {
    const c = new AnnotationController();
    assert.equal(c.addText({x: 20, y: 40, text: 'hello', align: 'right', fontSize: 32}), true);
    assert.equal(c.annotations[0].type, AnnotationTool.TEXT);
    assert.equal(c.annotations[0].align, 'right');
    assert.equal(c.annotations[0].fontSize, 32);
});
