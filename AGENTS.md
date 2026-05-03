# WhatCable-GNOME — Agent Guidelines

## Project Overview

WhatCable-GNOME is a GNOME Shell extension. It surfaces USB device and USB-C cable information in the panel by shelling out to the upstream [`whatcable-linux`](https://github.com/Zetaphor/whatcable-linux) CLI and rendering its `--json` output. This repo no longer contains C++ source — that lives upstream.

The original macOS app is [WhatCable](https://github.com/darrylmorley/whatcable) by Darryl Morley.

## Architecture

One component:

- **`gnome-extension/`** — GNOME Shell extension (GJS, ESM, GNOME 45+). A `PanelMenu.Button` indicator that spawns `whatcable-linux --json` via `Gio.Subprocess` and renders the parsed JSON into a popup menu. Persistent prefs (`show-empty-ports`, `show-internal-devices`) live in GSettings.

The extension treats the CLI's JSON output as an external contract. Every field is permissively validated in `validateDevice()` before rendering — malformed entries become a warning row rather than crashing the menu. When upstream changes its JSON shape, fixes go in `validateDevice()` and `_buildDeviceItem()`.

## Code Conventions (GJS)

- Target GNOME Shell 45+ — use ESM `import` syntax and `resource:///org/gnome/shell/...` paths.
- Subclass `PanelMenu.Button` via `GObject.registerClass`.
- Use `Gio.Subprocess` async APIs to call the CLI; never block the shell's main loop.
- Disconnect every settings/signal connection in `destroy()` / `disable()`.
- Don't add npm/JS dependencies — extensions.gnome.org ships source-only and rejects bundlers.

## Build / Install

The extension is plain JS, CSS, and a GSettings schema XML. No CMake, no compiler.

```bash
cd gnome-extension
make install        # installs to ~/.local/share/gnome-shell/extensions/, also compiles schemas/
make pack           # produces a zip suitable for extensions.gnome.org upload
```

After `make install`, restart GNOME Shell (Alt+F2 → `r` on X11, log out on Wayland) and run:

```
gnome-extensions enable whatcable@gnome.overthrow905.passmail.net
```

## Testing

- Live extension logs: `journalctl /usr/bin/gnome-shell -f`
- Nested shell for fast iteration: `MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x1000 dbus-run-session -- gnome-shell --nested --wayland`
- Open the prefs window: `gnome-extensions prefs whatcable@gnome.overthrow905.passmail.net`

To exercise the JSON validation paths, point a shell wrapper at `whatcable-linux` that emits malformed payloads (non-array root, devices missing `headline`, etc.) and confirm the panel either shows a top-level error or a per-device warning row.

## Known-good CLI version

`extension.js` has a `KNOWN_GOOD_CLI_VERSION` constant. Bump it whenever a new upstream `whatcable-linux` release is verified against this extension. The value is shown in the *Debug info* submenu next to the actual installed version so users can spot a mismatch.

## Key Files

| File | Purpose |
|---|---|
| `gnome-extension/extension.js` | Panel indicator, JSON validator, settings wiring |
| `gnome-extension/prefs.js` | Adw preferences window |
| `gnome-extension/schemas/org.gnome.shell.extensions.whatcable.gschema.xml` | GSettings schema (booleans for the two visibility toggles) |
| `gnome-extension/metadata.json` | Extension manifest (UUID, supported shell versions, settings-schema) |
| `gnome-extension/Makefile` | install / install-system / pack targets; compiles schemas |
| `.github/workflows/release.yml` | Tagged builds produce the EGO upload zip |

## Adding new fields from upstream JSON

When upstream `whatcable-linux` adds a field to `--json`:

1. Add it to `validateDevice()` in `extension.js` with the appropriate type guard.
2. Render it in `_buildDeviceItem()`.
3. Bump `KNOWN_GOOD_CLI_VERSION` to the upstream release that introduced the field.
