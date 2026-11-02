import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createPanel() {
    const source = fs.readFileSync(new URL('../src/ui/panel-indicator.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace('export class PanelIndicator', 'class PanelIndicator');
    let foreground = {red: 245, green: 245, blue: 250};
    const icons = [];
    const Gio = {
        File: {new_for_path: path => path},
        FileIcon: class {constructor({file}) {this.file = file;}},
    };
    const St = {
        Icon: class {constructor(opts) {Object.assign(this, opts); icons.push(this);}},
    };
    const Main = {panel: {get_theme_node: () => ({get_foreground_color: () => foreground})}};
    const PanelIndicator = vm.runInNewContext(`${source}\nPanelIndicator`, {Gio, St, Main});
    const panel = Object.create(PanelIndicator.prototype);
    panel._iconDir = '/tmp/zumi/icons';
    panel._icon = panel._createIcon(19, 'system-status-icon', 'zumi-panel-light.svg');
    return {panel, setForeground: color => {foreground = color;}, icons};
}

test('GNOME icon uses vector St.Icon at native size instead of low-resolution Cairo drawing', () => {
    const {panel, icons} = createPanel();
    assert.equal(icons[0].icon_size, 19);
    assert.equal(icons[0].gicon.file, '/tmp/zumi/icons/zumi-panel-light.svg');
    assert.equal(panel._createIcon(28, 'lumalens-menu-logo', 'zumi-menu.svg').gicon.file,
        '/tmp/zumi/icons/zumi-menu.svg');
});

test('GNOME panel chooses contrasting SVG on light and dark themes', () => {
    const {panel, setForeground} = createPanel();
    setForeground({red: 230, green: 240, blue: 255});
    panel._updatePanelIcon();
    assert.match(panel._icon.gicon.file, /zumi-panel-light\.svg$/);
    setForeground({red: 20, green: 35, blue: 55});
    panel._updatePanelIcon();
    assert.match(panel._icon.gicon.file, /zumi-panel-dark\.svg$/);
});

test('panel and menu icons use explicit colors and keep Beacon center visible', () => {
    for (const file of ['zumi-panel-light.svg', 'zumi-panel-dark.svg', 'zumi-menu.svg']) {
        const svg = fs.readFileSync(new URL(`../icons/${file}`, import.meta.url), 'utf8');
        assert.match(svg, /viewBox="0 0 24 24"/);
        assert.match(svg, /M12 8\.7 15\.3 12 12 15\.3 8\.7 12Z/);
        assert.doesNotMatch(svg, /currentColor|<filter|<image/);
    }
    const panelCode = fs.readFileSync(new URL('../src/ui/panel-indicator.js', import.meta.url), 'utf8');
    assert.doesNotMatch(panelCode, /Cairo|St\.DrawingArea/);
});
