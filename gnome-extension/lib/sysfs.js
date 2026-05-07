// Async sysfs helpers.
//
// `/sys/class/typec` and `/sys/class/usb_power_delivery` are kernel-feature-
// gated and may legitimately not exist on a given system. We translate
// G_IO_ERROR_NOT_FOUND to null / [] so callers can treat absence as
// "feature absent". Any other IO error (permission denied, EIO, …) propagates
// — see AGENTS.md, "We fail first".

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');

const decoder = new TextDecoder();

function isNotFound(e) {
    return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
}

export async function readAttribute(path) {
    try {
        const [contents] = await Gio.File.new_for_path(path).load_contents_async(null);
        return decoder.decode(contents).trim();
    } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
    }
}

export async function readIntAttribute(path) {
    const val = await readAttribute(path);
    if (!val) return null;
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : null;
}

export async function readHexAttribute(path) {
    const val = await readAttribute(path);
    if (!val) return null;
    const stripped = val.startsWith('0x') || val.startsWith('0X') ? val.slice(2) : val;
    const n = parseInt(stripped, 16);
    return Number.isFinite(n) ? n >>> 0 : null;
}

async function* iterChildren(path) {
    let enumerator;
    try {
        enumerator = await Gio.File.new_for_path(path).enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT,
            null,
        );
    } catch (e) {
        if (isNotFound(e)) return;
        throw e;
    }
    while (true) {
        const batch = await enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, null);
        if (batch.length === 0) return;
        yield* batch;
    }
}

export async function listSubdirectories(path) {
    const out = [];
    for await (const info of iterChildren(path)) {
        if (info.get_file_type() === Gio.FileType.DIRECTORY || info.get_is_symlink())
            out.push(info.get_name());
    }
    return out.sort();
}

export async function listFiles(path) {
    const out = [];
    for await (const info of iterChildren(path)) {
        if (info.get_file_type() === Gio.FileType.REGULAR)
            out.push(info.get_name());
    }
    return out.sort();
}

export function pathExists(path) {
    return Gio.File.new_for_path(path).query_exists(null);
}

export function readSymlinkTargetBasename(path) {
    let info;
    try {
        info = Gio.File.new_for_path(path).query_info(
            'standard::is-symlink,standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null,
        );
    } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
    }
    if (!info.get_is_symlink()) return null;
    const target = info.get_symlink_target();
    if (!target) return null;
    return GLib.path_get_basename(target);
}
