// Plain-English per-device summary, consumed by the panel indicator.

import {currentDataRole, currentPowerRole, isConnected} from './typec-port.js';
import {lookupVendor} from './vendor-db.js';
import * as ClassDB from './usb-class-db.js';
import {decodeIDHeader, productTypeLabel, cableSpeedLabel, cableCurrentLabel} from './pd-decoder.js';

const hex16 = id => `0x${id.toString(16).padStart(4, '0')}`;
const vidPid = (v, p) => `${v.toString(16).padStart(4, '0')}:${p.toString(16).padStart(4, '0')}`;

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

// Identify charging bottlenecks (cable limit vs charger limit vs device).
function chargingDiagnostic(pdPort, cable) {
    if (!pdPort || pdPort.sourceCapabilities.length === 0) return null;
    const chargerMaxW = Math.floor(pdPort.maxSourcePowerMW / 1000);
    if (chargerMaxW <= 0) return null;

    // activeW is the actually-negotiated PDO power. Until the kernel exposes
    // the active PDO via /sys (see TODO in power-delivery.js#parsePdo), this
    // is always 0 and the activeW branch below stays dormant.
    const active = pdPort.sourceCapabilities.find(p => p.isActive);
    const activeW = active ? Math.floor(active.powerMW / 1000) : 0;
    const cableMaxW = cable?.maxWatts > 0 ? cable.maxWatts : 0;

    if (cableMaxW > 0 && cableMaxW < chargerMaxW) {
        return {
            summary: 'Cable is limiting charging speed',
            detail: `Cable rated for ${cableMaxW}W, but charger can deliver ${chargerMaxW}W`,
            isWarning: true,
        };
    }
    if (activeW > 0 && activeW < chargerMaxW * 0.8) {
        return {
            summary: `Charging at ${activeW}W`,
            detail: `Charging at ${activeW}W (charger can do up to ${chargerMaxW}W)`,
            isWarning: false,
        };
    }
    return {
        summary: `Charging well at ${activeW || chargerMaxW}W`,
        detail: '',
        isWarning: false,
    };
}

const ICON_BY_DEVICE_TYPE = [
    ['Audio',         'audio-card'],
    ['HID',           'input-keyboard'],
    ['Mass Storage',  'drive-removable-media'],
    ['Video',         'camera-web'],
    ['Wireless',      'network-wireless'],
    ['Printer',       'printer'],
];

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

    const bullets = [speedLabel(dev.speed)];
    if (dev.maxPowerMA > 0) bullets.push(`Power: ${powerLabel(dev.maxPowerMA)}`);
    if (dev.version) bullets.push(`USB ${dev.version}`);
    if (dev.serial) bullets.push(`Serial: ${dev.serial}`);
    if (dev.removable === 'removable') bullets.push('Removable');
    else if (dev.removable === 'fixed') bullets.push('Built-in');

    const drivers = [...new Set(
        dev.interfaces.map(i => i.driver).filter(Boolean))];
    if (drivers.length > 0) bullets.push(`Drivers: ${drivers.join(', ')}`);

    bullets.push(`VID:PID ${vidPid(dev.vendorId, dev.productId)}`);

    return {
        category: dev.isHub ? 'hub' : 'usb',
        headline: dev.product || vidPid(dev.vendorId, dev.productId),
        subtitle,
        icon: pickIcon(dev.isHub, deviceType),
        bullets,
        usb: {
            vendorId: hex16(dev.vendorId),
            productId: hex16(dev.productId),
            manufacturer: dev.manufacturer,
            product: dev.product,
            speed: dev.speed,
            speedLabel: speedLabel(dev.speed),
            version: dev.version,
            maxPowerMA: dev.maxPowerMA,
            serial: dev.serial,
            removable: dev.removable,
            bus: dev.busNum,
            device: dev.devNum,
            isHub: dev.isHub,
            interfaces: dev.interfaces.map(i => ({
                classCode: i.classCode,
                classLabel: ClassDB.className(i.classCode),
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
    if (cable.cableType === 'active') bullets.push('Active cable');
    else if (cable.cableType === 'passive') bullets.push('Passive cable');
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
    if (port.partner?.pdRevision && port.partner.pdRevision !== port.pdRevision)
        summary.bullets.push(`Partner PD revision: ${port.partner.pdRevision}`);
    if (port.orientation && port.orientation !== 'unknown')
        summary.bullets.push(`Plug orientation: ${port.orientation}`);

    if (port.partner) {
        const idHeader = port.partner.identity?.vdos?.id_header;
        const hdr = idHeader !== undefined ? decodeIDHeader(idHeader) : null;
        summary.partner = {
            type: port.partner.type,
            productType: hdr?.ufpProductType ?? null,
            productTypeLabel: hdr ? productTypeLabel(hdr.ufpProductType) : null,
            vendorId: hdr ? hex16(hdr.vendorId) : null,
            vendorName: hdr ? lookupVendor(hdr.vendorId) : null,
            pdRevision: port.partner.pdRevision || null,
        };
    }

    if (cable) {
        summary.bullets.push(...cableBullets(cable));
        if (port.cable?.pdRevision && port.cable.pdRevision !== port.pdRevision)
            summary.bullets.push(`Cable PD revision: ${port.cable.pdRevision}`);
        summary.cable = {
            type: cable.cableType,
            speed: cable.speed,
            speedLabel: cable.speed ? cableSpeedLabel(cable.speed) : null,
            currentRating: cable.currentRating,
            currentRatingLabel: cable.currentRating ? cableCurrentLabel(cable.currentRating) : null,
            maxWatts: cable.maxWatts,
            vendorId: hex16(cable.vendorId),
            vendorName: cable.vendorName,
            pdRevision: port.cable?.pdRevision ?? null,
        };
    }

    if (pdPort?.sourceCapabilities.length > 0) {
        const maxW = Math.floor(pdPort.maxSourcePowerMW / 1000);
        summary.bullets.push(`Charger max: ${maxW}W`);
        if (pdPort.version && pdPort.revision !== port.pdRevision)
            summary.bullets.push(`PD spec version: ${pdPort.version}`);

        summary.powerDelivery = {
            sourceCapabilities: pdPort.sourceCapabilities.map(p => ({
                type: p.type,
                typeLabel: p.typeLabel,
                voltageMV: p.voltageMV,
                minVoltageMV: p.minVoltageMV,
                currentMA: p.currentMA,
                currentMA9to15: p.currentMA9to15,
                currentMA15to20: p.currentMA15to20,
                peakCurrentMA: p.peakCurrentMA,
                ppsPowerLimited: p.ppsPowerLimited,
                powerMW: p.powerMW,
                active: p.isActive,
            })),
            maxPowerMW: pdPort.maxSourcePowerMW,
            revision: pdPort.revision,
            version: pdPort.version,
        };
    }

    const diag = chargingDiagnostic(pdPort, cable);
    if (diag) summary.charging = diag;

    return summary;
}
