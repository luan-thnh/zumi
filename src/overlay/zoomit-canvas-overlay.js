// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {CanvasMode} from '../core/canvas-mode.js';
export {CanvasMode} from '../core/canvas-mode.js';

import {AnnotationController} from '../annotation/annotation-controller.js';
import {showOnTop} from '../core/actor-utils.js';
import {AnnotationTool, colorForKey, resolveGestureTool} from '../annotation/annotation-tools.js';
import {DrawingLayer} from '../annotation/drawing-layer.js';
import {ZoomViewport} from '../zoom/zoom-viewport.js';
import {StatusOsd} from './status-osd.js';

const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 48;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 96;

export class ZoomItCanvasOverlay {
    constructor({mode, capture = null, settings, monitorProvider = null, onClose, onAction = null}) {
        this._mode = mode;
        this._settings = settings;
        this._onClose = onClose;
        this._onAction = onAction;
        this._monitorProvider = monitorProvider;
        this._drawingMode = mode !== CanvasMode.STATIC_ZOOM;
        this._tabHeld = false;
        this._whiteboard = false;
        this._blackboard = false;
        this._cursor = global.get_pointer().slice(0, 2);
        this._typing = null;

        const defaultFactor = mode === CanvasMode.STATIC_ZOOM
            ? settings.get_double('default-zoom-factor')
            : 1;
        this._viewport = new ZoomViewport({
            factor: defaultFactor,
            step: settings.get_double('zoom-step'),
            min: 1,
            max: settings.get_double('max-zoom-factor'),
        });
        this._viewport.setAnchor(...this._cursor);

        this._annotation = new AnnotationController({onChanged: historyChanged => this._drawing?.queueRepaint(historyChanged)});
        this._annotation.setStyle({
            color: '#FF3B30',
            width: settings.get_double('annotation-width'),
            opacity: 1,
        });

        this.actor = new St.Widget({
            style_class: 'lumalens-canvas-overlay',
            reactive: true,
            can_focus: true,
            width: global.stage.width,
            height: global.stage.height,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });

        if (capture) {
            this._background = new Clutter.Actor({
                content: capture.content,
                content_gravity: Clutter.ContentGravity.RESIZE_FILL,
                reactive: false,
                width: global.stage.width,
                height: global.stage.height,
            });
            this._background.set_pivot_point(0, 0);
            this._renderedScale = 1;
            this._zoomAnimating = false;
            this._zoomToken = 0;
            this.actor.add_child(this._background);
        }

        this._board = new St.Widget({
            reactive: false,
            x_expand: true,
            y_expand: true,
            opacity: 0,
        });
        this.actor.add_child(this._board);

        this._drawing = new DrawingLayer({annotationController: this._annotation});
        this.actor.add_child(this._drawing.actor);

        // Use a real editable Clutter.Text through St.Entry. This lets GNOME's
        // input method handle IME/preedit, dead keys and Vietnamese text instead of
        // trying to reconstruct characters from raw key symbols.
        this._typingEntry = new St.Entry({
            style_class: 'lumalens-typing-entry',
            reactive: true,
            can_focus: true,
            visible: false,
            text: '',
        });
        this._typingText = this._typingEntry.get_clutter_text();
        this._typingText.set_editable(true);
        this._typingText.set_selectable(true);
        this._typingText.set_single_line_mode(false);
        this._typingText.set_line_wrap(true);
        this._typingText.set_activatable(false);
        this._typingText.set_cursor_visible(true);
        this.actor.add_child(this._typingEntry);

        this._osd = new StatusOsd({monitorProvider: this._monitorProvider});
        this._capturedId = this.actor.connect('captured-event', (_actor, event) => this._handleEvent(event));
    }

    get mode() {
        return this._mode;
    }

    show() {
        showOnTop(this.actor);
        this.actor.grab_key_focus();

        if (this._mode === CanvasMode.STATIC_ZOOM) {
            this._showInitialZoom();
            this._osd.show(`${this._viewport.factor.toFixed(2)}×`);
        } else if (this._mode === CanvasMode.DRAW) {
            this._osd.show('Draw');
        } else {
            this._osd.show('LiveDraw');
        }
    }

    hideStatus() {
        this._finishTyping(true);
        this._osd?.hide();
    }

    close() {
        this._finishTyping(true);
        this._onClose?.();
    }

