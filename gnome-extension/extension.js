// WhatCable GNOME Shell extension
// Top-bar indicator that shows a popup of every USB device on the system.
// Reads /sys/bus/usb/devices, /sys/class/typec, and /sys/class/usb_power_delivery
// directly via async Gio APIs (see lib/).

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {collectDevices} from './lib/device-manager.js';
import {sysfsToJson} from './lib/sysfsToJson.js';

function formatMilli(m) {
    return (m / 1000).toFixed(m % 1000 === 0 ? 0 : 1);
}

// Render one source-capability PDO row. Fixed PDOs read as a single voltage;
// Variable / PPS / Battery / AVS span a range, and AVS additionally splits
// current across the 9-15 V and 15-20 V segments — show both when present.
// `pdo.type` is the kernel enum ("fixed", "pps", …); the type label prefixes
// the row only when the shape is non-default — Fixed is the boring case and
// the "V @ A — W" syntax already conveys it.
function formatPdoRow(pdo) {
    const W = Math.round(pdo.powerMW / 1000);
    const Vmax = formatMilli(pdo.voltageMV);
    const A = formatMilli(pdo.currentMA);
    const hasMin = typeof pdo.minVoltageMV === 'number' && pdo.minVoltageMV > 0;
    const Vmin = hasMin ? formatMilli(pdo.minVoltageMV) : null;
    const label = pdo.type !== 'fixed' && pdo.typeLabel
        ? `${pdo.typeLabel}: ` : '';

    let body;
    if (pdo.type === 'battery') {
        body = hasMin ? `${Vmin}–${Vmax}V — ${W}W` : `${Vmax}V — ${W}W`;
    } else if (pdo.type === 'avs' &&
               typeof pdo.currentMA9to15 === 'number' && pdo.currentMA9to15 > 0 &&
               typeof pdo.currentMA15to20 === 'number' && pdo.currentMA15to20 > 0) {
        const a9 = formatMilli(pdo.currentMA9to15);
        const a20 = formatMilli(pdo.currentMA15to20);
        body = `9–15V @ ${a9}A · 15–20V @ ${a20}A — up to ${W}W`;
    } else if (hasMin && Vmin !== Vmax) {
        body = `${Vmin}–${Vmax}V @ ${A}A — ${W}W`;
    } else {
        body = `${Vmax}V @ ${A}A — ${W}W`;
    }

    const suffixes = [];
    if (typeof pdo.peakCurrentMA === 'number' && pdo.peakCurrentMA > pdo.currentMA)
        suffixes.push(`peak ${formatMilli(pdo.peakCurrentMA)}A`);
    if (pdo.ppsPowerLimited) suffixes.push('power-limited');

    return suffixes.length > 0
        ? `${label}${body} · ${suffixes.join(', ')}`
        : `${label}${body}`;
}

// camelCase / lowerCamel → "Title Case" for detail labels.
function humanizeKey(k) {
    return k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}

function formatInterface(i) {
    const cls = `0x${i.classCode.toString(16).padStart(2, '0')} ${i.classLabel}`;
    return i.driver ? `${cls} · ${i.driver}` : cls;
}

// Render a flat group of scalar key/values plus a few structured arrays we
// know how to format. Returns a list of strings; skipped fields stay hidden.
function detailLines(group, skipKeys = []) {
    const lines = [];
    for (const [k, v] of Object.entries(group)) {
        if (skipKeys.includes(k)) continue;
        if (v === null || v === undefined || v === '' || v === 0 || v === false)
            continue;
        if (Array.isArray(v)) {
            if (v.length === 0) continue;
            if (k === 'interfaces') {
                lines.push('Interfaces:');
                for (const iface of v) lines.push(`  ${formatInterface(iface)}`);
            }
            continue;
        }
        if (typeof v === 'object') continue;
        lines.push(`${humanizeKey(k)}: ${v}`);
    }
    return lines;
}

// Returns the buildinfo.json timestamp, or null when the file isn't there
// (pack/install setups that skip `make buildinfo`). Any other failure —
// permission denied, malformed JSON — propagates so it surfaces in the
// shell logs instead of silently rendering "unknown".
async function readBuildTime(extensionPath, cancellable) {
    const file = Gio.File.new_for_path(`${extensionPath}/buildinfo.json`);
    let contents;
    try {
        [contents] = await file.load_contents_async(cancellable);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return null;
        throw e;
    }
    return JSON.parse(new TextDecoder().decode(contents)).buildTime ?? null;
}

