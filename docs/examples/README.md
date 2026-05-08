# Sysfs fixture examples

Verbatim snapshots of the kernel sysfs trees this extension reads:

- `/sys/class/typec/` — USB Type-C connector class (`drivers/usb/typec/class.c`)
- `/sys/class/usb_power_delivery/` — USB-PD capabilities class (`drivers/usb/typec/pd.c`)

Each example is a self-contained `sys/class/...` subtree mirroring what a real
machine exposes for one scenario. All attribute files contain the trailing
newline the kernel emits, so consumers may safely `.trim()` the contents.

## Provenance

Values are hand-crafted to match the kernel ABI documented in
`Documentation/ABI/testing/sysfs-class-typec` and
`Documentation/ABI/testing/sysfs-class-usb_power_delivery`, cross-checked
against the driver source (`drivers/usb/typec/{class,pd}.c`). They are
plausible — not captured from a specific physical device — and are intended
as fixtures for unit tests, not as proof of conformance with any vendor.

## Scenarios

| Dir | Scenario |
|-----|----------|
| `01-port-disconnected/` | Type-C port with nothing attached. Exercises the no-partner / no-cable code path and shows every documented port attribute (including those the extension doesn't yet read). |
| `02-pd-charger-passive-3a/` | 67 W USB-PD charger plugged in via a passive 3 A e-marked cable. Exercises partner identity, cable identity, and source/sink capabilities with Fixed and PPS PDOs. |
| `03-tb4-dock-active-5a-altmode/` | Thunderbolt 4 dock attached via an active 5 A cable. Exercises active-cable VDO decoding and partner alt-mode subdevices (DisplayPort + Thunderbolt SVIDs). |
| `04-pdo-rare-types/` | Source advertising Battery, Variable, and SPR Adjustable Voltage Supply (AVS) PDOs in addition to Fixed. Exercises PDO-type branches the extension currently handles incompletely. |

## Capturing your own

To snapshot a real system:

```sh
sudo cp -aL --parents /sys/class/typec/port*/ ~/snapshot/
sudo cp -aL --parents /sys/class/usb_power_delivery/ ~/snapshot/
```

`-L` dereferences the kernel's `usb_power_delivery` symlink into a regular
directory inside the snapshot, which makes the tree portable.

## File-format notes

| Attribute kind | Format | Examples |
|----------------|--------|----------|
| Identity VDOs (`id_header`, `cert_stat`, `product`, `product_type_vdo[1-3]`) | 32-bit value as `0x%08x\n` | `0x18002a51` |
| Voltages | Millivolts as decimal int | `5000` (= 5.0 V) |
| Currents | Milliamperes as decimal int | `3000` (= 3.0 A) |
| Powers | Milliwatts as decimal int | `60000` (= 60 W) |
| Booleans | `0` or `1` | `1` |
| Enums (`type`, `power_role`, …) | Lowercase string; for RW enums the active value is in brackets | `dual`, `[source]`, `[host] device` |
| Revisions | Decimal `M.m` (sometimes `M.m.r`) | `3.0`, `3.1` |
| `usb_capability` | Space-separated, default in brackets | `usb2 [usb3] usb4` |
| `supported_accessory_modes` | Space-separated mode names | `analog_audio debug` |

The kernel exposes the typec→PD association as a symlink at
`/sys/class/typec/portN/usb_power_delivery` whose target is the matching
`/sys/class/usb_power_delivery/sourceN` (or `sinkN`) directory. Each example
includes that symlink so `Sysfs.readSymlinkTargetBasename` resolves correctly
when fixtures are loaded directly off disk.

## PDO directory naming

PDO directory names encode position and type, e.g. `1:fixed_supply`. **There
is no `type` attribute file inside the directory** — the type is the suffix
after the colon. Documented suffixes:

- `fixed_supply`
- `variable_supply`
- `battery`
- `programmable_supply` (PPS)
- `spr_adjustable_voltage_supply` (SPR-AVS, added in 6.x)

`source-capabilities/` and `sink-capabilities/` use overlapping but
non-identical attribute sets per type — see the per-scenario files for the
authoritative shape.
