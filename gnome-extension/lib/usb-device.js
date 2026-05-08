// Enumerate /sys/bus/usb/devices/.

import {sysfsToJson, asString, asInt, asHex, symlinkTarget} from './sysfsToJson.js';

const USB_DEVICES_PATH = '/sys/bus/usb/devices';
const IFACE_KEY_RE = /:/;

const USB_FILES = new Set([
    // device attrs
    'idVendor', 'idProduct', 'manufacturer', 'product', 'serial', 'version',
    'removable', 'speed', 'bMaxPower', 'busnum', 'devnum',
    'rx_lanes', 'tx_lanes', 'bNumConfigurations',
    'bDeviceClass', 'bDeviceSubClass', 'bDeviceProtocol', 'bNumInterfaces',
    // interface attrs
    'bInterfaceClass', 'bInterfaceSubClass', 'bInterfaceProtocol',
]);

function parseMaxPower(val) {
    if (typeof val !== 'string' || !val) return 0;
    const numeric = val.replace(/[^0-9]/g, '');
    return numeric ? parseInt(numeric, 10) || 0 : 0;
}

function readInterfaces(entry) {
    const interfaces = [];
    for (const [key, val] of Object.entries(entry)) {
        if (!IFACE_KEY_RE.test(key)) continue;
        if (!val || typeof val !== 'object' || val._error) continue;
        const cls = asHex(val.bInterfaceClass);
        if (cls === null) continue;
        interfaces.push({
            number: parseInt(key.split('.').pop(), 10) || 0,
            classCode: cls & 0xFF,
            subClass: (asHex(val.bInterfaceSubClass) ?? 0) & 0xFF,
            protocol: (asHex(val.bInterfaceProtocol) ?? 0) & 0xFF,
            driver: symlinkTarget(val.driver) ?? '',
        });
    }
    return interfaces;
}

function readDevice(entry) {
    const name = entry._name;
    // Interface entries (e.g. "1-2:1.0") show up as siblings to device entries
    // at the bus root; skip them — only top-level device dirs become devices.
    if (IFACE_KEY_RE.test(name)) return null;

    const vid = asHex(entry.idVendor);
    const pid = asHex(entry.idProduct);
    if (vid === null || pid === null) return null;

    const cls = (asHex(entry.bDeviceClass) ?? 0) & 0xFF;
    return {
        busPort: name,
        vendorId: vid & 0xFFFF,
        productId: pid & 0xFFFF,
        manufacturer: asString(entry.manufacturer) ?? '',
        product: asString(entry.product) ?? '',
        serial: asString(entry.serial) ?? '',
        version: asString(entry.version)?.trim() ?? '',
        removable: asString(entry.removable) ?? '',
        speed: asInt(entry.speed) ?? 0,
        maxPowerMA: parseMaxPower(asString(entry.bMaxPower)),
        busNum: asInt(entry.busnum) ?? 0,
        devNum: asInt(entry.devnum) ?? 0,
        rxLanes: asInt(entry.rx_lanes) ?? 0,
        txLanes: asInt(entry.tx_lanes) ?? 0,
        numInterfaces: asInt(entry.bNumInterfaces) ?? 0,
        numConfigurations: asInt(entry.bNumConfigurations) ?? 0,
        deviceClass: cls,
        deviceSubClass: (asHex(entry.bDeviceSubClass) ?? 0) & 0xFF,
        deviceProtocol: (asHex(entry.bDeviceProtocol) ?? 0) & 0xFF,
        isHub: cls === 0x09,
        isRootHub: name.startsWith('usb'),
        interfaces: readInterfaces(entry),
    };
}

export async function enumerateUsbDevices() {
    const tree = await sysfsToJson(USB_DEVICES_PATH, {files: USB_FILES});
    const devices = [];
    for (const entry of tree) {
        const dev = readDevice(entry);
        if (dev) devices.push(dev);
    }
    return devices;
}
