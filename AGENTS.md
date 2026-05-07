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
- We generally want to fail first — throw on unexpected conditions instead of papering over them.
- Missing sysfs paths are *expected*, not unexpected. `/sys/class/typec` and `/sys/class/usb_power_delivery` are kernel-feature-gated and may not exist. The `Sysfs` helpers translate `G_IO_ERROR_NOT_FOUND` to `null` / `[]` so callers can treat absence as "feature absent". Any other IO error (permission denied, EIO, …) propagates up to `_refresh`, which surfaces it as a status message — don't blanket-swallow exceptions.

## Principles

🎯 Lean and fail fast. Simplest thing that works.
📏 Big functions are fine. Extract when there's reuse or the established abstractions call for it.
⏳ No premature performance optimization.
🔊 Fail loudly. Throw errors, don't swallow them. 
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

1. Add the read in the relevant enumerator (`usb-device.js`, `typec-port.js`, or `power-delivery.js`).
2. Surface it in `device-summary.js` (as a bullet, subtitle fragment, or new field on the returned object).
3. If `extension.js`'s `_buildDeviceItem` needs to render a new shape, extend `validateDevice()` first to type-check it.
