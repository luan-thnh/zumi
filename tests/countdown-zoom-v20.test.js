import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function classFromFile(path, symbol, mocks) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export \{[^\n]+\n/gm, '')
        .replace('export class ', 'class ');
    return vm.runInNewContext(`${source}\n${symbol}`, mocks);
}

function timerHarness() {
    const sources = new Map();
    const theme = {
        scheme: 'default',
        gtkTheme: 'Adwaita',
        listeners: new Map(),
        get_string(key) {
            if (key === 'color-scheme') return this.scheme;
            if (key === 'gtk-theme') return this.gtkTheme;
            throw new Error(`Unknown settings key: ${key}`);
        },
        connect(signal, cb) {
            assert.ok(['changed::color-scheme', 'changed::gtk-theme'].includes(signal));
            const id = this.listeners.size + 1;
            this.listeners.set(id, {signal, cb});
            return id;
        },
        disconnect(id) {this.listeners.delete(id);},
        setScheme(scheme) {
            this.scheme = scheme;
            for (const {signal, cb} of this.listeners.values())
                if (signal === 'changed::color-scheme') cb();
        },
        setGtkTheme(gtkTheme) {
            this.gtkTheme = gtkTheme;
            for (const {signal, cb} of this.listeners.values())
                if (signal === 'changed::gtk-theme') cb();
        },
    };
    let sourceId = 0;
    const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_CONTINUE: true,
        timeout_add_seconds(_priority, _interval, callback) {
            const id = ++sourceId;
            sources.set(id, callback);
            return id;
        },
        Source: {remove(id) {sources.delete(id);}},
        DateTime: {new_now_local: () => ({add_seconds: () => ({format: () => '12:34'})})},
    };
    class Widget {
        constructor(options = {}) {
            Object.assign(this, options);
            this.children = [];
            this.handlers = new Map();
            this.repaints = 0;
        }
        add_child(child) {this.children.push(child);}
        connect(name, callback) {this.handlers.set(name, callback); return this.handlers.size;}
        disconnect() {this.disconnected = true;}
        set_position(x, y) {this.position = [x, y];}
        set_accessible_name(name) {this.accessible_name = name;}
        grab_key_focus() {this.focused = true;}
        hide() {this.hidden = true;}
        show() {this.hidden = false;}
        destroy() {this.destroyed = true;}
        queue_repaint() {this.repaints++;}
        get_surface_size() {return [212, 212];}
        contains(child) {return this.children.includes(child);}
    }
    class Button extends Widget {
        click() {this.handlers.get('clicked')?.();}
    }
    const St = {
        Widget, BoxLayout: Widget, Button, Icon: Widget, Label: Widget, DrawingArea: Widget,
    };
    const Clutter = {
        ActorAlign: {CENTER: 0}, BinLayout: class {},
        EventType: {KEY_PRESS: 1, BUTTON_PRESS: 2, SCROLL: 3},
        EVENT_STOP: true, EVENT_PROPAGATE: false,
        KEY_space: 32, KEY_Escape: 27,
    };
    const BreakTimerOverlay = classFromFile('../src/timer/break-timer-overlay.js', 'BreakTimerOverlay', {
        Cairo: {LineCap: {ROUND: 1}}, Clutter, GLib, St, Gio: {Settings: class {constructor() {return theme;}}},
        showOnTop: actor => actor.show(),
        BreakTimerModel: classFromFile('../src/timer/timer-model.js', 'BreakTimerModel', {}),
        global: {stage: {width: 1920, height: 1080}},
    });
    return {BreakTimerOverlay, sources, theme};
}

test('larger blue timer paints progress only on ticks and cleans up', () => {
    const {BreakTimerOverlay, sources, theme} = timerHarness();
    let stopped = 0;
    const timer = new BreakTimerOverlay({
        minutes: 1, showEndTime: false,
        monitorProvider: () => ({x: 100, y: 50, width: 800, height: 600}),
        onClose: () => stopped++,
    });
    assert.equal(timer.actor.width, 312);
    assert.equal(timer.actor.height, 364);
    assert.deepEqual(timer.actor.position, [344, 168]);
    assert.equal(timer.actor.children.length, 2, 'only the ring and controls, not a fullscreen blocker');
    assert.match(timer.actor.style_class, /lumalens-break-card-light/);
    assert.match(timer.actor.style, /245, 249, 255/);
    timer.show();
    assert.equal(timer._label.text, '01:00');
    assert.equal(timer._endLabel.text, 'Remaining time');
    assert.equal(sources.size, 1);

    let disposed = false;
    const arcs = [];
    const colors = [];
    const cr = {
        setLineWidth() {}, setLineCap() {}, setSourceRGBA(...args) {colors.push(args);},
        arc(...args) {arcs.push(args);}, stroke() {},
        $dispose() {disposed = true;},
    };
    timer._paintRing({get_context: () => cr, get_surface_size: () => [212, 212]});
    assert.equal(arcs.length, 2, 'track and blue starting dot at elapsed = 0');
    assert.equal(disposed, true);
    const initialRepaints = timer._ringArea.repaints;
    for (let i = 0; i < 5; i++) [...sources.values()][0]();
    assert.equal(timer._label.text, '00:55');
    assert.equal(timer._ringArea.repaints - initialRepaints, 5);
    arcs.length = 0;
    timer._paintRing({get_context: () => cr, get_surface_size: () => [212, 212]});
    assert.equal(arcs.length, 2, 'blue arc appears once progress advances');
    assert.ok(colors.some(([r, g, b]) => r < 0.3 && g > 0.4 && b > 0.9), 'blue is the progress color');
    assert.ok(arcs[1][4] > arcs[1][3], 'arc grows clockwise');

    timer._pauseButton.click();
    assert.equal(timer.paused, true);
    assert.equal(timer._pauseButton.child.icon_name, 'media-playback-start-symbolic');
    [...sources.values()][0]();
    assert.equal(timer.remaining, 55);
    timer._resetButton.click();
    assert.equal(timer.remaining, 60);
    timer._stopButton.click();
    assert.equal(stopped, 1);
    const actor = timer.actor;
    timer.destroy();
    assert.equal(theme.listeners.size, 0, 'theme listener is disconnected on destroy');
    assert.equal(actor.destroyed, true);
    assert.equal(sources.size, 0);
});

