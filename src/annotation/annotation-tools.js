// SPDX-License-Identifier: GPL-3.0-or-later

export const AnnotationTool = Object.freeze({
    PEN: 'pen',
    HIGHLIGHTER: 'highlighter',
    BLUR: 'blur',
    LINE: 'line',
    RECTANGLE: 'rectangle',
    ELLIPSE: 'ellipse',
    ARROW: 'arrow',
    TEXT: 'text',
});

export const DEFAULT_ANNOTATION_TOOL = AnnotationTool.PEN;

export const ZOOMIT_COLORS = Object.freeze({
    red: '#FF3B30',
    green: '#34C759',
    blue: '#0A84FF',
    yellow: '#FFD60A',
    orange: '#FF9F0A',
    pink: '#FF2D92',
});

export function isAnnotationTool(value) {
    return Object.values(AnnotationTool).includes(value);
}

export function colorForKey(key) {
    const map = {
        r: ZOOMIT_COLORS.red,
        g: ZOOMIT_COLORS.green,
        b: ZOOMIT_COLORS.blue,
        y: ZOOMIT_COLORS.yellow,
        o: ZOOMIT_COLORS.orange,
        p: ZOOMIT_COLORS.pink,
    };
    return map[String(key).toLowerCase()] ?? null;
}

export function resolveGestureTool({shift = false, control = false, tab = false, currentTool = AnnotationTool.PEN} = {}) {
    if (control && shift)
        return AnnotationTool.ARROW;
    if (control)
        return AnnotationTool.RECTANGLE;
    if (tab)
        return AnnotationTool.ELLIPSE;
    if (shift)
        return AnnotationTool.LINE;
    return currentTool;
}
