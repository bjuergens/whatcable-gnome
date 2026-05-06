// Plain-English per-device summary. Direct port of src/core/DeviceSummary.cpp.
// Output shape matches what the panel indicator's validateDevice() consumes.

import {displayName, deviceSpeedLabel, devicePowerLabel} from './usb-device.js';
import {currentDataRole, currentPowerRole, isConnected} from './typec-port.js';
import {lookupVendor} from './vendor-db.js';
import * as ClassDB from './usb-class-db.js';
import {decodeIDHeader, productTypeLabel, cableSpeedLabel, cableCurrentLabel} from './pd-decoder.js';
import * as ChargingDiagnostic from './charging-diagnostic.js';

function vidPidHex(vid, pid) {
    return `${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`;
}

function pickIcon(isHub, deviceType) {
    if (isHub) return 'network-wired';
    if (deviceType.includes('Audio'))         return 'audio-card';
    if (deviceType.includes('HID'))           return 'input-keyboard';
    if (deviceType.includes('Mass Storage'))  return 'drive-removable-media';
    if (deviceType.includes('Video'))         return 'camera-web';
    if (deviceType.includes('Wireless'))      return 'network-wireless';
    if (deviceType.includes('Printer'))       return 'printer';
    return 'drive-removable-media-usb';
}

export function fromUsbDevice(dev) {
    const vendorName = lookupVendor(dev.vendorId);
    const hasVendorName = !vendorName.startsWith('0x');

    let deviceType = '';
    if (dev.deviceClass !== 0 && dev.deviceClass !== 0xFF) {
        deviceType = ClassDB.className(dev.deviceClass);
    } else if (dev.interfaces.length > 0) {
        const types = [];
        for (const iface of dev.interfaces) {
            const t = ClassDB.className(iface.classCode);
            if (!types.includes(t) && t !== 'Composite' && !t.startsWith('0x'))
                types.push(t);
        }
        deviceType = types.join(', ');
    }

    const subtitleParts = [];
    if (hasVendorName) subtitleParts.push(vendorName);
    if (deviceType) subtitleParts.push(deviceType);
    const subtitle = subtitleParts.join(' · ');

    const bullets = [deviceSpeedLabel(dev)];
    if (dev.maxPowerMA > 0)
        bullets.push(`Power: ${devicePowerLabel(dev)}`);
    if (dev.version)
        bullets.push(`USB ${dev.version}`);
    if (dev.serial)
        bullets.push(`Serial: ${dev.serial}`);
    if (dev.removable === 'removable') bullets.push('Removable');
    else if (dev.removable === 'fixed') bullets.push('Built-in');

    const drivers = [];
    for (const iface of dev.interfaces) {
        if (iface.driver && !drivers.includes(iface.driver))
            drivers.push(iface.driver);
    }
    if (drivers.length > 0)
        bullets.push(`Drivers: ${drivers.join(', ')}`);

    bullets.push(`VID:PID ${vidPidHex(dev.vendorId, dev.productId)}`);

    return {
        category: dev.isHub ? 'hub' : 'usb',
        headline: displayName(dev),
        subtitle,
        icon: pickIcon(dev.isHub, deviceType),
        bullets,
        usb: {
            vendorId: `0x${dev.vendorId.toString(16).padStart(4, '0')}`,
            productId: `0x${dev.productId.toString(16).padStart(4, '0')}`,
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

    if (port.partner) {
        if (port.partner.identity && port.partner.identity.vdos.length > 0) {
            const hdr = decodeIDHeader(port.partner.identity.vdos[0]);
            const productLabel = productTypeLabel(hdr.ufpProductType);
            const vendorLabel = lookupVendor(hdr.vendorId);
            const hasVendor = !vendorLabel.startsWith('0x');
            summary.subtitle = hasVendor
                ? `${vendorLabel} — ${productLabel}`
                : productLabel;
        } else {
            summary.subtitle = 'Device connected';
        }
    }

    const dataStr = currentDataRole(port);
    const powerStr = currentPowerRole(port);
    if (dataStr || powerStr) {
        const parts = [];
        if (dataStr)  parts.push(`Data: ${dataStr}`);
        if (powerStr) parts.push(`Power: ${powerStr}`);
        summary.bullets.push(parts.join(', '));
    }
    if (port.powerOpMode)
        summary.bullets.push(`Power mode: ${port.powerOpMode}`);
    if (port.pdRevision)
        summary.bullets.push(`PD revision: ${port.pdRevision}`);
    if (port.orientation && port.orientation !== 'unknown')
        summary.bullets.push(`Plug orientation: ${port.orientation}`);

    if (cable) {
        if (cable.speed)
            summary.bullets.push(`Cable speed: ${cableSpeedLabel(cable.speed)}`);
        if (cable.currentRating)
            summary.bullets.push(`Cable current: ${cableCurrentLabel(cable.currentRating)}`);
        if (cable.maxWatts > 0)
            summary.bullets.push(`Cable max power: ${cable.maxWatts}W`);
        if (cable.isActive) summary.bullets.push('Active cable');
        else if (cable.isPassive) summary.bullets.push('Passive cable');
        if (cable.vendorName && !cable.vendorName.startsWith('0x'))
            summary.bullets.push(`Cable vendor: ${cable.vendorName}`);

        summary.cable = {
            type: cable.cableType,
            speed: cable.speed ? cableSpeedLabel(cable.speed) : null,
            current: cable.currentRating ? cableCurrentLabel(cable.currentRating) : null,
            maxWatts: cable.maxWatts,
            vendorId: `0x${cable.vendorId.toString(16).padStart(4, '0')}`,
            vendorName: cable.vendorName,
        };
    }

    if (pdPort && pdPort.sourceCapabilities.length > 0) {
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