    destroy() {
        if (this.actor && this._capturedId)
            this.actor.disconnect(this._capturedId);
        this._capturedId = 0;
        this._osd?.destroy();
        this._drawing?.destroy();
        this._annotation?.destroy();
        this.actor?.destroy();
        this.actor = null;
        this._osd = null;
        this._drawing = null;
        this._annotation = null;
        this._background = null;
        this._board = null;
        this._typingEntry = null;
        this._typingText = null;
        this._typing = null;
        this._settings = null;
        this._onClose = null;
        this._onAction = null;
        this._monitorProvider = null;
        this._viewport = null;
    }

    _handleEvent(event) {
        const type = event.type();

        // Let GNOME's input method deliver composition/preedit events directly to
        // the focused Clutter.Text. Swallowing these events breaks Vietnamese/IME.
        if (this._typing && [
            Clutter.EventType.IM_COMMIT,
            Clutter.EventType.IM_DELETE,
            Clutter.EventType.IM_PREEDIT,
            Clutter.EventType.KEY_STATE,
        ].includes(type))
            return Clutter.EVENT_PROPAGATE;

        if (type === Clutter.EventType.KEY_PRESS)
            return this._keyPress(event);
        if (type === Clutter.EventType.KEY_RELEASE)
            return this._keyRelease(event);

        if (type === Clutter.EventType.SCROLL)
            return this._scroll(event);

        if (type === Clutter.EventType.MOTION) {
            const [x, y] = event.get_coords();
            this._cursor = [x, y];
            if (this._annotation.drawing) {
                this._annotation.updateStroke(x, y);
            } else if (!this._drawingMode && this._mode === CanvasMode.STATIC_ZOOM) {
                // Pointer panning must be immediate. Animating every motion event is the
                // main source of the "rubber band" / delayed feeling in the old build.
                if (!this._zoomAnimating) {
                    this._viewport.setAnchor(x, y);
                    this._applyZoom(false);
                }
            }
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.BUTTON_PRESS)
            return this._buttonPress(event);

        if (type === Clutter.EventType.BUTTON_RELEASE && this._annotation.drawing) {
            const [x, y] = event.get_coords();
            this._annotation.endStroke(x, y);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    _scroll(event) {
        const direction = this._scrollDirection(event);
        if (!direction)
            return Clutter.EVENT_STOP;

        if (this._typing && event.has_control_modifier()) {
            this._changeFontSize(direction);
            return Clutter.EVENT_STOP;
        }

        if (this._drawingMode && event.has_control_modifier()) {
            this._changeStrokeWidth(direction);
            return Clutter.EVENT_STOP;
        }

        if (!this._drawingMode && this._mode === CanvasMode.STATIC_ZOOM) {
            this._zoom(direction);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    _buttonPress(event) {
        const button = event.get_button();

        if (button === Clutter.BUTTON_SECONDARY) {
            if (this._typing) {
                this._finishTyping(true);
                if (this._drawingMode && this._mode === CanvasMode.STATIC_ZOOM) {
                    this._drawingMode = false;
                    this._osd.show('Zoom');
                } else {
                    this.close();
                }
                return Clutter.EVENT_STOP;
            }
            if (this._drawingMode && this._mode === CanvasMode.STATIC_ZOOM) {
                this._drawingMode = false;
                this._annotation.cancelStroke();
                this._osd.show('Zoom');
            } else {
                this.close();
            }
            return Clutter.EVENT_STOP;
        }

        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_STOP;

        if (this._typing) {
            if (this._isTypingEditorEvent(event))
                return Clutter.EVENT_PROPAGATE;
            this._finishTyping(true);
            return Clutter.EVENT_STOP;
        }

        const [x, y] = event.get_coords();
        this._cursor = [x, y];

        if (!this._drawingMode && this._mode === CanvasMode.STATIC_ZOOM) {
            this._drawingMode = true;
            this._osd.show('Draw');
        }

        const tool = resolveGestureTool({
            shift: event.has_shift_modifier(),
            control: event.has_control_modifier(),
            tab: this._tabHeld,
            currentTool: this._annotation.tool,
        });
        this._annotation.beginStroke(x, y, {tool});
        return Clutter.EVENT_STOP;
    }

    _keyPress(event) {
        const key = event.get_key_symbol();

        if (this._typing)
            return this._typingKeyPress(event);

        if (key === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Tab) {
            this._tabHeld = true;
            return Clutter.EVENT_STOP;
        }

        // Keep the ZoomIt Ctrl+number commands available even while this full-screen
        // actor owns keyboard focus; Shell global bindings are not guaranteed to win
        // against a captured Clutter event.
        if (event.has_control_modifier()) {
            const shift = event.has_shift_modifier();
            const alt = this._hasAlt(event);
            if (key === Clutter.KEY_1) {
                this._dispatchAction('zoom-mode');
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_2) {
                this._dispatchAction('draw-mode');
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_3) {
                this._dispatchAction('break-timer');
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_4) {
                this._dispatchAction(shift ? 'live-draw' : 'live-zoom');
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_5) {
                this._dispatchAction(alt ? 'record-window' : shift ? 'record-region' : 'record-full');
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_6) {
                if (shift) {
                    this._dispatchAction('snip-save');
                } else if (this._clipboardShortcutsEnabled()) {
                    this._dispatchAction(alt ? 'snip-ocr' : 'snip-copy');
                } else {
                    this._osd.show('Enable clipboard shortcuts in Preferences', 1800);
                }
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_7) {
                this._dispatchAction(shift ? 'demo-type-previous' : 'demo-type');
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_8) {
                this._dispatchAction('panorama');
                return Clutter.EVENT_STOP;
            }
        }

        // Screenshot actions are valid while Zoom or Draw is active.
        if (event.has_control_modifier() && (key === Clutter.KEY_c || key === Clutter.KEY_C)) {
            if (this._clipboardShortcutsEnabled())
                this._dispatchAction(event.has_shift_modifier() ? 'crop-copy' : 'copy-screen');
            else
                this._osd.show('Enable clipboard shortcuts in Preferences', 1800);
            return Clutter.EVENT_STOP;
        }
        if (event.has_control_modifier() && (key === Clutter.KEY_s || key === Clutter.KEY_S)) {
            this._dispatchAction(event.has_shift_modifier() ? 'crop-save' : 'save-screen');
            return Clutter.EVENT_STOP;
        }

        if (!this._drawingMode && this._mode === CanvasMode.STATIC_ZOOM) {
            if (key === Clutter.KEY_Up)
                this._zoom(1);
            else if (key === Clutter.KEY_Down)
                this._zoom(-1);
            return Clutter.EVENT_STOP;
        }

        if (event.has_control_modifier() && (key === Clutter.KEY_z || key === Clutter.KEY_Z)) {
            if (event.has_shift_modifier())
                this._annotation.redo();
            else
                this._annotation.undo();
            return Clutter.EVENT_STOP;
        }
        if (event.has_control_modifier() && (key === Clutter.KEY_y || key === Clutter.KEY_Y)) {
            this._annotation.redo();
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Up || key === Clutter.KEY_Down) {
            this._changeStrokeWidth(key === Clutter.KEY_Up ? 1 : -1);
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_space) {
            this._centerCursor();
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_t || key === Clutter.KEY_T) {
            this._startTyping(event.has_shift_modifier() ? 'right' : 'left');
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_x || key === Clutter.KEY_X) {
            this._annotation.setTool(AnnotationTool.BLUR);
            this._annotation.setStyle({opacity: 1});
            this._osd.show('Blur');
            return Clutter.EVENT_STOP;
        }

        const keyName = this._colorKeyName(key);
        const color = colorForKey(keyName);
        if (color) {
            const highlighter = event.has_shift_modifier();
            this._annotation.setTool(highlighter ? AnnotationTool.HIGHLIGHTER : AnnotationTool.PEN);
            this._annotation.setStyle({color, opacity: highlighter ? 0.38 : 1});
            this._osd.show(`${highlighter ? 'Highlight' : 'Pen'} ${keyName.toUpperCase()}`);
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_e || key === Clutter.KEY_E) {
            this._annotation.clear();
            this._osd.show('Clear');
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_w || key === Clutter.KEY_W) {
            this._setBoard('white');
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_k || key === Clutter.KEY_K) {
            this._setBoard('black');
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    _keyRelease(event) {
        if (this._typing)
            return Clutter.EVENT_PROPAGATE;
        if (event.get_key_symbol() === Clutter.KEY_Tab)
            this._tabHeld = false;
        return Clutter.EVENT_STOP;
    }

    _isTypingEditorEvent(event) {
        try {
            const source = event.get_source();
            return Boolean(source && (source === this._typingEntry || this._typingEntry?.contains?.(source)));
        } catch (_error) {
            return false;
        }
    }

    _typingKeyPress(event) {
        const key = event.get_key_symbol();

        if (key === Clutter.KEY_Escape) {
            this._finishTyping(true);
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Up || key === Clutter.KEY_Down) {
            this._changeFontSize(key === Clutter.KEY_Up ? 1 : -1);
            return Clutter.EVENT_STOP;
        }

        // Keep ZoomIt mode shortcuts available while the text editor owns focus.
        if (event.has_control_modifier()) {
            const shift = event.has_shift_modifier();
            const alt = this._hasAlt(event);
            if (key === Clutter.KEY_1) this._dispatchAction('zoom-mode');
            else if (key === Clutter.KEY_2) this._dispatchAction('draw-mode');
            else if (key === Clutter.KEY_3) this._dispatchAction('break-timer');
            else if (key === Clutter.KEY_4) this._dispatchAction(shift ? 'live-draw' : 'live-zoom');
            else if (key === Clutter.KEY_5) this._dispatchAction(alt ? 'record-window' : shift ? 'record-region' : 'record-full');
            else if (key === Clutter.KEY_6) this._dispatchAction(alt ? 'snip-ocr' : shift ? 'snip-save' : 'snip-copy');
            else if (key === Clutter.KEY_7) this._dispatchAction(shift ? 'demo-type-previous' : 'demo-type');
            else if (key === Clutter.KEY_8) this._dispatchAction('panorama');
            else return Clutter.EVENT_PROPAGATE;
            return Clutter.EVENT_STOP;
        }

        // Printable keys, Backspace, Delete, Return and IME events must reach the
        // underlying Clutter.Text. The old manual keysym_to_unicode path swallowed
        // composition and was the reason T looked like it "did nothing" for many users.
        return Clutter.EVENT_PROPAGATE;
    }

    _startTyping(align) {
        const [cursorX, cursorY] = this._cursor;
        const margin = 18;
        const maxWidth = 720;
        const available = align === 'right'
            ? Math.max(160, cursorX - margin)
            : Math.max(160, global.stage.width - cursorX - margin);
        const width = Math.min(maxWidth, available);
        const x = align === 'right'
            ? Math.max(margin, cursorX - width)
            : Math.min(cursorX, global.stage.width - width - margin);
        const fontSize = this._settings.get_double('text-font-size');

        this._typing = {
            anchorX: cursorX,
            anchorY: cursorY,
            x,
            y: Math.max(margin, cursorY - fontSize),
            width,
            align,
            fontSize,
        };
        this._annotation.cancelStroke();
        this._typingEntry.set_text('');
        this._typingEntry.show();
        this._updateTypingEditor();
        this._typingText.set_cursor_position(-1);
        this._typingText.grab_key_focus();
        this._osd.show(align === 'right' ? 'Type · right aligned' : 'Type · left aligned');
    }

    _finishTyping(commit) {
        if (!this._typing)
            return;
        const draft = this._typing;
        const text = this._typingEntry?.get_text?.() ?? '';
        this._typing = null;
        this._typingEntry?.hide();
        if (commit) {
            this._annotation.addText({
                x: draft.anchorX,
                y: draft.anchorY,
                text,
                align: draft.align,
                fontSize: draft.fontSize,
            });
        }
        this.actor?.grab_key_focus();
    }

    _updateTypingEditor() {
        if (!this._typing || !this._typingEntry)
            return;

        const {x, y, width, align, fontSize} = this._typing;
        this._typingEntry.set_position(Math.round(x), Math.round(y));
        this._typingEntry.set_width(Math.round(width));
        this._typingEntry.set_style(
            `font-size: ${Math.round(fontSize)}px; color: ${this._annotation.style.color};`
        );
        this._typingText.set_line_alignment(
            align === 'right' ? Pango.Alignment.RIGHT : Pango.Alignment.LEFT
        );
    }

    _changeFontSize(direction) {
        if (!this._typing)
            return;
        this._typing.fontSize = Math.max(
            MIN_FONT_SIZE,
            Math.min(MAX_FONT_SIZE, this._typing.fontSize + direction * 2)
        );
        this._updateTypingEditor();
        this._osd.show(`${Math.round(this._typing.fontSize)}px`);
    }

    _zoom(direction) {
        if (direction > 0)
            this._viewport.zoomIn();
        else
            this._viewport.zoomOut();
        this._applyZoom(this._settings.get_boolean('smooth-zoom'));
        this._osd.show(`${this._viewport.factor.toFixed(2)}×`);
    }

    _showInitialZoom() {
        if (!this._background)
            return;
        if (!this._settings.get_boolean('animate-zoom')) {
            this._applyZoom(false);
            return;
        }

        this._background.translation_x = 0;
        this._background.translation_y = 0;
        this._background.set_scale(1, 1);
        this._renderedScale = 1;
        this._animateZoom(this._viewport.transform, 280);
    }

    _animateZoom(transform, duration) {
        const background = this._background;
        if (!background)
            return;
        const token = ++this._zoomToken;
        background.remove_all_transitions();
        this._zoomAnimating = true;
        this._renderedScale = null;
        background.ease({
            translation_x: transform.translationX,
            translation_y: transform.translationY,
            scale_x: transform.factor,
            scale_y: transform.factor,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: finished => {
                if (this._background !== background || token !== this._zoomToken)
                    return;
                this._zoomAnimating = false;
                if (finished)
                    this._renderedScale = transform.factor;
            },
        });
    }

    _applyZoom(animate) {
        if (!this._background)
            return;
        const transform = this._viewport.transform;
        if (animate) {
            this._animateZoom(transform, 180);
            return;
        }
        // Mouse panning remains immediate after the entry/step animation ends.
        if (this._zoomAnimating) {
            ++this._zoomToken;
            this._background.remove_all_transitions();
            this._zoomAnimating = false;
        }
        this._background.translation_x = transform.translationX;
        this._background.translation_y = transform.translationY;
        if (this._renderedScale !== transform.factor) {
            this._background.set_scale(transform.factor, transform.factor);
            this._renderedScale = transform.factor;
        }
    }

    _changeStrokeWidth(direction) {
        const current = this._annotation.style.width;
        const width = Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, current + direction));
        this._annotation.setStyle({width});
        this._osd.show(`${width}px`);
    }

    _centerCursor() {
        const x = Math.round(global.stage.width / 2);
        const y = Math.round(global.stage.height / 2);
        try {
            const seat = Clutter.get_default_backend().get_default_seat();
            if (typeof seat?.warp_pointer === 'function')
                seat.warp_pointer(x, y);
            this._cursor = [x, y];
            this._osd.show('Center');
        } catch (_error) {
            this._osd.show('Center unavailable');
        }
    }

    _dispatchAction(action) {
        this._finishTyping(true);
        this._osd.hide();
        this._onAction?.(action);
    }

    _scrollDirection(event) {
        const dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.UP)
            return 1;
        if (dir === Clutter.ScrollDirection.DOWN)
            return -1;
        if (dir === Clutter.ScrollDirection.SMOOTH && typeof event.get_scroll_delta === 'function') {
            const [, dy] = event.get_scroll_delta();
            if (dy < -0.05)
                return 1;
            if (dy > 0.05)
                return -1;
        }
        return 0;
    }

    _clipboardShortcutsEnabled() {
        return this._settings?.get_boolean('clipboard-shortcuts-enabled') ?? false;
    }

    _hasAlt(event) {
        try {
            return Boolean(event.get_state() & Clutter.ModifierType.MOD1_MASK);
        } catch (_error) {
            return false;
        }
    }

    _colorKeyName(key) {
        switch (key) {
        case Clutter.KEY_r:
        case Clutter.KEY_R: return 'r';
        case Clutter.KEY_g:
        case Clutter.KEY_G: return 'g';
        case Clutter.KEY_b:
        case Clutter.KEY_B: return 'b';
        case Clutter.KEY_y:
        case Clutter.KEY_Y: return 'y';
        case Clutter.KEY_o:
        case Clutter.KEY_O: return 'o';
        case Clutter.KEY_p:
        case Clutter.KEY_P: return 'p';
        default: return '';
        }
    }

    _setBoard(kind) {
        if (kind === 'white') {
            this._whiteboard = !this._whiteboard;
            this._blackboard = false;
            this._board.set_style(this._whiteboard ? 'background-color: white;' : '');
            this._board.opacity = this._whiteboard ? 255 : 0;
            this._osd.show(this._whiteboard ? 'Whiteboard' : 'Canvas');
        } else {
            this._blackboard = !this._blackboard;
            this._whiteboard = false;
            this._board.set_style(this._blackboard ? 'background-color: black;' : '');
            this._board.opacity = this._blackboard ? 255 : 0;
            this._osd.show(this._blackboard ? 'Blackboard' : 'Canvas');
        }
    }
}
