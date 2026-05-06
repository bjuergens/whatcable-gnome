// Enumerate /sys/bus/usb/devices/. Direct port of src/core/UsbDevice.cpp.

import * as Sysfs from './sysfs.js';

const USB_DEVICES_PATH = '/sys/bus/usb/devices';

function speedLabel(speedMbps) {
    if (speedMbps >= 20000) return 'USB4 20 Gbps';
    if (speedMbps >= 10000) return 'SuperSpeed+ 10 Gbps';
    if (speedMbps >= 5000)  return 'SuperSpeed 5 Gbps';
    if (speedMbps >= 480)   return 'High Speed 480 Mbps';
    if (speedMbps >= 12)    return 'Full Speed 12 Mbps';
    if (speedMbps >= 2)     return 'Low Speed 1.5 Mbps';
    return 'Unknown speed';
}

function powerLabel(maxPowerMA) {
    if (maxPowerMA <= 0) return '';
    if (maxPowerMA >= 1000)
        return `${(maxPowerMA / 1000).toFixed(1)} W`;
    return `${maxPowerMA} mA`;
}

function parseMaxPower(val) {
    if (!val) return 0;
    const numeric = val.replace(/[^0-9]/g, '');
    if (!numeric) return 0;
    const n = parseInt(numeric, 10);
    return Number.isFinite(n) ? n : 0;
}

async function readByte(path) {
    const v = await Sysfs.readHexAttribute(path);
    return v === null ? 0 : v & 0xFF;
}

async function readInterfaces(devPath) {
    const entries = await Sysfs.listSubdirectories(devPath);
    const ifaces = [];
    for (const entry of entries) {
        if (!entry.includes(':')) continue;
        const ifPath = `${devPath}/${entry}`;
        const cls = await Sysfs.readHexAttribute(`${ifPath}/bInterfaceClass`);
        if (cls === null) continue;
        const sub = await Sysfs.readHexAttribute(`${ifPath}/bInterfaceSubClass`);
        const proto = await Sysfs.readHexAttribute(`${ifPath}/bInterfaceProtocol`);
        const driver = Sysfs.readSymlinkTargetBasename(`${ifPath}/driver`);
        const numStr = entry.split('.').pop();
        ifaces.push({
            number: parseInt(numStr, 10) || 0,
            classCode: cls & 0xFF,
            subClass: sub === null ? 0 : sub & 0xFF,
            protocol: proto === null ? 0 : proto & 0xFF,
            driver: driver ?? '',
        });
    }
    return ifaces;
}

async function readDevice(path, name) {
    // Skip interface entries like "1-2:1.0" — only top-level device dirs.
    if (name.includes(':')) return null;

    const vid = await Sysfs.readHexAttribute(`${path}/idVendor`);
    const pid = await Sysfs.readHexAttribute(`${path}/idProduct`);
    if (vid === null || pid === null) return null;

    const [
        manufacturer, product, serial, version, removable,
        speed, maxPowerRaw, busNum, devNum, rxLanes, txLanes, numConfigs,
        deviceClass, deviceSubClass, deviceProtocol, numInterfacesStr,
        interfaces,
    ] = await Promise.all([
        Sysfs.readAttribute(`${path}/manufacturer`),
        Sysfs.readAttribute(`${path}/product`),
        Sysfs.readAttribute(`${path}/serial`),
        Sysfs.readAttribute(`${path}/version`),
        Sysfs.readAttribute(`${path}/removable`),
        Sysfs.readIntAttribute(`${path}/speed`),
        Sysfs.readAttribute(`${path}/bMaxPower`),
        Sysfs.readIntAttribute(`${path}/busnum`),
        Sysfs.readIntAttribute(`${path}/devnum`),
        Sysfs.readIntAttribute(`${path}/rx_lanes`),
        Sysfs.readIntAttribute(`${path}/tx_lanes`),
        Sysfs.readIntAttribute(`${path}/bNumConfigurations`),
        readByte(`${path}/bDeviceClass`),
        readByte(`${path}/bDeviceSubClass`),
        readByte(`${path}/bDeviceProtocol`),
        Sysfs.readAttribute(`${path}/bNumInterfaces`),
        readInterfaces(path),
    ]);

    return {
        sysfsPath: path,
        busPort: name,
        vendorId: vid & 0xFFFF,
        productId: pid & 0xFFFF,
        manufacturer: manufacturer ?? '',
        product: product ?? '',
        serial: serial ?? '',
        version: (version ?? '').trim(),
        removable: removable ?? '',
        speed: speed ?? 0,
        maxPowerMA: parseMaxPower(maxPowerRaw),
        busNum: busNum ?? 0,
        devNum: devNum ?? 0,
        rxLanes: rxLanes ?? 0,
        txLanes: txLanes ?? 0,
        numInterfaces: numInterfacesStr ? parseInt(numInterfacesStr.trim(), 10) || 0 : 0,
        numConfigurations: numConfigs ?? 0,
        deviceClass,
        deviceSubClass,
        deviceProtocol,
        isHub: deviceClass === 0x09,
        isRootHub: name.startsWith('usb'),
        interfaces,
    };
}

export function displayName(dev) {
    if (dev.product) return dev.product;
    return `${dev.vendorId.toString(16).padStart(4, '0')}:${dev.productId.toString(16).padStart(4, '0')}`;
}

export function deviceSpeedLabel(dev) {
    return speedLabel(dev.speed);
}

export function devicePowerLabel(dev) {
    return powerLabel(dev.maxPowerMA);
}

export async function enumerateUsbDevices() {
    if (!Sysfs.pathExists(USB_DEVICES_PATH)) return [];
    const entries = await Sysfs.listSubdirectories(USB_DEVICES_PATH);
    const devices = await Promise.all(
        entries.map(name => readDevice(`${USB_DEVICES_PATH}/${name}`, name)),
    );
    return devices.filter(d => d !== null);
}
