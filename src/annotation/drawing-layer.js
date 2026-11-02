// SPDX-License-Identifier: GPL-3.0-or-later

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {AnnotationTool} from './annotation-tools.js';

const FALLBACK_COLOR = [1, 0.23, 0.19, 1];
const ARROW_HEAD_LENGTH = 18;
const ARROW_HEAD_ANGLE = Math.PI / 7;

export class DrawingLayer {
    constructor({annotationController}) {
        this._annotationController = annotationController;
        this.actor = new St.Widget({
            reactive: false,
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._finished = new St.DrawingArea({
            reactive: false,
            x_expand: true,
            y_expand: true,
        });
        this._draft = new St.DrawingArea({
            reactive: false,
            x_expand: true,
            y_expand: true,
        });
        this.actor.add_child(this._finished);
        this.actor.add_child(this._draft);
        this._finishedId = this._finished.connect('repaint', area =>
            this._onRepaint(area, false));
        this._draftId = this._draft.connect('repaint', area =>
            this._onRepaint(area, true));
    }

    queueRepaint(historyChanged = false) {
        if (historyChanged)
            this._finished?.queue_repaint();
        this._draft?.queue_repaint();
    }

    destroy() {
        if (this._finished && this._finishedId)
            this._finished.disconnect(this._finishedId);
        if (this._draft && this._draftId)
            this._draft.disconnect(this._draftId);
        this._finishedId = 0;
        this._draftId = 0;
        this._finished = null;
        this._draft = null;
        this.actor = null;
        this._annotationController = null;
    }

    _onRepaint(area, draftOnly) {
        const cr = area.get_context();
        try {
            if (draftOnly) {
                const draft = this._annotationController.draftAnnotation;
                if (draft)
                    this._paintAnnotation(cr, draft);
            } else {
                for (const annotation of this._annotationController.committedAnnotations)
                    this._paintAnnotation(cr, annotation);
            }
        } finally {
            cr.$dispose();
        }
    }

    _applyStyle(cr, annotation) {
        const style = annotation.style ?? {color: '#FF3B30', width: 4, opacity: 1};
        const color = parseHexColor(style.color, style.opacity ?? 1);
        const width = annotation.type === AnnotationTool.HIGHLIGHTER
            ? Math.max(12, style.width * 3)
            : style.width;
        cr.setSourceRGBA(...color);
        cr.setLineWidth(width);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
    }

    _paintAnnotation(cr, annotation) {
        if (annotation.type === AnnotationTool.BLUR) {
            this._paintBlur(cr, annotation);
            return;
        }
        if (annotation.type === AnnotationTool.TEXT) {
            this._paintText(cr, annotation);
            return;
        }

        this._applyStyle(cr, annotation);
        switch (annotation.type) {
        case AnnotationTool.PEN:
        case AnnotationTool.HIGHLIGHTER:
            this._paintPen(cr, annotation);
            break;
        case AnnotationTool.LINE:
            this._paintLine(cr, annotation);
            break;
        case AnnotationTool.ARROW:
            this._paintArrow(cr, annotation);
            break;
        case AnnotationTool.RECTANGLE:
            this._paintRectangle(cr, annotation);
            break;
        case AnnotationTool.ELLIPSE:
            this._paintEllipse(cr, annotation);
            break;
        default:
            break;
        }
    }

    _paintPen(cr, annotation) {
        if (annotation.points.length < 2) return;
        cr.newPath();
        cr.moveTo(annotation.points[0].x, annotation.points[0].y);
        for (let index = 1; index < annotation.points.length; index++) {
            const point = annotation.points[index];
            cr.lineTo(point.x, point.y);
        }
        cr.stroke();
    }

    _paintBlur(cr, annotation) {
        const size = Math.max(18, (annotation.style?.width ?? 4) * 5);
        cr.save();
        for (let i = 0; i < annotation.points.length; i += 2) {
            const {x, y} = annotation.points[i];
            const half = size / 2;
            // A dense privacy mosaic is used here rather than a GPU blur mask.
            // It is deterministic, fast and still obscures text while drawing.
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    const light = (row + col + i) % 2 === 0 ? 0.16 : 0.28;
                    cr.setSourceRGBA(light, light, light, 0.88);
                    cr.rectangle(
                        x - half + col * size / 3,
                        y - half + row * size / 3,
                        size / 3 + 0.5,
                        size / 3 + 0.5
                    );
                    cr.fill();
                }
            }
        }
        cr.restore();
    }

    _paintText(cr, annotation) {
        this._applyStyle(cr, annotation);
        const fontSize = Math.max(10, annotation.fontSize ?? 28);
        cr.save();
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        cr.setFontSize(fontSize);
        const lines = annotation.text.split('\n');
        let y = annotation.y;
        for (const line of lines) {
            const extents = cr.textExtents(line);
            const x = annotation.align === 'right'
                ? annotation.x - extents.width
                : annotation.x;
            cr.moveTo(x, y);
            cr.showText(line);
            y += fontSize * 1.22;
        }
        cr.restore();
    }

    _paintLine(cr, annotation) {
        cr.newPath();
        cr.moveTo(annotation.x1, annotation.y1);
        cr.lineTo(annotation.x2, annotation.y2);
        cr.stroke();
    }

    _paintArrow(cr, annotation) {
        this._paintLine(cr, annotation);
        const angle = Math.atan2(annotation.y2 - annotation.y1, annotation.x2 - annotation.x1);
        const left = angle + Math.PI - ARROW_HEAD_ANGLE;
        const right = angle + Math.PI + ARROW_HEAD_ANGLE;
        const head = Math.max(ARROW_HEAD_LENGTH, (annotation.style?.width ?? 4) * 4);
        cr.newPath();
        cr.moveTo(annotation.x2, annotation.y2);
        cr.lineTo(annotation.x2 + head * Math.cos(left), annotation.y2 + head * Math.sin(left));
        cr.moveTo(annotation.x2, annotation.y2);
        cr.lineTo(annotation.x2 + head * Math.cos(right), annotation.y2 + head * Math.sin(right));
        cr.stroke();
    }

    _paintRectangle(cr, annotation) {
        const x = Math.min(annotation.x1, annotation.x2);
        const y = Math.min(annotation.y1, annotation.y2);
        const width = Math.abs(annotation.x2 - annotation.x1);
        const height = Math.abs(annotation.y2 - annotation.y1);
        cr.newPath();
        cr.rectangle(x, y, width, height);
        cr.stroke();
    }

    _paintEllipse(cr, annotation) {
        const x = Math.min(annotation.x1, annotation.x2);
        const y = Math.min(annotation.y1, annotation.y2);
        const width = Math.abs(annotation.x2 - annotation.x1);
        const height = Math.abs(annotation.y2 - annotation.y1);
        if (width <= 0 || height <= 0) return;
        cr.save();
        cr.translate(x + width / 2, y + height / 2);
        cr.scale(width / 2, height / 2);
        cr.newPath();
        cr.arc(0, 0, 1, 0, Math.PI * 2);
        cr.restore();
        cr.stroke();
    }
}

export function parseHexColor(value, opacity = 1) {
    const normalized = String(value ?? '').trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized))
        return [...FALLBACK_COLOR.slice(0, 3), opacity];
    return [
        Number.parseInt(normalized.slice(0, 2), 16) / 255,
        Number.parseInt(normalized.slice(2, 4), 16) / 255,
        Number.parseInt(normalized.slice(4, 6), 16) / 255,
        opacity,
    ];
}
