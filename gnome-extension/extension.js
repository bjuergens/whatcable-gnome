// WhatCable GNOME Shell extension
// Top-bar indicator that shows a popup of every USB device on the system,
// using the `whatcable-linux --json` CLI.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CLI_CANDIDATES = [
    'whatcable-linux',
    '/usr/local/bin/whatcable-linux',
    '/usr/bin/whatcable-linux',
];

function findCliPath() {
    for (const candidate of CLI_CANDIDATES) {
        if (candidate.startsWith('/')) {
            if (GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE))
                return candidate;
        } else {
            const resolved = GLib.find_program_in_path(candidate);
            if (resolved)
                return resolved;
        }
    }
    return null;
}

function runCliAsync(cliPath, args, cancellable, callback) {
    let proc;
    try {
        proc = new Gio.Subprocess({
            argv: [cliPath, ...args],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(cancellable);
    } catch (e) {
        callback(null, `Failed to launch ${cliPath}: ${e.message}`);
        return null;
    }

    proc.communicate_utf8_async(null, cancellable, (p, res) => {
        try {
            const [, stdout, stderr] = p.communicate_utf8_finish(res);
            if (!p.get_successful()) {
                callback(null, stderr?.trim() || 'CLI exited with non-zero status');
                return;
            }
            callback(stdout, null);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            callback(null, e.message);
        }
    });
    return proc;
}

function readBuildTime(extensionPath) {
    try {
        const file = Gio.File.new_for_path(`${extensionPath}/buildinfo.json`);
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return null;
        const decoder = new TextDecoder();
        const parsed = JSON.parse(decoder.decode(contents));
        return parsed.buildTime ?? null;
    } catch (_e) {
        return null;
    }
}

const WhatCableIndicator = GObject.registerClass(
class WhatCableIndicator extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.0, 'WhatCable');
        this._disposed = false;
        this._inFlight = false;
        this._cancellable = new Gio.Cancellable();
        this._cliPath = findCliPath();
        this._buildTime = readBuildTime(extensionPath);
        this._cliVersion = null;
        this._lastRefreshTime = null;
        this._showEmptyPorts = false;
        this._lastDevices = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            icon_name: 'drive-removable-media-usb-symbolic',
            style_class: 'system-status-icon',
        });
        this._countLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'whatcable-count',
        });
        box.add_child(this._icon);
        box.add_child(this._countLabel);
        this.add_child(box);

        this._buildMenu();
        this._fetchCliVersion();
        this._refresh();

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refresh();
        });
    }

    _buildMenu() {
        this._headerItem = new PopupMenu.PopupMenuItem('WhatCable', {reactive: false});
        this._headerItem.label.style_class = 'whatcable-header';
        this.menu.addMenuItem(this._headerItem);

        this._statusItem = new PopupMenu.PopupMenuItem('Loading…', {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._devicesSection = new PopupMenu.PopupMenuSection();
        this._lastSignature = null;
        this.menu.addMenuItem(this._devicesSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh');
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        this._debugMenu = new PopupMenu.PopupSubMenuMenuItem('Debug info');
        this._buildTimeItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._cliVersionItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._lastRefreshItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._showEmptyPortsItem = new PopupMenu.PopupSwitchMenuItem(
            'Show empty ports', this._showEmptyPorts);
        this._showEmptyPortsItem.connect('toggled', (_item, state) => {
            this._showEmptyPorts = state;
            this._lastSignature = null;
            if (this._lastDevices)
                this._showDevices(this._lastDevices);
        });
        this._debugMenu.menu.addMenuItem(this._buildTimeItem);
        this._debugMenu.menu.addMenuItem(this._cliVersionItem);
        this._debugMenu.menu.addMenuItem(this._lastRefreshItem);
        this._debugMenu.menu.addMenuItem(this._showEmptyPortsItem);
        this.menu.addMenuItem(this._debugMenu);
        this._updateDebugItems();
    }

    _updateDebugItems() {
        this._buildTimeItem.label.text =
            `Extension build: ${this._buildTime ?? 'unknown'}`;
        this._cliVersionItem.label.text =
            `whatcable-linux: ${this._cliVersion ?? 'unknown'}`;
        this._lastRefreshItem.label.text =
            `Last refresh: ${this._lastRefreshTime ?? 'never'}`;
    }

    _fetchCliVersion() {
        if (!this._cliPath) {
            this._cliVersion = 'CLI not found';
            this._updateDebugItems();
            return;
        }
        runCliAsync(this._cliPath, ['--version'], this._cancellable, (stdout, error) => {
            if (this._disposed)
                return;
            this._cliVersion = error ? `error: ${error}` : (stdout?.trim() || 'unknown');
            this._updateDebugItems();
        });
    }

    _refresh() {
        if (this._disposed || this._inFlight)
            return;
        if (!this._cliPath) {
            this._showError(
                'whatcable-linux CLI not found.\n' +
                'Install it to /usr/local/bin or your PATH.',
            );
            return;
        }
        this._inFlight = true;
        runCliAsync(this._cliPath, ['--json'], this._cancellable, (stdout, error) => {
            this._inFlight = false;
            if (this._disposed)
                return;
            if (error) {
                this._showError(error);
                return;
            }
            let devices;
            try {
                devices = JSON.parse(stdout);
            } catch (e) {
                this._showError(`Failed to parse CLI output: ${e.message}`);
                return;
            }
            this._lastRefreshTime = new Date().toLocaleTimeString();
            this._updateDebugItems();
            this._showDevices(devices ?? []);
        });
    }

    _showError(message) {
        this._countLabel.text = '';
        this._statusItem.label.text = message;
        this._devicesSection.removeAll();
        this._lastSignature = null;
    }

    _showDevices(devices) {
        this._lastDevices = devices;
        const filtered = this._showEmptyPorts
            ? devices
            : devices.filter(d => !(d.category === 'typec' && d.typec && !d.typec.connected));

        const signature = JSON.stringify(filtered);
        if (signature === this._lastSignature)
            return;
        this._lastSignature = signature;

        const count = filtered.length;
        this._countLabel.text = count > 0 ? ` ${count}` : '';
        this._statusItem.label.text = count === 0
            ? 'No USB devices found'
            : `${count} USB device${count === 1 ? '' : 's'}`;

        this._devicesSection.removeAll();
        for (const dev of filtered)
            this._devicesSection.addMenuItem(this._buildDeviceItem(dev));
    }

    _buildDeviceItem(dev) {
        const item = new PopupMenu.PopupSubMenuMenuItem(dev.headline ?? 'USB device');

        if (dev.subtitle) {
            const sub = new PopupMenu.PopupMenuItem(dev.subtitle, {reactive: false});
            sub.label.style_class = 'whatcable-subtitle';
            item.menu.addMenuItem(sub);
        }

        for (const bullet of dev.bullets ?? []) {
            const b = new PopupMenu.PopupMenuItem(`• ${bullet}`, {reactive: false});
            b.label.style_class = 'whatcable-bullet';
            item.menu.addMenuItem(b);
        }

        if (dev.charging?.summary) {
            const prefix = dev.charging.isWarning ? '⚠ ' : '✓ ';
            const c = new PopupMenu.PopupMenuItem(prefix + dev.charging.summary, {reactive: false});
            c.label.style_class = dev.charging.isWarning
                ? 'whatcable-warning'
                : 'whatcable-ok';
            item.menu.addMenuItem(c);
            if (dev.charging.detail) {
                const d = new PopupMenu.PopupMenuItem(dev.charging.detail, {reactive: false});
                d.label.style_class = 'whatcable-detail';
                item.menu.addMenuItem(d);
            }
        }

        const pdos = dev.powerDelivery?.sourceCapabilities ?? [];
        if (pdos.length > 0) {
            item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Charger profiles'));
            for (const pdo of pdos) {
                const v = (pdo.voltageMV / 1000).toFixed(pdo.voltageMV % 1000 === 0 ? 0 : 1);
                const a = (pdo.currentMA / 1000).toFixed(pdo.currentMA % 1000 === 0 ? 0 : 1);
                const w = Math.round(pdo.powerMW / 1000);
                const marker = pdo.active ? '  ◀ active' : '';
                const text = `${v}V @ ${a}A — ${w}W${marker}`;
                const p = new PopupMenu.PopupMenuItem(text, {reactive: false});
                p.label.style_class = pdo.active ? 'whatcable-ok' : 'whatcable-bullet';
                item.menu.addMenuItem(p);
            }
        }

        return item;
    }

    destroy() {
        this._disposed = true;
        this._cancellable?.cancel();
        this._cancellable = null;
        super.destroy();
    }
});

export default class WhatCableExtension extends Extension {
    enable() {
        this._indicator = new WhatCableIndicator(this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
