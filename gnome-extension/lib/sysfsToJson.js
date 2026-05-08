// sysfsToJson.js
//
// Recursively maps a sysfs directory tree to a plain JS object / JSON.
//
// Files   → string value, or { _error: "unreadable", _path: "..." }
// Dirs    → nested object
// Symlinks → followed one level (sysfs class dirs are symlinks to real devices)
//
// Usage:
//   const tree = await sysfsToJson('/sys/class/typec');
//   console.log(JSON.stringify(tree, null, 2));
//
/* example output:
[
  {
    "_name": "port1-partner",
    "pd2": {
      "revision": "2.0",
      "source-capabilities": {
        "4:fixed_supply": {
          "voltage": "20000mV",
          "maximum_current": "3250mA",
          "unconstrained_power": "1",
          "autosuspend_delay_ms": { "_error": "unreadable", "_path": "...", "_reason": "..." }
        }
      }
    },
    "supports_usb_power_delivery": "yes"
  }
]
*/

/* example usage
import { sysfsToJson } from './sysfsToJson.js';

const [typec, powerSupply, usbPd] = await Promise.all([
    sysfsToJson('/sys/class/typec'),
    sysfsToJson('/sys/class/power_supply'),
    sysfsToJson('/sys/class/usb_power_delivery'),
]);

const debugInfo = { typec, powerSupply, usbPd };
log(JSON.stringify(debugInfo, null, 2));
*/

import Gio from "gi://Gio";
import GLib from "gi://GLib";

Gio._promisify(
  Gio.File.prototype,
  "load_contents_async",
  "load_contents_finish",
);
Gio._promisify(
  Gio.File.prototype,
  "enumerate_children_async",
  "enumerate_children_finish",
);
Gio._promisify(
  Gio.FileEnumerator.prototype,
  "next_files_async",
  "next_files_finish",
);

const decoder = new TextDecoder();
const MAX_DEPTH = 8;

// ── internal helpers ────────────────────────────────────────────────────────

async function* _iterChildren(path) {
  let enumerator;
  try {
    enumerator = await Gio.File.new_for_path(path).enumerate_children_async(
      "standard::name,standard::type,standard::is-symlink",
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      GLib.PRIORITY_DEFAULT,
      null,
    );
  } catch {
    return; // unreadable / not found — yield nothing
  }
  while (true) {
    const batch = await enumerator.next_files_async(
      64,
      GLib.PRIORITY_DEFAULT,
      null,
    );
    if (batch.length === 0) return;
    yield* batch;
  }
}

async function _readFile(path) {
  try {
    const [contents] =
      await Gio.File.new_for_path(path).load_contents_async(null);
    return decoder.decode(contents).trim();
  } catch (e) {
    // Return a sentinel object so the consumer knows something is there
    // but couldn't be read (write-only, binary, I/O error, etc.)
    return {
      _error: "unreadable",
      _path: path,
      _reason: e.message ?? String(e),
    };
  }
}

async function _dirToObject(path, depth) {
  if (depth > MAX_DEPTH) return { _error: "max_depth_exceeded", _path: path };

  const obj = {};

  for await (const info of _iterChildren(path)) {
    const name = info.get_name();
    const isSymlink = info.get_is_symlink();
    const type = info.get_file_type();

    // Resolve symlinks one level — sysfs /sys/class/* entries are symlinks
    // to the real device path. We follow them but don't recurse into their
    // symlink children again (NOFOLLOW_SYMLINKS on enumerate prevents loops).
    const childPath = isSymlink
      ? Gio.File.new_for_path(path).resolve_relative_path(name).get_path()
      : `${path}/${name}`;

    if (type === Gio.FileType.DIRECTORY || isSymlink) {
      obj[name] = await _dirToObject(childPath, depth + 1);
    } else if (type === Gio.FileType.REGULAR) {
      obj[name] = await _readFile(childPath);
    }
    // skip sockets, fifos, etc.
  }

  return obj;
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Map a sysfs directory to a JSON-serialisable object.
 *
 * The top level is an *array* — one element per immediate child of `rootPath`
 * (matching the shape you'd expect for /sys/class/typec, /sys/class/power_supply,
 * etc. where each child is a distinct device).
 *
 * Each element has a `_name` key with the child's directory name, plus one key
 * per file/subdir inside it.
 *
 * Unreadable files are represented as:
 *   { _error: "unreadable", _path: "/full/path", _reason: "..." }
 * so consumers can distinguish "file absent" from "file present but unreadable".
 *
 * @param {string} rootPath  e.g. '/sys/class/typec'
 * @returns {Promise<Array>}
 */
export async function sysfsToJson(rootPath) {
  const result = [];

  for await (const info of _iterChildren(rootPath)) {
    const name = info.get_name();
    const isSymlink = info.get_is_symlink();
    const type = info.get_file_type();

    if (type !== Gio.FileType.DIRECTORY && !isSymlink) continue;

    // Resolve the real path (class dirs are symlinks to /sys/devices/...)
    const realPath = isSymlink
      ? Gio.File.new_for_path(rootPath).resolve_relative_path(name).get_path()
      : `${rootPath}/${name}`;

    const entry = { _name: name, ...(await _dirToObject(realPath, 0)) };
    result.push(entry);
  }

  // Sort by _name for stable output
  result.sort((a, b) => a._name.localeCompare(b._name));
  return result;
}
