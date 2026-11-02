// SPDX-License-Identifier: GPL-3.0-or-later

import {AnnotationStore} from './annotation-store.js';
import {AnnotationTool, DEFAULT_ANNOTATION_TOOL, isAnnotationTool} from './annotation-tools.js';

const MIN_SHAPE_DISTANCE = 2;

export class AnnotationController {
    constructor({onChanged = null} = {}) {
        this._store = new AnnotationStore();
        this._tool = DEFAULT_ANNOTATION_TOOL;
        this._draft = null;
        this._onChanged = onChanged;
        this._style = Object.freeze({color: '#FF3B30', width: 4, opacity: 1});
    }

    get tool() { return this._tool; }
    get drawing() { return this._draft !== null; }
    get style() { return this._style; }
    get annotations() {
        return this._draft ? [...this._store.items, this._draft] : this._store.items;
    }
    get committedAnnotations() { return this._store.items; }
    get draftAnnotation() { return this._draft; }
    get canUndo() { return this._store.canUndo; }
    get canRedo() { return this._store.canRedo; }

    setTool(tool) {
        if (!isAnnotationTool(tool) || tool === this._tool)
            return false;
        this.cancelStroke();
        this._tool = tool;
        this._emitChanged();
        return true;
    }

    setStyle({color = this._style.color, width = this._style.width, opacity = this._style.opacity} = {}) {
        this._style = Object.freeze({color, width, opacity});
        this._emitChanged();
    }

    beginStroke(x, y, {tool = this._tool, style = this._style} = {}) {
        if (this._draft)
            this.cancelStroke();

        if (tool === AnnotationTool.TEXT)
            return false;

        if ([AnnotationTool.PEN, AnnotationTool.HIGHLIGHTER, AnnotationTool.BLUR].includes(tool)) {
            this._draft = {
                type: tool,
                style: {...style},
                points: [{x, y}],
            };
        } else {
            this._draft = {
                type: tool,
                style: {...style},
                x1: x,
                y1: y,
                x2: x,
                y2: y,
            };
        }
        this._emitChanged();
        return true;
    }

    updateStroke(x, y) {
        if (!this._draft)
            return;
        if ([AnnotationTool.PEN, AnnotationTool.HIGHLIGHTER, AnnotationTool.BLUR].includes(this._draft.type)) {
            const points = this._draft.points;
            const last = points[points.length - 1];
            const threshold = this._draft.type === AnnotationTool.BLUR ? 4 : 1;
            if ((x - last.x) ** 2 + (y - last.y) ** 2 < threshold ** 2)
                return;
            // Keep corners and curves, but omit nearly collinear samples.
            if (this._draft.type !== AnnotationTool.BLUR && points.length >= 2 &&
                this._canMergePoint(points[points.length - 2], last, x, y))
                points[points.length - 1] = {x, y};
            else
                points.push({x, y});
        } else {
            if (this._draft.x2 === x && this._draft.y2 === y)
                return;
            this._draft.x2 = x;
            this._draft.y2 = y;
        }
        this._emitChanged();
    }

    endStroke(x, y) {
        if (!this._draft)
            return false;
        this.updateStroke(x, y);
        const draft = this._draft;
        this._draft = null;
        if (!this._shouldCommit(draft)) {
            this._emitChanged();
            return false;
        }
        this._store.add(this._freezeAnnotation(draft));
        this._emitChanged(true);
        return true;
    }

    addText({x, y, text, align = 'left', fontSize = 28, style = this._style}) {
        const normalized = String(text ?? '').trimEnd();
        if (!normalized)
            return false;
        this.cancelStroke();
        this._store.add(Object.freeze({
            type: AnnotationTool.TEXT,
            x,
            y,
            text: normalized,
            align,
            fontSize,
            style: Object.freeze({...style}),
        }));
        this._emitChanged(true);
        return true;
    }

    cancelStroke() {
        if (!this._draft)
            return false;
        this._draft = null;
        this._emitChanged();
        return true;
    }

    undo() {
        this.cancelStroke();
        const changed = this._store.undo();
        if (changed) this._emitChanged(true);
        return changed;
    }

    redo() {
        this.cancelStroke();
        const changed = this._store.redo();
        if (changed) this._emitChanged(true);
        return changed;
    }

    clear() {
        this.cancelStroke();
        const changed = this._store.clear();
        if (changed) this._emitChanged(true);
        return changed;
    }

    destroy() {
        this._store.reset();
        this._store = null;
        this._draft = null;
        this._onChanged = null;
    }

    _shouldCommit(annotation) {
        if ([AnnotationTool.PEN, AnnotationTool.HIGHLIGHTER, AnnotationTool.BLUR].includes(annotation.type))
            return annotation.points.length >= 2;
        return Math.hypot(annotation.x2 - annotation.x1, annotation.y2 - annotation.y1) >= MIN_SHAPE_DISTANCE;
    }

    _canMergePoint(start, middle, x, y) {
        const dx = x - start.x;
        const dy = y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared === 0)
            return false;
        const mx = middle.x - start.x;
        const my = middle.y - start.y;
        const position = mx * dx + my * dy;
        if (position <= 0 || position >= lengthSquared)
            return false;
        const cross = mx * dy - my * dx;
        return cross * cross <= 0.25 * 0.25 * lengthSquared;
    }

    _freezeAnnotation(annotation) {
        const style = Object.freeze({...annotation.style});
        if ([AnnotationTool.PEN, AnnotationTool.HIGHLIGHTER, AnnotationTool.BLUR].includes(annotation.type)) {
            for (const point of annotation.points)
                Object.freeze(point);
            return Object.freeze({
                type: annotation.type,
                style,
                points: Object.freeze(annotation.points),
            });
        }
        return Object.freeze({...annotation, style});
    }

    _emitChanged(historyChanged = false) { this._onChanged?.(historyChanged); }
}
