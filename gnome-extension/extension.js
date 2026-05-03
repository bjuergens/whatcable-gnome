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

// Bumped manually when a new upstream `whatcable-linux` release has been
// verified to work with this extension. Shown in the debug submenu so users
// can compare against the version they actually have installed.
const KNOWN_GOOD_CLI_VERSION = '0.1.1';

// Permissive shape check for one device entry from the CLI's --json output.
// Returns {ok: true, device} where `device` is a sanitized copy holding only
// well-typed fields (so a wrong-typed optional field degrades to "missing"
// rather than throwing in `_buildDeviceItem`), or {ok: false, summary} if the
// entry can't be rendered at all (no headline).
function validateDevice(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d))
        return {ok: false, summary: 'not an object'};
    if (typeof d.headline !== 'string' || d.headline.length === 0)
        return {ok: false, summary: 'missing headline'};

    const out = {headline: d.headline};

    if (typeof d.category === 'string') out.category = d.category;
    if (typeof d.subtitle === 'string') out.subtitle = d.subtitle;

    if (Array.isArray(d.bullets))
        out.bullets = d.bullets.filter(b => typeof b === 'string');

    if (d.typec && typeof d.typec === 'object' && !Array.isArray(d.typec)) {
        out.typec = {};
        if (typeof d.typec.connected === 'boolean')
            out.typec.connected = d.typec.connected;
    }

    if (d.usb && typeof d.usb === 'object' && !Array.isArray(d.usb)) {
        out.usb = {};
        if (typeof d.usb.removable === 'string')
            out.usb.removable = d.usb.removable;
    }

    if (d.charging && typeof d.charging === 'object' && !Array.isArray(d.charging)) {
        const c = {};
        if (typeof d.charging.summary === 'string') c.summary = d.charging.summary;
        if (typeof d.charging.isWarning === 'boolean') c.isWarning = d.charging.isWarning;
        if (typeof d.charging.detail === 'string') c.detail = d.charging.detail;
        if (c.summary) out.charging = c;
    }

    if (d.powerDelivery && typeof d.powerDelivery === 'object' &&
        Array.isArray(d.powerDelivery.sourceCapabilities)) {
        const pdos = d.powerDelivery.sourceCapabilities.filter(p =>
            p && typeof p === 'object' &&
            typeof p.voltageMV === 'number' &&
            typeof p.currentMA === 'number' &&
            typeof p.powerMW === 'number' &&
            typeof p.active === 'boolean');
        if (pdos.length > 0)
            out.powerDelivery = {sourceCapabilities: pdos};
    }

    return {ok: true, device: out};
}

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
    _init(extensionPath, settings) {
        super._init(0.0, 'WhatCable');
        this._disposed = false;
        this._inFlight = false;
        this._cancellable = new Gio.Cancellable();
        this._cliPath = findCliPath();
        this._buildTime = readBuildTime(extensionPath);
        this._cliVersion = null;
        this._lastRefreshTime = null;
        this._settings = settings;
        this._settingsChangedIds = [
            this._settings.connect('changed::show-empty-ports',
                () => this._rerenderDevices()),
            this._settings.connect('changed::show-internal-devices',
                () => this._rerenderDevices()),
        ];
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
        this._knownGoodItem = new PopupMenu.PopupMenuItem(
            `Known good whatcable-linux: ${KNOWN_GOOD_CLI_VERSION}`,
            {reactive: false});
        this._lastRefreshItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._showEmptyPortsItem = this._makeStickySwitch(
            'Show empty ports', this._settings.get_boolean('show-empty-ports'),
            state => this._settings.set_boolean('show-empty-ports', state));
        this._showInternalDevicesItem = this._makeStickySwitch(
            'Show internal devices', this._settings.get_boolean('show-internal-devices'),
            state => this._settings.set_boolean('show-internal-devices', state));
        // Keep the in-menu switches in sync with settings changes coming from
        // elsewhere (the prefs window, dconf, etc.).
        this._settingsChangedIds.push(
            this._settings.connect('changed::show-empty-ports', () => {
                this._showEmptyPortsItem.setToggleState(
                    this._settings.get_boolean('show-empty-ports'));
            }),
            this._settings.connect('changed::show-internal-devices', () => {
                this._showInternalDevicesItem.setToggleState(
                    this._settings.get_boolean('show-internal-devices'));
            }),
        );
        this._debugMenu.menu.addMenuItem(this._buildTimeItem);
        this._debugMenu.menu.addMenuItem(this._cliVersionItem);
        this._debugMenu.menu.addMenuItem(this._knownGoodItem);
        this._debugMenu.menu.addMenuItem(this._lastRefreshItem);
        this._debugMenu.menu.addMenuItem(this._showEmptyPortsItem);
        this._debugMenu.menu.addMenuItem(this._showInternalDevicesItem);
        this.menu.addMenuItem(this._debugMenu);
        this._updateDebugItems();
    }

    _updateDebugItems() {
        this._buildTimeItem.label.text =
            `Extension build: ${this._buildTime ?? 'unknown'}`;
        this._cliVersionItem.label.text =
            `Installed whatcable-linux: ${this._cliVersion ?? 'unknown'}`;
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
            let parsed;
            try {
                parsed = JSON.parse(stdout);
            } catch (e) {
                this._showError(`Failed to parse CLI output: ${e.message}`);
                return;
            }
            if (!Array.isArray(parsed)) {
                this._showError('CLI returned unexpected payload (not a JSON array). ' +
                    `Try a known-good whatcable-linux ≥ ${KNOWN_GOOD_CLI_VERSION}.`);
                return;
            }
            this._lastRefreshTime = new Date().toLocaleTimeString();
            this._updateDebugItems();
            this._showDevices(parsed);
        });
    }

    _showError(message) {
        this._countLabel.text = '';
        this._statusItem.label.text = message;
        this._devicesSection.removeAll();
        this._lastSignature = null;
    }

    _makeStickySwitch(label, initial, onToggled) {
        const item = new PopupMenu.PopupSwitchMenuItem(label, initial);
        // Override activate() so clicking the switch toggles state without
        // bubbling the activate signal up to the parent menu (which would close it).
        item.activate = function (_event) {
            if (this._switch.mapped)
                this.toggle();
        };
        item.connect('toggled', (_i, state) => onToggled(state));
        return item;
    }

    _rerenderDevices() {
        this._lastSignature = null;
        if (this._lastDevices)
            this._showDevices(this._lastDevices);
    }

    _showDevices(devices) {
        this._lastDevices = devices;

        const showEmptyPorts = this._settings.get_boolean('show-empty-ports');
        const showInternalDevices = this._settings.get_boolean('show-internal-devices');

        // Validate first, then filter. Invalid entries become warning rows so
        // a single malformed device never breaks the rest of the menu.
        const entries = devices.map(d => {
            const result = validateDevice(d);
            return result.ok ? {kind: 'ok', device: result.device}
                              : {kind: 'bad', summary: result.summary};
        }).filter(entry => {
            if (entry.kind !== 'ok') return true;
            const d = entry.device;
            if (!showEmptyPorts &&
                d.category === 'typec' && d.typec && !d.typec.connected)
                return false;
            if (!showInternalDevices &&
                d.category !== 'typec' && d.usb?.removable === 'fixed')
                return false;
            return true;
        });

        const signature = JSON.stringify(entries);
        if (signature === this._lastSignature)
            return;
        this._lastSignature = signature;

        const validCount = entries.filter(e => e.kind === 'ok').length;
        const badCount = entries.length - validCount;
        this._countLabel.text = validCount > 0 ? ` ${validCount}` : '';
        if (validCount === 0 && badCount === 0) {
            this._statusItem.label.text = 'No USB devices found';
        } else {
            const parts = [`${validCount} USB device${validCount === 1 ? '' : 's'}`];
            if (badCount > 0)
                parts.push(`${badCount} malformed`);
            this._statusItem.label.text = parts.join(', ');
        }

        this._devicesSection.removeAll();
        for (const entry of entries) {
            if (entry.kind === 'ok') {
                this._devicesSection.addMenuItem(this._buildDeviceItem(entry.device));
            } else {
                const item = new PopupMenu.PopupMenuItem(
                    `⚠ Malformed device entry (${entry.summary})`,
                    {reactive: false});
                item.label.style_class = 'whatcable-warning';
                this._devicesSection.addMenuItem(item);
            }
        }
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
        if (this._settings && this._settingsChangedIds) {
            for (const id of this._settingsChangedIds)
                this._settings.disconnect(id);
        }
        this._settingsChangedIds = null;
        this._settings = null;
        super.destroy();
    }
});

export default class WhatCableExtension extends Extension {
    enable() {
        this._indicator = new WhatCableIndicator(this.path, this.getSettings());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