test('timer follows GNOME light/dark preference live without a polling loop', () => {
    const {BreakTimerOverlay, sources, theme} = timerHarness();
    const timer = new BreakTimerOverlay({minutes: 5});
    assert.equal(sources.size, 0, 'theme tracking does not create a periodic timer');
    assert.match(timer.actor.style_class, /-light/);
    const initialRepaints = timer._ringArea.repaints;
    theme.setScheme('prefer-dark');
    assert.match(timer.actor.style_class, /-dark/);
    assert.match(timer.actor.style, /18, 25, 40/);
    assert.equal(timer._ringArea.repaints, initialRepaints + 1);
    const paints = [];
    timer._paintRing({
        get_surface_size: () => [212, 212],
        get_context: () => ({
            setLineWidth() {}, setLineCap() {}, arc() {}, stroke() {},
            setSourceRGBA(...args) {paints.push(args);}, $dispose() {},
        }),
    });
    assert.ok(paints[0][0] < 0.5, 'dark mode has a dim track instead of a white ring');
    theme.setScheme('default');
    assert.match(timer.actor.style_class, /-light/);
    assert.equal(sources.size, 0);
    timer.destroy();
    assert.equal(theme.listeners.size, 0);
});

test('zoom entry uses smooth cubic ease and stale completion cannot override a newer animation', () => {
    const Clutter = {AnimationMode: {EASE_OUT_CUBIC: 3}};
    const Overlay = classFromFile('../src/overlay/zoomit-canvas-overlay.js', 'ZoomItCanvasOverlay', {
        Clutter, St: {}, Pango: {}, CanvasMode: {}, AnnotationController: class {},
        showOnTop() {}, AnnotationTool: {}, colorForKey() {}, resolveGestureTool() {},
        DrawingLayer: class {}, ZoomViewport: class {}, StatusOsd: class {},
    });
    const animations = [];
    const background = {
        translation_x: 0, translation_y: 0,
        set_scale(x, y) {this.scale = [x, y];},
        remove_all_transitions() {this.removals = (this.removals || 0) + 1;},
        ease(options) {animations.push(options);},
    };
    const overlay = Object.create(Overlay.prototype);
    overlay._background = background;
    overlay._zoomToken = 0;
    overlay._renderedScale = 1;
    overlay._zoomAnimating = false;
    overlay._viewport = {transform: {factor: 2, translationX: -50, translationY: -80}};
    overlay._settings = {get_boolean: () => true};

    overlay._showInitialZoom();
    assert.equal(animations[0].duration, 280);
    assert.equal(animations[0].mode, Clutter.AnimationMode.EASE_OUT_CUBIC);
    assert.equal(overlay._zoomAnimating, true);
    overlay._applyZoom(true);
    assert.equal(animations[1].duration, 180);
    animations[0].onStopped(true);
    assert.equal(overlay._zoomAnimating, true, 'old animation cannot clear new animation state');
    animations[1].onStopped(true);
    assert.equal(overlay._zoomAnimating, false);
    assert.equal(overlay._renderedScale, 2);

    overlay._viewport.transform.factor = 2.5;
    overlay._applyZoom(true);
    overlay._applyZoom(false);
    assert.equal(overlay._zoomAnimating, false);
    assert.deepEqual(background.scale, [2.5, 2.5]);
    animations[2].onStopped(true);
    assert.equal(overlay._renderedScale, 2.5, 'cancelled easing callback cannot overwrite immediate pan');
});

