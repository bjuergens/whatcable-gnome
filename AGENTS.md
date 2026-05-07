# WhatCable-GNOME — Agent Guidelines

## Project Overview

WhatCable-GNOME is a GNOME Shell extension. It surfaces USB device and USB-C cable information in the panel by reading `/sys/bus/usb/devices/`, `/sys/class/typec/`, and `/sys/class/usb_power_delivery/` directly via async `Gio` APIs and rendering the result in a popup menu. There is no external CLI or native binary — the reading / parsing / PD decoding logic is pure GJS in `gnome-extension/lib/`.

The original macOS app is [WhatCable](https://github.com/darrylmorley/whatcable) by Darryl Morley. The Linux logic was first implemented as a C++/Qt CLI ([`whatcable-linux`](https://github.com/Zetaphor/whatcable-linux)); that logic has since been re-implemented in GJS inside this repo.

## Architecture

A single component, `gnome-extension/`. GJS, ESM, GNOME 45+. A `PanelMenu.Button` indicator that on open / Refresh calls `collectDevices()` from `lib/device-manager.js` and renders the returned objects into a popup menu. Persistent prefs (`show-empty-ports`, `show-internal-devices`) live in GSettings.

```
extension.js                  PanelMenu.Button + validateDevice + _buildDeviceItem
prefs.js                      Adw.PreferencesPage bound to the same GSettings keys
lib/device-manager.js         collectDevices(): single async entrypoint
lib/usb-device.js             enumerate /sys/bus/usb/devices
lib/typec-port.js             enumerate /sys/class/typec
lib/power-delivery.js         enumerate /sys/class/usb_power_delivery
lib/cable-info.js             extract e-marker fields from a typec cable's VDOs
lib/pd-decoder.js             USB PD VDO bit-field decoders (pure, no IO)
lib/device-summary.js         shape per-device objects for the panel UI
lib/charging-diagnostic.js    "is the cable / charger / device the bottleneck?"
lib/sysfs.js                  async Gio wrappers, NOT_FOUND → null/[]
lib/vendor-db.js / usb-class-db.js   small static lookup tables
```

## Code Conventions (GJS)

- Target GNOME Shell 45+ — use ESM `import` syntax and `resource:///org/gnome/shell/...` paths.
- Subclass `PanelMenu.Button` via `GObject.registerClass`.
- All file IO must be **async** (`Gio.File.load_contents_async`, `enumerate_children_async`, etc., promisified via `Gio._promisify`). Never block the shell's main loop with sync sysfs reads in a refresh path.
- Prefer `async` / `await` over `.then()` chains — the codebase uses `await` everywhere except where the call site is non-async by necessity.
- Disconnect every settings/signal connection in `destroy()` / `disable()`. The pattern is: push every `connect()` id into `this._settingsChangedIds`, then loop-disconnect in `destroy()`.
- Don't add npm/JS dependencies — extensions.gnome.org ships source-only and rejects bundlers.
- We fail first — throw on unexpected conditions instead of papering over them.
- Missing sysfs paths are *expected*, not unexpected. `/sys/class/typec` and `/sys/class/usb_power_delivery` are kernel-feature-gated and may not exist. The `Sysfs` helpers translate `G_IO_ERROR_NOT_FOUND` to `null` / `[]` so callers can treat absence as "feature absent". Any other IO error (permission denied, EIO, …) propagates up to `_refresh`, which surfaces it as a status message — don't blanket-swallow exceptions.

## JS Style

- **Render-side validation.** Anything `device-manager.collectDevices()` returns is treated by `extension.js#validateDevice` as a permissive shape — every field is type-checked before rendering and a malformed entry becomes a warning row rather than crashing the menu. When you add a new field, extend `validateDevice` first.

## Principles

📏 Big functions are fine. Extract when there's reuse or the established abstractions call for it.
⏳ No premature performance optimization.
📋 Plans define what and done when, not how. Challenge a plan when it fights reality; don't silently deviate.

## Emoji

Use consistently in code, commits, and logging.

### Commits

Human-made commits usually contain no emoji, while agent-made commits do.

`<emoji> <type>: <description>`

- ✨ feat: new feature
- 🐛 fix: bug fix
- 🔧 config: configuration changes
- 📦 deps: dependency changes
- 🧪 test: tests
- 📝 docs: documentation
- 🧹 refactor: cleanup (no behavior change)


### Logging

- ✅ success operations
- ❌ errors and failures
- ⚠️ warnings

## Adding a new sysfs attribute

1. Add the read in the relevant enumerator (`usb-device.js`, `typec-port.js`, or `power-delivery.js`). Add it to the existing `Promise.all([...])` so it's read in parallel with the rest.
2. Surface it in `device-summary.js` (as a bullet, subtitle fragment, or new field on the returned object).
3. If `extension.js`'s `_buildDeviceItem` needs to render a new shape, extend `validateDevice()` first to type-check it.
4. If the attribute is a kernel enum string mapped to a label, add it as a module-scope object literal next to the others, not a switch.
