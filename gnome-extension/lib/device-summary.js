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
    // Healthy charging is shown in the headline (⚡ N/M W); no extra row.
    return null;
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

const EMOJI_BY_DEVICE_TYPE = [
    ['Audio',         '🎧'],
    ['HID',           '⌨'],
    ['Mass Storage',  '💾'],
    ['Video',         '📷'],
    ['Wireless',      '📶'],
    ['Printer',       '🖨'],
];

function typeEmoji(isHub, deviceType) {
    if (isHub) return '🔀';
    for (const [keyword, emoji] of EMOJI_BY_DEVICE_TYPE) {
        if (deviceType.includes(keyword)) return emoji;
    }
    return '';
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

    // Class 0xEF (Miscellaneous) is the IAD/multi-function umbrella used by
    // webcams, modern audio, etc. Treat it like 0/0xFF and derive the type
    // from interfaces — "Miscellaneous" tells the user nothing useful.
    const cls = dev.deviceClass;
    const useInterfaces = cls === 0 || cls === 0xFF || cls === 0xEF;
    let deviceType = '';
    if (!useInterfaces) deviceType = ClassDB.className(cls);
    else if (dev.interfaces.length > 0)
        deviceType = deviceTypeFromInterfaces(dev.interfaces);

    const subtitle = [vendorName, deviceType].filter(Boolean).join(' · ');

    const baseHeadline = dev.product || vidPid(dev.vendorId, dev.productId);
    const emoji = typeEmoji(dev.isHub, deviceType);
    const headline = emoji ? `${emoji} ${baseHeadline}` : baseHeadline;

    // One condensed specs row: "USB 2.10 · 480 Mbps · 500 mA". Empty parts
    // omitted; speed always present even at 0 ("Unknown speed") since the
    // bullet would otherwise dangle as "USB 2.10 · ".
    const specs = [];
    if (dev.version) specs.push(`USB ${dev.version}`);
    specs.push(speedLabel(dev.speed));
    if (dev.maxPowerMA > 0) specs.push(powerLabel(dev.maxPowerMA));
    const bullets = [specs.join(' · ')];

    if (dev.serial) bullets.push(`Serial: ${dev.serial}`);
    if (dev.removable === 'removable') bullets.push('🔄 Removable');
    else if (dev.removable === 'fixed') bullets.push('🔩 Built-in');

    const drivers = [...new Set(
        dev.interfaces.map(i => i.driver).filter(Boolean))];
    if (drivers.length > 0) bullets.push(`⚙ ${drivers.join(', ')}`);

    // VID:PID stays in Details unconditionally; on the main view we only show
    // it when the subtitle didn't decode a vendor name (so the user has *some*
    // identifier to google with).
    if (!vendorName)
        bullets.push(`VID:PID ${vidPid(dev.vendorId, dev.productId)}`);

    return {
        category: dev.isHub ? 'hub' : 'usb',
        headline,
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
    // No decoded identity: stay silent — the bullets below already make it
    // obvious that something is attached.
    if (idHeader === undefined) return '';

    const hdr = decodeIDHeader(idHeader);
    const productLabel = productTypeLabel(hdr.ufpProductType);
    const vendorLabel = lookupVendor(hdr.vendorId);
    return vendorLabel ? `${vendorLabel} — ${productLabel}` : productLabel;
}

// Single condensed cable line: "🔌 Passive · 5 Gbps · 3 A · 60W · Vendor".
// Empty parts are omitted; type is always present (passive/active/unknown).
function cableBullet(cable) {
    const parts = [];
    if (cable.cableType === 'active') parts.push('Active');
    else if (cable.cableType === 'passive') parts.push('Passive');
    if (cable.speed) parts.push(cableSpeedLabel(cable.speed));
    if (cable.currentRating) parts.push(cableCurrentLabel(cable.currentRating));
    if (cable.maxWatts > 0) parts.push(`${cable.maxWatts}W`);
    if (cable.vendorName) parts.push(cable.vendorName);
    return parts.length > 0 ? `🔌 ${parts.join(' · ')}` : null;
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
            orientation: port.orientation && port.orientation !== 'unknown'
                ? port.orientation : null,
            connected: isConnected(port),
        },
    };

    if (!isConnected(port)) {
        summary.subtitle = 'Nothing connected';
        return summary;
    }

    summary.subtitle = partnerSubtitle(port.partner);

    // Combine PD revision and data role into one row, e.g. "PD 2.0 · 🖥 Host".
    const dataRole = currentDataRole(port);
    const roleLabel = dataRole === 'host' ? '🖥 Host'
        : dataRole === 'device' ? '📱 Device' : null;
    const pdAndRole = [
        port.pdRevision ? `PD ${port.pdRevision}` : null,
        roleLabel,
    ].filter(Boolean).join(' · ');
    if (pdAndRole) summary.bullets.push(pdAndRole);

    // Partner advertises its own PD revision; surface only when it diverges
    // from the port's, since that's the case where it tells you something new.
    const partnerPd = port.partner?.pdRevision;
    if (partnerPd && partnerPd !== '0.0' && partnerPd !== port.pdRevision)
        summary.bullets.push(`Partner PD ${partnerPd}`);

    if (port.partner) {
        const idHeader = port.partner.identity?.vdos?.id_header;
        const hdr = idHeader !== undefined ? decodeIDHeader(idHeader) : null;
        const vendorName = hdr ? lookupVendor(hdr.vendorId) : null;
        if (vendorName) summary.bullets.push(`🏷 ${vendorName}`);
        summary.partner = {
            type: port.partner.type,
            productType: hdr?.ufpProductType ?? null,
            productTypeLabel: hdr ? productTypeLabel(hdr.ufpProductType) : null,
            vendorId: hdr ? hex16(hdr.vendorId) : null,
            vendorName,
            pdRevision: port.partner.pdRevision || null,
        };
    }

    if (cable) {
        const line = cableBullet(cable);
        if (line) summary.bullets.push(line);
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
        // Active PDO is not exposed by /sys today (see power-delivery.js); fall
        // back to maxW/maxW so the headline reads "⚡ 65/65 W" until the kernel
        // surfaces it, at which point this becomes "⚡ <active>/<max> W".
        const active = pdPort.sourceCapabilities.find(p => p.isActive);
        const activeW = active ? Math.floor(active.powerMW / 1000) : maxW;
        // Power-direction arrow: ← when this port is sinking (charging), →
        // when sourcing (powering a peripheral). Empty when role is unknown.
        const powerRole = currentPowerRole(port);
        const arrow = powerRole === 'sink' ? '←' : powerRole === 'source' ? '→' : '';
        if (maxW > 0)
            summary.headline = `${summary.headline} — ⚡ ${arrow}${activeW}/${maxW} W`;
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
