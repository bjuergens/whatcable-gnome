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

const REFRESH_INTERVAL_SECONDS = 5;
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

function runCliAsync(cliPath, cancellable, callback) {
    let proc;
    try {
        proc = new Gio.Subprocess({
            argv: [cliPath, '--json'],
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
            const parsed = JSON.parse(stdout);
            callback(parsed, null);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            callback(null, e.message);
        }
    });
    return proc;
}

const WhatCableIndicator = GObject.registerClass(
class WhatCableIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'WhatCable');
        this._refreshTimerId = 0;
        this._disposed = false;
        this._inFlight = false;
        this._cancellable = new Gio.Cancellable();
        this._cliPath = findCliPath();

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
        this._refresh();
        this._scheduleRefresh();

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
        this._deviceItems = new Map();
        this._deviceOrder = [];
        this.menu.addMenuItem(this._devicesSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh');
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);
    }

    _scheduleRefresh() {
        this._refreshTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                if (this._disposed)
                    return GLib.SOURCE_REMOVE;
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            },
        );
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
        runCliAsync(this._cliPath, this._cancellable, (devices, error) => {
            this._inFlight = false;
            if (this._disposed)
                return;
            if (error) {
                this._showError(error);
                return;
            }
            this._showDevices(devices ?? []);
        });
    }

    _showError(message) {
        this._countLabel.text = '';
        this._statusItem.label.text = message;
        this._clearDevices();
    }

    _clearDevices() {
        this._devicesSection.removeAll();
        this._deviceItems.clear();
        this._deviceOrder = [];
    }

    _showDevices(devices) {
        const count = devices.length;
        this._countLabel.text = count > 0 ? ` ${count}` : '';
        this._statusItem.label.text = count === 0
            ? 'No USB devices found'
            : `${count} USB device${count === 1 ? '' : 's'}`;

        const newKeys = devices.map((d, i) => this._deviceKey(d, i));
        const orderChanged = newKeys.length !== this._deviceOrder.length ||
            newKeys.some((k, i) => k !== this._deviceOrder[i]);

        if (orderChanged) {
            this._clearDevices();
            for (let i = 0; i < devices.length; i++) {
                const item = this._buildDeviceItem(devices[i]);
                item._whatcableSig = this._deviceSignature(devices[i]);
                this._devicesSection.addMenuItem(item);
                this._deviceItems.set(newKeys[i], item);
            }
            this._deviceOrder = newKeys;
            return;
        }

        for (let i = 0; i < devices.length; i++) {
            const item = this._deviceItems.get(newKeys[i]);
            const sig = this._deviceSignature(devices[i]);
            if (item._whatcableSig !== sig) {
                this._populateDeviceItem(item, devices[i]);
                item._whatcableSig = sig;
            }
        }
    }

    _deviceKey(dev, index) {
        if (dev.usb && dev.usb.bus != null && dev.usb.device != null)
            return `usb:${dev.usb.bus}:${dev.usb.device}`;
        if (dev.typec && dev.typec.port != null)
            return `typec:${dev.typec.port}`;
        return `idx:${index}:${dev.headline ?? ''}`;
    }

    _deviceSignature(dev) {
        return JSON.stringify(dev);
    }

    _buildDeviceItem(dev) {
        const item = new PopupMenu.PopupSubMenuMenuItem(dev.headline ?? 'USB device');
        this._populateDeviceItem(item, dev);
        return item;
    }

    _populateDeviceItem(item, dev) {
        item.label.text = dev.headline ?? 'USB device';
        item.menu.removeAll();

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
    }

    destroy() {
        this._disposed = true;
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
        super.destroy();
    }
});

export default class WhatCableExtension extends Extension {
    enable() {
        this._indicator = new WhatCableIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
