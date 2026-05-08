// sysfsToJson.js
//
// Recursively maps a sysfs directory tree to a plain JS object / JSON.
//
// Files     → trimmed string value, or { _error, _path, _reason } sentinel
//             when unreadable (write-only, binary, EIO, etc.).
// Dirs      → nested object, one key per child.
// Symlinks  → { _symlink: '<basename>' } leaf (or `_symlink: null` if the
//             target couldn't be resolved). We deliberately do NOT recurse
//             into symlinks: /sys is a graph reified as a tree and following
//             links blows up size and risks cycles. The basename of the
//             symlink target is enough for the things sysfs links express
//             (e.g. typec/portN/usb_power_delivery → sourceN, iface/driver →
//             usbhid, pd-class-entry/device → port0-partner).
//
// Cost model: `load_contents_async` (one open/read/close per regular file)
// dominates. Sysfs has thousands of files most callers don't read — pass
// `{files}` (Set or predicate) to bound that work; unmatched files are
// omitted from the output. Directories are always traversed (enumerate is
// cheap, one syscall per dir) and symlinks are always recorded.
//
// `sysfsToJson(root)` returns an *array* — one element per immediate child
// of `root`. Each element has a `_name` property and, when the entry was
// itself a symlink, `_symlinkTarget` with the basename of where it pointed.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');

const decoder = new TextDecoder();
const MAX_DEPTH = 8;
const ATTRS = 'standard::name,standard::type,standard::is-symlink,standard::symlink-target';

async function* _iterChildren(path) {
    let enumerator;
    try {
        enumerator = await Gio.File.new_for_path(path).enumerate_children_async(
            ATTRS,
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT,
            null,
        );
    } catch {
        return;
    }
    while (true) {
        const batch = await enumerator.next_files_async(64, GLib.PRIORITY_DEFAULT, null);
        if (batch.length === 0) return;
        yield* batch;
    }
}

async function _readFile(path) {
    try {
        const [contents] = await Gio.File.new_for_path(path).load_contents_async(null);
        return decoder.decode(contents).trim();
    } catch (e) {
        return {
            _error: 'unreadable',
            _path: path,
            _reason: e.message ?? String(e),
        };
    }
}

function _symlinkBasename(info) {
    const target = info.get_symlink_target();
    return target ? GLib.path_get_basename(target) : null;
}

async function _dirToObject(path, depth, allowFile) {
    if (depth > MAX_DEPTH) return { _error: 'max_depth_exceeded', _path: path };

    const obj = {};
    for await (const info of _iterChildren(path)) {
        const name = info.get_name();
        const isSymlink = info.get_is_symlink();
        const type = info.get_file_type();

        if (isSymlink) {
            obj[name] = { _symlink: _symlinkBasename(info) };
        } else if (type === Gio.FileType.DIRECTORY) {
            obj[name] = await _dirToObject(`${path}/${name}`, depth + 1, allowFile);
        } else if (type === Gio.FileType.REGULAR) {
            if (!allowFile(name)) continue;
            obj[name] = await _readFile(`${path}/${name}`);
        }
        // skip sockets, fifos, etc.
    }
    return obj;
}

/**
 * Map a sysfs directory to a JSON-serialisable array of entries.
 *
 * Sysfs files vastly outnumber the ones any caller needs, and `load_contents`
 * is the dominant cost (one open/read/close per file). Pass `files` to bound
 * that work — a Set of filenames or a predicate `(name) => boolean`. Files
 * not allowed are simply omitted from the output. Directories are always
 * traversed (enumerate is cheap) and symlinks always become `{_symlink}`
 * leaves.
 *
 * Without `files`, every regular file is read.
 *
 * @param {string} rootPath  e.g. '/sys/class/typec'
 * @param {{files?: Set<string>|((name: string) => boolean)}} [options]
 * @returns {Promise<Array>}
 */
export async function sysfsToJson(rootPath, {files} = {}) {
    const allowFile = typeof files === 'function' ? files
        : files ? (name => files.has(name))
        : (() => true);

    const result = [];
    for await (const info of _iterChildren(rootPath)) {
        const name = info.get_name();
        const isSymlink = info.get_is_symlink();
        const type = info.get_file_type();

        if (type !== Gio.FileType.DIRECTORY && !isSymlink) continue;

        const childPath = `${rootPath}/${name}`;
        const entry = { _name: name, ...(await _dirToObject(childPath, 0, allowFile)) };
        if (isSymlink) entry._symlinkTarget = _symlinkBasename(info);
        result.push(entry);
    }
    result.sort((a, b) => a._name.localeCompare(b._name));
    return result;
}

// ── value accessors ─────────────────────────────────────────────────────────
// Sysfs files are always read as trimmed strings. These coerce them into the
// shapes the rest of the code wants, returning null for missing/unreadable
// values so callers can `?? defaultValue` uniformly.

export function asString(v) {
    return typeof v === 'string' ? v : null;
}

export function asInt(v) {
    if (typeof v !== 'string' || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
}

export function asHex(v) {
    if (typeof v !== 'string' || v === '') return null;
    const s = v.startsWith('0x') || v.startsWith('0X') ? v.slice(2) : v;
    const n = parseInt(s, 16);
    return Number.isFinite(n) ? n >>> 0 : null;
}

export function symlinkTarget(v) {
    return v && typeof v === 'object' && typeof v._symlink === 'string'
        ? v._symlink
        : null;
}

// True for nested-directory objects produced by _dirToObject — i.e. real
// subdirs whose children we want to walk. Excludes null, primitives, error
// sentinels, and symlink leaves.
export function isDirObject(v) {
    return !!v && typeof v === 'object'
        && v._error === undefined
        && v._symlink === undefined;
}
