// Plain-English per-device summary.
// Output shape matches what the panel indicator's validateDevice() consumes.

import {displayName, deviceSpeedLabel, devicePowerLabel} from './usb-device.js';
import {currentDataRole, currentPowerRole, isConnected} from './typec-port.js';
import {lookupVendor, formatHex16} from './vendor-db.js';
import * as ClassDB from './usb-class-db.js';
import {decodeIDHeader, productTypeLabel, cableSpeedLabel, cableCurrentLabel} from './pd-decoder.js';
import * as ChargingDiagnostic from './charging-diagnostic.js';

const ICON_BY_DEVICE_TYPE = [
    ['Audio',         'audio-card'],
    ['HID',           'input-keyboard'],
    ['Mass Storage',  'drive-removable-media'],
    ['Video',         'camera-web'],
    ['Wireless',      'network-wireless'],
    ['Printer',       'printer'],
];

function vidPidHex(vid, pid) {
    return `${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`;
}

function pickIcon(isHub, deviceType) {
    if (isHub) return 'network-wired';
    for (const [keyword, icon] of ICON_BY_DEVICE_TYPE) {
        if (deviceType.includes(keyword)) return icon;
    }
    return 'drive-removable-media-usb';
}

function deviceTypeFromInterfaces(interfaces) {
    const types = [];
    for (const iface of interfaces) {
        const t = ClassDB.className(iface.classCode);
        if (!types.includes(t) && t !== 'Composite' && !t.startsWith('0x'))
            types.push(t);
    }
    return types.join(', ');
}

export function fromUsbDevice(dev) {
    const vendorName = lookupVendor(dev.vendorId);

    let deviceType = '';
    if (dev.deviceClass !== 0 && dev.deviceClass !== 0xFF)
        deviceType = ClassDB.className(dev.deviceClass);
    else if (dev.interfaces.length > 0)
        deviceType = deviceTypeFromInterfaces(dev.interfaces);

    const subtitle = [vendorName, deviceType].filter(Boolean).join(' · ');

    const bullets = [deviceSpeedLabel(dev)];
    if (dev.maxPowerMA > 0) bullets.push(`Power: ${devicePowerLabel(dev)}`);
    if (dev.version) bullets.push(`USB ${dev.version}`);
    if (dev.serial) bullets.push(`Serial: ${dev.serial}`);
    if (dev.removable === 'removable') bullets.push('Removable');
    else if (dev.removable === 'fixed') bullets.push('Built-in');

    const drivers = [...new Set(
        dev.interfaces.map(i => i.driver).filter(Boolean))];
    if (drivers.length > 0) bullets.push(`Drivers: ${drivers.join(', ')}`);

    bullets.push(`VID:PID ${vidPidHex(dev.vendorId, dev.productId)}`);

    return {
        category: dev.isHub ? 'hub' : 'usb',
        headline: displayName(dev),
        subtitle,
        icon: pickIcon(dev.isHub, deviceType),
        bullets,
        usb: {
            vendorId: formatHex16(dev.vendorId),
            productId: formatHex16(dev.productId),
            manufacturer: dev.manufacturer,
            product: dev.product,
            speed: dev.speed,
            speedLabel: deviceSpeedLabel(dev),
            version: dev.version,
            maxPowerMA: dev.maxPowerMA,
            serial: dev.serial,
            removable: dev.removable,
            bus: dev.busNum,
            device: dev.devNum,
            isHub: dev.isHub,
            interfaces: dev.interfaces.map(i => ({
                class: ClassDB.className(i.classCode),
                driver: i.driver,
            })),
        },
    };
}

function partnerSubtitle(partner) {
    if (!partner) return '';
    const idHeader = partner.identity?.vdos?.id_header;
    if (idHeader === undefined) return 'Device connected';

    const hdr = decodeIDHeader(idHeader);
    const productLabel = productTypeLabel(hdr.ufpProductType);
    const vendorLabel = lookupVendor(hdr.vendorId);
    return vendorLabel ? `${vendorLabel} — ${productLabel}` : productLabel;
}

function cableBullets(cable) {
    const bullets = [];
    if (cable.speed) bullets.push(`Cable speed: ${cableSpeedLabel(cable.speed)}`);
    if (cable.currentRating) bullets.push(`Cable current: ${cableCurrentLabel(cable.currentRating)}`);
    if (cable.maxWatts > 0) bullets.push(`Cable max power: ${cable.maxWatts}W`);
    if (cable.isActive) bullets.push('Active cable');
    else if (cable.isPassive) bullets.push('Passive cable');
    if (cable.vendorName) bullets.push(`Cable vendor: ${cable.vendorName}`);
    return bullets;
}

export function fromTypeCPort(port, pdPort, cable) {
    const summary = {
        category: 'typec',
        headline: `USB-C Port ${port.portNumber}`,
        subtitle: '',
        icon: 'plug',
        bullets: [],
        typec: {
            port: port.portNumber,
            dataRole: currentDataRole(port),
            powerRole: currentPowerRole(port),
            portType: port.portType,
            powerOpMode: port.powerOpMode,
            connected: isConnected(port),
        },
    };

    if (!isConnected(port)) {
        summary.subtitle = 'Nothing connected';
        return summary;
    }

    summary.subtitle = partnerSubtitle(port.partner);

    const dataStr = currentDataRole(port);
    const powerStr = currentPowerRole(port);
    if (dataStr || powerStr) {
        const parts = [];
        if (dataStr)  parts.push(`Data: ${dataStr}`);
        if (powerStr) parts.push(`Power: ${powerStr}`);
        summary.bullets.push(parts.join(', '));
    }
    if (port.powerOpMode) summary.bullets.push(`Power mode: ${port.powerOpMode}`);
    if (port.pdRevision) summary.bullets.push(`PD revision: ${port.pdRevision}`);
    if (port.orientation && port.orientation !== 'unknown')
        summary.bullets.push(`Plug orientation: ${port.orientation}`);

    if (cable) {
        summary.bullets.push(...cableBullets(cable));
        summary.cable = {
            type: cable.cableType,
            speed: cable.speed ? cableSpeedLabel(cable.speed) : null,
            current: cable.currentRating ? cableCurrentLabel(cable.currentRating) : null,
            maxWatts: cable.maxWatts,
            vendorId: formatHex16(cable.vendorId),
            vendorName: cable.vendorName,
        };
    }

    if (pdPort?.sourceCapabilities.length > 0) {
        const maxW = Math.floor(pdPort.maxSourcePowerMW / 1000);
        summary.bullets.push(`Charger max: ${maxW}W`);

        summary.powerDelivery = {
            sourceCapabilities: pdPort.sourceCapabilities.map(p => ({
                type: p.typeLabel,
                voltageMV: p.voltageMV,
                currentMA: p.currentMA,
                powerMW: p.powerMW,
                active: p.isActive,
            })),
            maxPowerMW: pdPort.maxSourcePowerMW,
        };
    }

    if (pdPort) {
        const diag = ChargingDiagnostic.evaluate(pdPort, cable);
        if (diag) {
            summary.charging = {
                summary: diag.summary,
                detail: diag.detail,
                isWarning: diag.isWarning,
            };
        }
    }

    return summary;
}
