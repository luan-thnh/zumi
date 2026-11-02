// SPDX-License-Identifier: GPL-3.0-or-later

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {showOnTop} from '../core/actor-utils.js';
import {stageOcrRects} from './ocr-result.js';

/** Keep the selection on screen while recognizing, then highlight words in place. */
export class OcrResultOverlay {
    constructor({rect, onCopy, onClose}) {
        this._rect = rect;
        this._words = [];
        this._text = '';
        this._onClose = onClose;
        this._onCopy = onCopy;
        this.actor = new St.Widget({
            style_class: 'zumi-ocr-overlay',
            reactive: true,
            can_focus: true,
            width: global.stage.width,
            height: global.stage.height,
        });
        this._canvas = new St.DrawingArea({width: global.stage.width,
            height: global.stage.height});
        this.actor.add_child(this._canvas);
        this._paintId = this._canvas.connect('repaint', area => this._paint(area));
        this._keyId = this.actor.connect('captured-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.KEY_PRESS &&
                event.get_key_symbol() === Clutter.KEY_Escape) {
                this._onClose?.();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._toolbar = new St.BoxLayout({style_class: 'zumi-ocr-toolbar'});
        this._busyIcon = new St.Icon({icon_name: 'process-working-symbolic',
            icon_size: 16, style_class: 'zumi-ocr-busy'});
        this._toolbar.add_child(this._busyIcon);
        this._label = new St.Label({text: 'Đang nhận dạng tiếng Việt…',
            style_class: 'zumi-ocr-label', y_align: Clutter.ActorAlign.CENTER});
        this._toolbar.add_child(this._label);
        this._copy = new St.Button({label: 'Copy All',
            style_class: 'zumi-ocr-copy', can_focus: true, reactive: true});
        this._copy.connect('clicked', () => {
            if (!this._text) return;
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._text);
            this._onCopy?.();
        });
        this._copy.hide();
        this._toolbar.add_child(this._copy);
        const close = new St.Button({label: '✕', style_class: 'zumi-ocr-close',
            can_focus: true, reactive: true});
        close.connect('clicked', () => this._onClose?.());
        this._toolbar.add_child(close);
        // Use stage coordinates: keep the toolbar on screen even for a bottom-edge selection.
        const panelWidth = Math.min(350, Math.max(180, global.stage.width - 20));
        this._toolbar.set_width(panelWidth);
        this._toolbar.set_position(
            Math.min(Math.max(10, rect.x), Math.max(10, global.stage.width - panelWidth - 10)),
            rect.y >= 58 ? rect.y - 50 : Math.min(global.stage.height - 48, rect.y + rect.height + 10));
        this.actor.add_child(this._toolbar);
    }

    show() {
        showOnTop(this.actor);
        this.actor.grab_key_focus();
    }

    showResult(result) {
        if (!this.actor) return;
        this._busyIcon.hide();
        this._text = result.text;
        this._words = stageOcrRects(result, this._rect);
        this._label.set_text(result.text ? `${this._words.length} từ đã nhận dạng` : 'Không tìm thấy văn bản');
        if (result.text) this._copy.show();
        this._canvas.queue_repaint();
    }

    showError(message) {
        if (!this.actor) return;
        this._busyIcon.hide();
        this._label.set_text(message);
    }

    destroy() {
        if (!this.actor) return;
        this._canvas.disconnect(this._paintId);
        this.actor.disconnect(this._keyId);
        this.actor.destroy();
        this.actor = null;
        this._canvas = null;
        this._toolbar = null;
        this._label = null;
        this._busyIcon = null;
        this._copy = null;
        this._words = [];
        this._onCopy = null;
        this._onClose = null;
    }

    _paint(area) {
        const cr = area.get_context();
        try {
            const rect = this._rect;
            cr.setSourceRGBA(0, 0, 0, 0.42);
            cr.paint();
            cr.save();
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.rectangle(rect.x, rect.y, rect.width, rect.height);
            cr.fill();
            cr.restore();
            cr.setLineWidth(2);
            cr.setSourceRGBA(0.22, 0.48, 0.98, 0.95);
            cr.rectangle(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2),
                Math.max(0, rect.height - 2));
            cr.stroke();
            // Word highlights are one Cairo surface, not one GNOME actor per word.
            for (const word of this._words) {
                cr.setSourceRGBA(0.22, 0.48, 0.98, 0.25);
                cr.rectangle(word.x, word.y, word.width, word.height);
                cr.fill();
                cr.setSourceRGBA(0.22, 0.48, 0.98, 0.8);
                cr.rectangle(word.x, word.y, word.width, word.height);
                cr.stroke();
            }
        } finally {
            cr.$dispose();
        }
    }
}
