# WhatCable-GNOME — Agent Guidelines

## Project Overview

WhatCable-GNOME is a GNOME port of [WhatCable](https://github.com/darrylmorley/whatcable) (macOS) by Darryl Morley. It is a GNOME Shell extension + CLI tool that shows USB device and USB-C cable information by reading Linux sysfs.

## Architecture

Three components, with the extension talking to the CLI rather than linking to the C++ core directly:

- **`src/core/`** — `libwhatcablecore`, a static C++ library. Reads sysfs, decodes USB PD data, and produces human-readable summaries. No Qt GUI dependencies — only Qt6::Core.
- **`src/cli/`** — `whatcable-linux` CLI binary. Uses the core library. Supports `--json`, `--watch`, `--raw`. The `--json` output is the contract the GNOME extension consumes.
- **`gnome-extension/`** — GNOME Shell extension (GJS, ESM, GNOME 45+). A `PanelMenu.Button` indicator that spawns `whatcable-linux --json` via `Gio.Subprocess` and renders the parsed JSON into a popup menu.

## Key Data Flow

```
/sys/bus/usb/devices/         → UsbDevice.cpp
/sys/class/typec/             → TypeCPort.cpp
/sys/class/usb_power_delivery/ → PowerDelivery.cpp
                                    ↓
                              DeviceManager.cpp  ← UDevMonitor.cpp (hotplug)
                                    ↓
                              DeviceSummary.cpp (plain-English output)
                                    ↓
                        CLI (main.cpp) ──── --json ────▶ extension.js (GNOME Shell)
```

## Code Conventions

### C++ (core / CLI)
- C++20, Qt 6 style. Use `QStringLiteral()` for string literals.
- All core classes are in the `WhatCable` namespace.
- sysfs reads go through `SysfsReader` — never read `/sys/` directly with raw file I/O.
- Source files derived from the original Swift code must keep the attribution header: `// Derived from WhatCable by Darryl Morley (https://github.com/darrylmorley/whatcable)`
- Handle missing sysfs paths gracefully — return empty/nullopt, never crash. Many systems lack `/sys/class/typec/` or `/sys/class/usb_power_delivery/`.

### GNOME Shell extension (GJS)
- Target GNOME Shell 45+ — use ESM `import` syntax and `resource:///org/gnome/shell/...` paths.
- Subclass `PanelMenu.Button` via `GObject.registerClass`.
- Use `Gio.Subprocess` async APIs to call the CLI; never block the shell's main loop.
- Tear down all `GLib.timeout_add*` sources in `destroy()` / `disable()`.
- Keep the extension thin: any new device decoding belongs in the C++ core, then surfaces through the CLI's JSON.

## Build

```bash
cmake -B build
cmake --build build
```

The build produces the core library and CLI. The GNOME extension is plain JS/CSS and does not need CMake — install it from `gnome-extension/` with `make install`.

## Testing

- Run the CLI: `./build/src/cli/whatcable-linux`
- JSON output (the contract the extension depends on): `./build/src/cli/whatcable-linux --json`
- Watch mode: `./build/src/cli/whatcable-linux --watch`
- Extension install (user): `cd gnome-extension && make install` then restart the shell and `gnome-extensions enable whatcable@whatcable.local`
- Live extension logs: `journalctl /usr/bin/gnome-shell -f`

## Key Files to Know

| File | Purpose |
|---|---|
| `src/core/UsbDevice.h/cpp` | Enumerates all USB devices from `/sys/bus/usb/devices/` |
| `src/core/TypeCPort.h/cpp` | Reads USB-C port state from `/sys/class/typec/` |
| `src/core/PDDecoder.h/cpp` | USB PD VDO bit-field decoding (ported from PDVDO.swift) |
| `src/core/PowerDelivery.h/cpp` | Parses PDO lists from `/sys/class/usb_power_delivery/` |
| `src/core/DeviceSummary.h/cpp` | Generates headlines, subtitles, bullets per device |
| `src/core/ChargingDiagnostic.h/cpp` | Identifies USB-C charging bottlenecks |
| `src/core/DeviceManager.h/cpp` | Aggregates all sources, correlates data, owns refresh logic |
| `src/core/UDevMonitor.h/cpp` | libudev hotplug monitoring |
| `src/core/VendorDB.h/cpp` | USB VID → vendor name lookup |
| `src/core/UsbClassDB.h/cpp` | USB class code → human name |
| `src/cli/main.cpp` | CLI entry point; defines the `--json` schema consumed by the extension |
| `gnome-extension/extension.js` | GNOME Shell panel indicator and popup |
| `gnome-extension/metadata.json` | Extension manifest (uuid, supported shell versions) |

## Adding New Vendors

Add entries to the `kVendors` map in `src/core/VendorDB.cpp`. Format: `{0xVID, QStringLiteral("Vendor Name")}`.

## Adding New USB Class Codes

Add cases to `UsbClassDB::className()` or `interfaceClassName()` in `src/core/UsbClassDB.cpp`.

## Extending the JSON Contract

When adding a new field to the CLI's JSON output (`src/cli/main.cpp`), make sure `gnome-extension/extension.js` either consumes it or safely ignores it. The extension treats all sub-objects (`charging`, `powerDelivery`, `cable`, `typec`, `usb`) as optional.
