import test from 'node:test';
import assert from 'node:assert/strict';
import {AnnotationTool, colorForKey, resolveGestureTool, ZOOMIT_COLORS} from '../src/annotation/annotation-tools.js';

test('ZoomIt color keys', () => {
    assert.equal(colorForKey('r'), ZOOMIT_COLORS.red);
    assert.equal(colorForKey('G'), ZOOMIT_COLORS.green);
    assert.equal(colorForKey('p'), ZOOMIT_COLORS.pink);
    assert.equal(colorForKey('q'), null);
});

test('ZoomIt gesture priority', () => {
    assert.equal(resolveGestureTool({shift: true, control: true}), AnnotationTool.ARROW);
    assert.equal(resolveGestureTool({control: true}), AnnotationTool.RECTANGLE);
    assert.equal(resolveGestureTool({tab: true}), AnnotationTool.ELLIPSE);
    assert.equal(resolveGestureTool({shift: true}), AnnotationTool.LINE);
    assert.equal(resolveGestureTool({currentTool: AnnotationTool.HIGHLIGHTER}), AnnotationTool.HIGHLIGHTER);
    assert.equal(resolveGestureTool({currentTool: AnnotationTool.BLUR}), AnnotationTool.BLUR);
    assert.equal(resolveGestureTool({}), AnnotationTool.PEN);
});