const WhatCableIndicator = GObject.registerClass(
class WhatCableIndicator extends PanelMenu.Button {
    _init(extensionPath, settings) {
        super._init(0.0, 'WhatCable');
        this._disposed = false;
        this._inFlight = false;
        this._cancellable = new Gio.Cancellable();
        this._buildTime = null;
        this._lastRefreshTime = null;
        this._settings = settings;
        this._settingsChangedIds = [];
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
        readBuildTime(extensionPath, this._cancellable).then(buildTime => {
            if (this._disposed) return;
            this._buildTime = buildTime;
            this._updateDebugItems();
        }).catch(e => {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
            console.warn(`WhatCable: failed to read buildinfo.json: ${e.message}`);
        });
        this._refresh();

        this._menuOpenStateId = this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refresh();
        });
    }

    _buildMenu() {
        this._headerItem = new PopupMenu.PopupMenuItem('WhatCable', {reactive: false});
        this._headerItem.label.style_class = 'whatcable-header';
        this.menu.addMenuItem(this._headerItem);

        // Refreshes happen on every menu open (see open-state-changed in
        // _init) and on a "no devices found" state we use _statusItem to
        // surface the empty-list hint. While there are devices we render
        // them directly and skip the count line.
        this._statusItem = new PopupMenu.PopupMenuItem('Loading…', {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this._devicesSection = new PopupMenu.PopupMenuSection();
        this._lastSignature = null;
        this.menu.addMenuItem(this._devicesSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._debugMenu = new PopupMenu.PopupSubMenuMenuItem('Options');
        this._buildTimeItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._lastRefreshItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._showEmptyPortsItem = this._bindStickySwitch(
            'Show empty ports', 'show-empty-ports');
        this._showInternalDevicesItem = this._bindStickySwitch(
            'Show internal devices', 'show-internal-devices');
        this._showDetailsItem = this._bindStickySwitch(
            'Show details', 'show-details');
        this._debugMenu.menu.addMenuItem(this._buildTimeItem);
        this._debugMenu.menu.addMenuItem(this._lastRefreshItem);
        this._debugMenu.menu.addMenuItem(this._showEmptyPortsItem);
        this._debugMenu.menu.addMenuItem(this._showInternalDevicesItem);
        this._debugMenu.menu.addMenuItem(this._showDetailsItem);

        this._debugMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Dump sysfs to log'));
        for (const [label, path] of [
            ['Dump /sys/class/typec', '/sys/class/typec'],
            ['Dump /sys/class/power_supply', '/sys/class/power_supply'],
            ['Dump /sys/class/usb_power_delivery', '/sys/class/usb_power_delivery'],
        ]) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._dumpSysfs(path));
            this._debugMenu.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(this._debugMenu);
        this._updateDebugItems();
    }

    _updateDebugItems() {
        this._buildTimeItem.label.text =
            `Extension build: ${this._buildTime ?? 'unknown'}`;
        this._lastRefreshItem.label.text =
            `Last refresh: ${this._lastRefreshTime ?? 'never'}`;
    }

    async _dumpSysfs(path) {
        try {
            const tree = await sysfsToJson(path);
            console.log(`WhatCable sysfs dump ${path}:\n${JSON.stringify(tree, null, 2)}`);
        } catch (e) {
            console.warn(`WhatCable sysfs dump ${path} failed: ${e.message}`);
        }
    }

    async _refresh() {
        if (this._disposed || this._inFlight) return;
        this._inFlight = true;
        try {
            const devices = await collectDevices();
            if (this._disposed) return;
            this._lastRefreshTime = new Date().toLocaleTimeString();
            this._updateDebugItems();
            this._showDevices(devices);
        } catch (e) {
            if (!this._disposed)
                this._showError(`Failed to read /sys: ${e.message}`);
        } finally {
            this._inFlight = false;
        }
    }

    _showError(message) {
        this._countLabel.text = '';
        this._statusItem.label.text = message;
        this._devicesSection.removeAll();
        this._lastSignature = null;
    }

    _bindStickySwitch(label, key) {
        const item = new PopupMenu.PopupSwitchMenuItem(
            label, this._settings.get_boolean(key));
        // Override activate() so clicking the switch toggles state without
        // bubbling the activate signal up to the parent menu (which would close it).
        item.activate = function (_event) {
            if (this._switch.mapped)
                this.toggle();
        };
        item.connect('toggled', (_i, state) => this._settings.set_boolean(key, state));
        // Two-way: external changes (prefs window, dconf) flow back into
        // the switch and trigger a re-render of the device list.
        this._settingsChangedIds.push(
            this._settings.connect(`changed::${key}`, () => {
                item.setToggleState(this._settings.get_boolean(key));
                this._rerenderDevices();
            }));
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

        const visible = devices.filter(d => {
            if (!showEmptyPorts &&
                d.category === 'typec' && !d.typec?.connected)
                return false;
            if (!showInternalDevices &&
                d.category !== 'typec' && d.usb?.removable === 'fixed')
                return false;
            return true;
        });

        const signature = JSON.stringify(visible);
        if (signature === this._lastSignature)
            return;
        this._lastSignature = signature;

        const count = visible.length;
        this._countLabel.text = count > 0 ? ` ${count}` : '';
        // Show the status row only on empty: with devices listed, "N USB
        // device(s)" duplicates what the user can already count.
        this._statusItem.label.text = 'No USB devices found';
        this._statusItem.actor.visible = count === 0;

        this._devicesSection.removeAll();
        for (const dev of visible)
            this._devicesSection.addMenuItem(this._buildDeviceItem(dev));
    }

    _buildDeviceItem(dev) {
        const item = new PopupMenu.PopupSubMenuMenuItem(dev.headline);
        // Pango markup is opt-in per device. device-summary uses it to color
        // pieces of the typec headline (charging-green wattage, warning-amber
        // name) without splitting the label into multiple actors.
        if (dev.headlineMarkup)
            item.label.clutter_text.set_use_markup(true);

        if (dev.subtitle) {
            const sub = new PopupMenu.PopupMenuItem(dev.subtitle, {reactive: false});
            item.menu.addMenuItem(sub);
        }

        for (const bullet of dev.bullets ?? []) {
            // Bullets can be plain strings or {text, class} for one-off
            // styling. With the no-custom-CSS approach we ignore any class
            // hint and just render the text.
            const text = typeof bullet === 'string' ? bullet : bullet.text;
            const b = new PopupMenu.PopupMenuItem(`• ${text}`, {reactive: false});
            item.menu.addMenuItem(b);
        }

        if (dev.charging?.summary) {
            const prefix = dev.charging.isWarning ? '⚠ ' : '✓ ';
            const c = new PopupMenu.PopupMenuItem(prefix + dev.charging.summary, {reactive: false});
            item.menu.addMenuItem(c);
            if (dev.charging.detail) {
                const d = new PopupMenu.PopupMenuItem(dev.charging.detail, {reactive: false});
                item.menu.addMenuItem(d);
            }
        }

        // Charger profiles main section: only the highest-power PDO and the
        // currently-negotiated PDO (if known). The rest move to Details.
        const pdos = dev.powerDelivery?.sourceCapabilities ?? [];
        const featured = new Set();
        if (pdos.length > 0) {
            const maxIdx = pdos.reduce(
                (m, p, i) => p.powerMW > pdos[m].powerMW ? i : m, 0);
            featured.add(maxIdx);
            pdos.forEach((p, i) => { if (p.active) featured.add(i); });

            pdos.forEach((pdo, i) => {
                if (!featured.has(i)) return;
                const marker = pdo.active && i === maxIdx ? '  ◀ active · max'
                    : pdo.active                          ? '  ◀ active'
                    : i === maxIdx                        ? '  ◀ max'
                    : '';
                const p = new PopupMenu.PopupMenuItem(
                    `• ${formatPdoRow(pdo)}${marker}`, {reactive: false});
                item.menu.addMenuItem(p);
            });
        }

        if (this._settings.get_boolean('show-details'))
            this._appendDetails(item, dev, pdos, featured);

        return item;
    }

    _appendDetails(parent, dev, pdos, featuredPdoIndices) {
        // Surface the structured groups produced by device-summary.js as an
        // inline "Details" section. Nested PopupSubMenuMenuItems don't survive
        // activate-bubbling inside another submenu, so render flat.
        const sections = [];
        if (dev.typec)         sections.push(['Type-C', dev.typec, ['port', 'connected']]);
        if (dev.usb)           sections.push(['USB', dev.usb, []]);
        if (dev.partner)       sections.push(['Partner', dev.partner, []]);
        if (dev.cable)         sections.push(['Cable', dev.cable, []]);
        if (dev.powerDelivery) sections.push(['Power Delivery', dev.powerDelivery, ['sourceCapabilities']]);

        const extraPdos = pdos.filter((_, i) => !featuredPdoIndices.has(i));

        if (sections.length === 0 && extraPdos.length === 0) return;

        parent.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Details'));

        const addLines = (header, lines) => {
            if (lines.length === 0) return;
            const h = new PopupMenu.PopupMenuItem(header, {reactive: false});
            parent.menu.addMenuItem(h);
            for (const line of lines) {
                const m = new PopupMenu.PopupMenuItem(`  ${line}`, {reactive: false});
                parent.menu.addMenuItem(m);
            }
        };

        for (const [name, data, skip] of sections)
            addLines(name, detailLines(data, skip));

        if (extraPdos.length > 0)
            addLines('Other charger profiles', extraPdos.map(formatPdoRow));
    }

    destroy() {
        this._disposed = true;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._menuOpenStateId) {
            this.menu.disconnect(this._menuOpenStateId);
            this._menuOpenStateId = null;
        }
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
