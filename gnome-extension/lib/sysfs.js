// Async sysfs helpers. Mirrors src/core/SysfsReader.cpp from commit 5771e46.
// Treats missing/erroring paths as "absent" rather than throwing — sysfs trees
// like /sys/class/typec or /sys/class/usb_power_delivery are kernel-feature-
// gated and may not exist at all on a given system.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');

const decoder = new TextDecoder();

export async function readAttribute(path) {
    try {
        const file = Gio.File.new_for_path(path);
        const [contents] = await file.load_contents_async(null);
        return decoder.decode(contents).trim();
    } catch (_e) {
        return null;
    }
}

export async function readIntAttribute(path) {
    const val = await readAttribute(path);
    if (val === null || val === '') return null;
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : null;
}

export async function readHexAttribute(path) {
    const val = await readAttribute(path);
    if (val === null || val === '') return null;
    const stripped = val.startsWith('0x') || val.startsWith('0X') ? val.slice(2) : val;
    const n = parseInt(stripped, 16);
    if (!Number.isFinite(n)) return null;
    return n >>> 0;
}

export async function listSubdirectories(path) {
    try {
        const dir = Gio.File.new_for_path(path);
        const enumerator = await dir.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT,
            null,
        );
        const out = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const batch = await enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, null);
            if (batch.length === 0) break;
            for (const info of batch) {
                if (info.get_file_type() === Gio.FileType.DIRECTORY ||
                    info.get_is_symlink())
                    out.push(info.get_name());
            }
        }
        out.sort();
        return out;
    } catch (_e) {
        return [];
    }
}

export async function listFiles(path) {
    try {
        const dir = Gio.File.new_for_path(path);
        const enumerator = await dir.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT,
            null,
        );
        const out = [];
        while (true) {
            const batch = await enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, null);
            if (batch.length === 0) break;
            for (const info of batch) {
                if (info.get_file_type() === Gio.FileType.REGULAR)
                    out.push(info.get_name());
            }
        }
        out.sort();
        return out;
    } catch (_e) {
        return [];
    }
}

export function pathExists(path) {
    return Gio.File.new_for_path(path).query_exists(null);
}

export function readSymlinkTargetBasename(path) {
    try {
        const file = Gio.File.new_for_path(path);
        const info = file.query_info(
            'standard::is-symlink,standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null,
        );
        if (!info.get_is_symlink()) return null;
        const target = info.get_symlink_target();
        if (!target) return null;
        const idx = target.lastIndexOf('/');
        return idx >= 0 ? target.slice(idx + 1) : target;
    } catch (_e) {
        return null;
    }
}
