# WhatCable-GNOME — Agent Guidelines

## Project Overview

WhatCable-GNOME is a GNOME Shell extension. It surfaces USB device and USB-C cable information in the panel by reading `/sys/bus/usb/devices/`, `/sys/class/typec/`, and `/sys/class/usb_power_delivery/` directly via async `Gio` APIs and rendering the result in a popup menu. There is no external CLI or native binary — the reading / parsing / PD decoding logic is pure GJS in `gnome-extension/lib/`.

The original macOS app is [WhatCable](https://github.com/darrylmorley/whatcable) by Darryl Morley. The Linux logic was first implemented as a C++/Qt CLI ([`whatcable-linux`](https://github.com/Zetaphor/whatcable-linux)); that logic has since been re-implemented in GJS inside this repo.

## Architecture

One component:

- **`gnome-extension/`** — GNOME Shell extension (GJS, ESM, GNOME 45+). A `PanelMenu.Button` indicator that on open / Refresh calls `collectDevices()` from `lib/device-manager.js` and renders the returned objects into a popup menu. Persistent prefs (`show-empty-ports`, `show-internal-devices`) live in GSettings.

`extension.js` treats the objects produced by `collectDevices()` as a permissive shape — every field is type-checked in `validateDevice()` before rendering, and a malformed entry becomes a warning row rather than crashing the menu.

## Code Conventions (GJS)

- Target GNOME Shell 45+ — use ESM `import` syntax and `resource:///org/gnome/shell/...` paths.
- Subclass `PanelMenu.Button` via `GObject.registerClass`.
- All file IO must be **async** (`Gio.File.load_contents_async`, `enumerate_children_async`, etc., promisified via `Gio._promisify`). Never block the shell's main loop with sync sysfs reads in a refresh path.
- Disconnect every settings/signal connection in `destroy()` / `disable()`.
- Don't add npm/JS dependencies — extensions.gnome.org ships source-only and rejects bundlers.
- Treat missing sysfs paths as "feature absent" (return `null`/`[]`), not as errors. Type-C and PD trees are kernel-feature-gated.

## Key Files

| File | Purpose |
|---|---|
| `gnome-extension/extension.js` | Panel indicator, JSON validator, settings wiring |
| `gnome-extension/prefs.js` | Adw preferences window |
| `gnome-extension/lib/sysfs.js` | Async helpers: `readAttribute`, `readHexAttribute`, `listSubdirectories`, etc. |
| `gnome-extension/lib/usb-device.js` | Walks `/sys/bus/usb/devices/` |
| `gnome-extension/lib/typec-port.js` | Walks `/sys/class/typec/` |
| `gnome-extension/lib/power-delivery.js` | Walks `/sys/class/usb_power_delivery/` |
| `gnome-extension/lib/pd-decoder.js` | USB PD ID-Header / Cable VDO bit decoding |
| `gnome-extension/lib/cable-info.js` | E-marker info from cable identity VDOs |
| `gnome-extension/lib/charging-diagnostic.js` | Cable / charger / device bottleneck heuristic |
| `gnome-extension/lib/vendor-db.js`, `usb-class-db.js` | Static lookup tables |
| `gnome-extension/lib/device-summary.js` | Builds the headline / subtitle / bullets shape |
| `gnome-extension/lib/device-manager.js` | `collectDevices()` — single entrypoint for the indicator |
| `gnome-extension/schemas/org.gnome.shell.extensions.whatcable.gschema.xml` | GSettings schema |
| `gnome-extension/metadata.json` | Extension manifest (UUID, supported shell versions, settings-schema) |
| `gnome-extension/Makefile` | install / install-system / pack targets; compiles schemas |
| `.github/workflows/release.yml` | Tagged builds produce the EGO upload zip |

## Adding a new sysfs attribute

1. Add the read in the relevant enumerator (`usb-device.js`, `typec-port.js`, or `power-delivery.js`).
2. Surface it in `device-summary.js` (as a bullet, subtitle fragment, or new field on the returned object).
3. If `extension.js`'s `_buildDeviceItem` needs to render a new shape, extend `validateDevice()` first to type-check it.
