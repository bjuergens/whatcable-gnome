# WhatCable-GNOME

> **What can this USB cable actually do?**

A GNOME Shell extension and CLI tool that tells you, in plain English, what each USB device plugged into your Linux machine can actually do.

**WhatCable-GNOME is a GNOME port of [WhatCable](https://github.com/darrylmorley/whatcable), a macOS menu bar app by [Darryl Morley](https://github.com/darrylmorley).** It expands the original USB-C focus to cover all USB devices, while preserving the rich USB-C Power Delivery diagnostics from the original.

![WhatCable-GNOME](screenshot.png)

## What it shows

### All USB devices
- **Device identity**: vendor, product name, serial number
- **Speed**: negotiated link speed (1.5 Mbps to 20 Gbps)
- **USB version**: 1.1, 2.0, 3.0, 3.1, 3.2
- **Power draw**: how much power the device is consuming
- **Device type**: HID, Audio, Mass Storage, Hub, etc.
- **Driver**: which kernel driver is handling the device
- **Topology**: hub hierarchy showing what's plugged into what

### USB-C ports (additional detail)
- **Port roles**: data role (host/device), power role (source/sink)
- **Cable e-marker info**: cable speed capability, current rating (3A/5A), active vs passive, cable vendor
- **Charger PDO list**: every voltage/current profile the charger advertises, with the active profile highlighted
- **Charging diagnostics**: identifies bottlenecks — cable limiting speed, charger undersized, etc.
- **Partner identity**: decoded from PD Discover Identity VDOs

## Install

### Build the CLI

The GNOME extension shells out to the `whatcable-linux` CLI, so build and install that first.

```bash
# Install dependencies (Fedora)
sudo dnf install gcc-c++ cmake qt6-qtbase-devel systemd-devel

# Install dependencies (Arch/Manjaro)
sudo pacman -S base-devel cmake qt6-base systemd-libs

# Install dependencies (Debian/Ubuntu)
sudo apt install build-essential cmake qt6-base-dev libudev-dev pkg-config

# Build
cmake -B build -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --build build
sudo cmake --install build
```

### Install the GNOME Shell extension

The extension lives in [`gnome-extension/`](gnome-extension/). It targets GNOME Shell 45+.

```bash
cd gnome-extension
make install                                    # installs to ~/.local/share/gnome-shell/extensions/
# Restart GNOME Shell:
#   - Wayland: log out and log back in
#   - X11: Alt+F2, then type 'r' and press Enter
gnome-extensions enable whatcable@whatcable.local
```

To install system-wide instead:

```bash
sudo make install-system
```

Or build a zip suitable for `gnome-extensions install`:

```bash
cd gnome-extension
make pack
gnome-extensions install --force whatcable@whatcable.local.shell-extension.zip
```

### CLI only

After building, the `whatcable-linux` binary is in `build/src/cli/`:

```bash
whatcable-linux              # human-readable summary of every USB device
whatcable-linux --json       # structured JSON output
whatcable-linux --watch      # stream updates as devices come and go
whatcable-linux --raw        # include raw sysfs attributes
whatcable-linux --version
whatcable-linux --help
```

## How it works

WhatCable-GNOME reads three areas of the Linux sysfs virtual filesystem. No root access required for basic info:

| sysfs path | What it gives us |
|---|---|
| `/sys/bus/usb/devices/` | All USB devices: vendor, product, speed, power, class, interfaces, topology |
| `/sys/class/typec/` | USB-C port state: connection, roles, cable e-marker, partner identity |
| `/sys/class/usb_power_delivery/` | PD negotiation: PDO list from charger, active profile, PPS ranges |

Hotplug monitoring uses `libudev` to detect connect/disconnect events in real time.

The GNOME Shell extension is a pure-GJS panel indicator that periodically invokes `whatcable-linux --json` and renders the result in a popup menu. Keeping all sysfs / PD decoding in the C++ CLI means the same logic powers both the CLI and the extension, and the extension itself stays small and easy to audit.

Cable speed and power decoding follow the USB Power Delivery 3.x spec, ported from the original WhatCable's Swift implementation.

## Caveats

- **USB-C/PD data availability varies by hardware.** The Type-C connector class and USB PD sysfs interfaces depend on the kernel driver (UCSI, TCPM, platform-specific). Some systems expose full PD negotiation data; others expose only basic port info or nothing at all.
- **Cable e-marker info only appears for cables that carry one.** Same as the original — most USB-C cables under 60W are unmarked.
- **WhatCable trusts the e-marker.** Counterfeit or mis-flashed cables can lie about their capabilities.
- **Vendor name lookup is not exhaustive.** Common vendors are recognized; others show the hex VID.

## Credits

WhatCable-GNOME is a port of [WhatCable](https://github.com/darrylmorley/whatcable) by [Darryl Morley](https://github.com/darrylmorley). The USB Power Delivery decoding logic, charging diagnostics, vendor database, and plain-English summary approach are derived from the original macOS app.

## License

[MIT](LICENSE)
