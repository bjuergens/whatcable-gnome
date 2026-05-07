// Enumerate /sys/bus/usb/devices/.

import * as Sysfs from './sysfs.js';

const USB_DEVICES_PATH = '/sys/bus/usb/devices';

const SPEED_LABELS = [
    [20000, 'USB4 20 Gbps'],
    [10000, 'SuperSpeed+ 10 Gbps'],
    [5000,  'SuperSpeed 5 Gbps'],
    [480,   'High Speed 480 Mbps'],
    [12,    'Full Speed 12 Mbps'],
    [2,     'Low Speed 1.5 Mbps'],
];

function speedLabel(speedMbps) {
    for (const [threshold, label] of SPEED_LABELS) {
        if (speedMbps >= threshold) return label;
    }
    return 'Unknown speed';
}

function powerLabel(maxPowerMA) {
    if (maxPowerMA <= 0) return '';
    if (maxPowerMA >= 1000) return `${(maxPowerMA / 1000).toFixed(1)} W`;
    return `${maxPowerMA} mA`;
}

function parseMaxPower(val) {
    if (!val) return 0;
    const numeric = val.replace(/[^0-9]/g, '');
    return numeric ? parseInt(numeric, 10) || 0 : 0;
}

async function readInterfaces(devPath) {
    const entries = await Sysfs.listSubdirectories(devPath);
    const ifaceEntries = entries.filter(e => e.includes(':'));

    return Promise.all(ifaceEntries.map(async entry => {
        const ifPath = `${devPath}/${entry}`;
        const [cls, sub, proto] = await Promise.all([
            Sysfs.readHexAttribute(`${ifPath}/bInterfaceClass`),
            Sysfs.readHexAttribute(`${ifPath}/bInterfaceSubClass`),
            Sysfs.readHexAttribute(`${ifPath}/bInterfaceProtocol`),
        ]);
        if (cls === null) return null;
        const driver = Sysfs.readSymlinkTargetBasename(`${ifPath}/driver`);
        return {
            number: parseInt(entry.split('.').pop(), 10) || 0,
            classCode: cls & 0xFF,
            subClass: (sub ?? 0) & 0xFF,
            protocol: (proto ?? 0) & 0xFF,
            driver: driver ?? '',
        };
    })).then(list => list.filter(i => i !== null));
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
        Sysfs.readHexAttribute(`${path}/bDeviceClass`),
        Sysfs.readHexAttribute(`${path}/bDeviceSubClass`),
        Sysfs.readHexAttribute(`${path}/bDeviceProtocol`),
        Sysfs.readIntAttribute(`${path}/bNumInterfaces`),
        readInterfaces(path),
    ]);

    const cls = (deviceClass ?? 0) & 0xFF;
    return {
        sysfsPath: path,
        busPort: name,
        vendorId: vid & 0xFFFF,
        productId: pid & 0xFFFF,
        manufacturer: manufacturer ?? '',
        product: product ?? '',
        serial: serial ?? '',
        version: version?.trim() ?? '',
        removable: removable ?? '',
        speed: speed ?? 0,
        maxPowerMA: parseMaxPower(maxPowerRaw),
        busNum: busNum ?? 0,
        devNum: devNum ?? 0,
        rxLanes: rxLanes ?? 0,
        txLanes: txLanes ?? 0,
        numInterfaces: numInterfacesStr ?? 0,
        numConfigurations: numConfigs ?? 0,
        deviceClass: cls,
        deviceSubClass: (deviceSubClass ?? 0) & 0xFF,
        deviceProtocol: (deviceProtocol ?? 0) & 0xFF,
        isHub: cls === 0x09,
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
        entries.map(name => readDevice(`${USB_DEVICES_PATH}/${name}`, name)));
    return devices.filter(d => d !== null);
}