test('smooth zoom is enabled by default and mouse motion respects an entry transition', () => {
    const schema = fs.readFileSync(new URL('../schemas/org.gnome.shell.extensions.lumalens.gschema.xml', import.meta.url), 'utf8');
    const overlay = fs.readFileSync(new URL('../src/overlay/zoomit-canvas-overlay.js', import.meta.url), 'utf8');
    const stylesheet = fs.readFileSync(new URL('../stylesheet.css', import.meta.url), 'utf8');
    assert.match(schema, /name="animate-zoom" type="b"><default>true<\/default>/);
    assert.match(schema, /name="smooth-zoom" type="b"><default>true<\/default>/);
    assert.match(schema, /name="break-show-end-time" type="b"><default>false<\/default>/);
    assert.match(overlay, /if \(!this\._zoomAnimating\) \{\s*this\._viewport\.setAnchor\(x, y\);\s*this\._applyZoom\(false\);/);
    assert.doesNotMatch(stylesheet, /\.lumalens-break-overlay/);
});

test('timer respects GTK dark theme fallback and explicit system preference changes', () => {
    const {BreakTimerOverlay, theme} = timerHarness();
    const timer = new BreakTimerOverlay({minutes: 5});
    assert.equal(theme.listeners.size, 2, 'both appearance keys are observed');
    theme.setGtkTheme('Adwaita-dark');
    assert.match(timer.actor.style_class, /lumalens-break-card-dark/);
    assert.match(timer.actor.style, /18, 25, 40/);
    theme.setScheme('prefer-light');
    assert.match(timer.actor.style_class, /lumalens-break-card-light/);
    theme.setScheme('prefer-dark');
    assert.match(timer.actor.style_class, /lumalens-break-card-dark/);
    theme.setScheme('default');
    assert.match(timer.actor.style_class, /lumalens-break-card-dark/);
    theme.setGtkTheme('Adwaita');
    assert.match(timer.actor.style_class, /lumalens-break-card-light/);
    timer.destroy();
    assert.equal(theme.listeners.size, 0);
});

test('timer draws a blue dot immediately and blue arc after expiry', () => {
    const {BreakTimerOverlay} = timerHarness();
    const timer = new BreakTimerOverlay({minutes: 1});
    const colors = [];
    const arcs = [];
    const paint = () => {
        colors.length = 0;
        arcs.length = 0;
        timer._paintRing({
            get_surface_size: () => [212, 212],
            get_context: () => ({
                setLineWidth() {}, setLineCap() {}, stroke() {},
                setSourceRGBA(...color) {colors.push(color);},
                arc(...a) {arcs.push(a);}, $dispose() {},
            }),
        });
        assert.equal(arcs.length, 2);
        assert.deepEqual(colors[1], [56 / 255, 122 / 255, 249 / 255, 1]);
    };
    paint();
    assert.ok(arcs[1][4] > arcs[1][3], 'starting dot is blue, not green');
    for (let i = 0; i < 65; i++) timer._model.tick();
    paint();
    assert.equal(timer._model.overtime, true);
    assert.ok(arcs[1][4] - arcs[1][3] > 6, 'progress remains a full blue circle');
    timer.destroy();
});

test('countdown typography stays within the center of a reduced ring', () => {
    const css = fs.readFileSync(new URL('../stylesheet.css', import.meta.url), 'utf8');
    assert.match(css, /\.lumalens-break-time\s*\{[^}]*font-size:\s*34px/s);
    assert.match(css, /\.lumalens-break-card-dark \.lumalens-break-time\s*\{\s*color:\s*#f2f6ff/);
    assert.match(css, /\.lumalens-timer-action-primary\s*\{[^}]*background-color:\s*#387af9/s);
});


test('explicit Countdown Dark/Light overrides GNOME fallback without polling', () => {
    const {BreakTimerOverlay, sources, theme} = timerHarness();
    const state = {
        appearance: 'auto', listeners: new Map(),
        get_string(key) {assert.equal(key, 'break-appearance'); return this.appearance;},
        connect(signal, cb) {assert.equal(signal, 'changed::break-appearance'); this.listeners.set(1, cb); return 1;},
        disconnect(id) {this.listeners.delete(id);},
        select(value) {this.appearance = value; this.listeners.get(1)?.();},
    };
    const timer = new BreakTimerOverlay({settings: state, appearance: 'auto'});
    assert.match(timer.actor.style_class, /-light/);
    state.select('dark');
    assert.match(timer.actor.style_class, /-dark/);
    assert.match(timer.actor.style, /18, 25, 40/);
    assert.match(timer._label.style, /#f5f8ff/);
    assert.match(timer._resetButton.style, /#2a3954/);
    assert.match(timer._pauseButton.style, /#387af9/);
    theme.setScheme('prefer-light');
    assert.match(timer.actor.style_class, /-dark/, 'manual Dark wins over GNOME Light');
    state.select('light');
    assert.match(timer.actor.style_class, /-light/);
    theme.setScheme('prefer-dark');
    assert.match(timer.actor.style_class, /-light/, 'manual Light wins over GNOME Dark');
    state.select('auto');
    assert.match(timer.actor.style_class, /-dark/, 'System follows GNOME again');
    assert.equal(sources.size, 0);
    timer.destroy();
    assert.equal(state.listeners.size, 0, 'settings signal cleaned up');
    assert.equal(theme.listeners.size, 0, 'appearance signal cleaned up');
});
