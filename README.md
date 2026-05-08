# WhatCable-GNOME

> **What can this USB cable actually do?**

A GNOME Shell extension that tells you what each USB device or USB-C cable plugged into your Linux machine can actually do.


**WhatCable-GNOME is a GNOME port of [WhatCable](https://github.com/darrylmorley/whatcable), a macOS menu bar app by [Darryl Morley](https://github.com/darrylmorley).** It expands the original USB-C focus to cover all USB devices, while preserving the rich USB-C Power Delivery diagnostics from the original.

The extension reads `/sys/bus/usb/devices/`, `/sys/class/typec/`, and `/sys/class/usb_power_delivery/` directly via async `Gio` APIs — no external CLI or native binary required.


![WhatCable-GNOME](screenshot.png)

## Quickstart

The extension is self-contained — no separate CLI or native binary required. It targets GNOME Shell 45+.

```bash
cd gnome-extension
make install                                    # installs to ~/.local/share/gnome-shell/extensions/
# Restart GNOME Shell:
#   - Wayland: log out and log back in
#   - X11: Alt+F2, then type 'r' and press Enter
gnome-extensions enable whatcable@bjuergens.github.io
```

To install system-wide instead:

```bash
sudo make install-system
```

Or build a zip suitable for `gnome-extensions install` (the same zip we upload to extensions.gnome.org):

```bash
cd gnome-extension
make pack
gnome-extensions install --force whatcable@bjuergens.github.io.shell-extension.zip
```

### Quick local test

Rebuild + reinstall + start a nested GNOME Shell window with the new version:

```bash
cd gnome-extension && make install && cd .. && \
MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x1000 dbus-run-session -- gnome-shell --nested --wayland
```

## How it works

WhatCable-GNOME is a pure-GJS panel indicator. On open (and on Refresh) it walks `/sys/bus/usb/devices/`, `/sys/class/typec/`, and `/sys/class/usb_power_delivery/` via async `Gio.File` APIs, decodes USB PD identity/cable VDOs, runs a charging-bottleneck diagnostic, and renders the result into a popup menu. Each device becomes a sub-menu with its headline, bullets, charging diagnostic, and (for chargers) the full PDO list. Entries are permissively validated — a malformed one becomes a warning row instead of breaking the menu.

The reading/parsing logic lives in `gnome-extension/lib/` (one module per concern: `sysfs`, `usb-device`, `typec-port`, `power-delivery`, `pd-decoder`, `cable-info`, `charging-diagnostic`, `device-summary`, `device-manager`). All file IO is async so the shell's main loop is never blocked.

## Caveats

- **USB-C/PD data availability varies by hardware.** The Type-C connector class and USB PD sysfs interfaces depend on the kernel driver (UCSI, TCPM, platform-specific). Some systems expose full PD negotiation data; others expose only basic port info or nothing at all.
- **Cable e-marker info only appears for cables that carry one.** Same as the original — most USB-C cables under 60W are unmarked.
- **WhatCable trusts the e-marker.** Counterfeit or mis-flashed cables can lie about their capabilities.
- **Vendor name lookup is not exhaustive.** Common vendors are recognized; others show the hex VID.

## dev notes

### todo

* testing with many devices/cables
* testing with newer gnome versions
* compare with upstream and implement feature/ui/etc.

### release process

1. `make pack` — check for shexli warnings
2. push to main, then create release tag
3. wait for GHA release build, re-check shexli log
4. download zip from the release
5. upload at <https://extensions.gnome.org/upload/>

## Credits

WhatCable-GNOME is a port of [WhatCable](https://github.com/darrylmorley/whatcable) by [Darryl Morley](https://github.com/darrylmorley). The USB Power Delivery decoding logic, charging diagnostics, vendor database, and plain-English summary approach are derived from the original macOS app, via the intermediate [`whatcable-linux`](https://github.com/Zetaphor/whatcable-linux) C++/Qt port — those C++ sources have been re-implemented in GJS in `gnome-extension/lib/`.

## License

This fork is licensed under [AGPL-3.0](LICENSE).

It is derived from [WhatCable](https://github.com/darrylmorley/whatcable) by Darryl Morley, which is distributed under the MIT License. The original MIT notice is preserved in [LICENSE.MIT](LICENSE.MIT) as required by that license.
