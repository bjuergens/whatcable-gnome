import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WhatCablePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'drive-removable-media-usb-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Display',
            description: 'Choose what appears in the panel menu.',
        });
        page.add(group);

        const emptyPorts = new Adw.SwitchRow({
            title: 'Show empty USB-C ports',
            subtitle: 'List Type-C ports even when no device is connected.',
        });
        group.add(emptyPorts);
        settings.bind('show-empty-ports', emptyPorts, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const internalDevices = new Adw.SwitchRow({
            title: 'Show internal devices',
            subtitle: 'Include built-in (non-removable) USB devices like internal hubs and webcams.',
        });
        group.add(internalDevices);
        settings.bind('show-internal-devices', internalDevices, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const details = new Adw.SwitchRow({
            title: 'Show device details',
            subtitle: 'Expand raw fields (vendor IDs, bus/device, VDO-decoded partner/cable info) under each device.',
        });
        group.add(details);
        settings.bind('show-details', details, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const refreshGroup = new Adw.PreferencesGroup({
            title: 'Refresh',
            description: 'How often the panel icon polls sysfs while the menu is closed.',
        });
        page.add(refreshGroup);

        const refreshAdjustment = new Gtk.Adjustment({
            lower: 1, upper: 3600, step_increment: 1, page_increment: 5,
        });
        const refreshRow = new Adw.SpinRow({
            title: 'Status-bar refresh interval',
            subtitle: 'Seconds between icon updates (1–3600).',
            adjustment: refreshAdjustment,
        });
        refreshGroup.add(refreshRow);
        settings.bind('refresh-interval', refreshAdjustment, 'value',
            Gio.SettingsBindFlags.DEFAULT);

        window.add(page);
    }
}
