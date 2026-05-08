// Single entrypoint for the panel indicator: returns the device list as
// JSON-shaped objects ready for validateDevice() / _buildDeviceItem().

import {enumerateUsbDevices} from './usb-device.js';
import {enumerateTypecPorts} from './typec-port.js';
import {enumeratePdPorts, PdProvenance, isPartnerProvenance} from './power-delivery.js';
import {decodeIDHeader, decodeCableVDO, ProductType} from './pd-decoder.js';
import {lookupVendor} from './vendor-db.js';
import * as DeviceSummary from './device-summary.js';

// USB-C cable e-marker info derived from typec cable identity VDOs.
function cableInfo(cable) {
    if (!cable) return null;
    const idHeader = cable.identity?.vdos?.id_header;
    // For cables, "Cable VDO" sits in product_type_vdo1 (PD VDO4) — see
    // USB PD r3.x spec, Discover Identity response for SOP'.
    const cableVdoRaw = cable.identity?.vdos?.product_type_vdo1;
    const vendorId = cable.identity?.vendorId ?? 0;
    const base = {
        cableType: cable.type ?? '',
        plugType: cable.plugType ?? '',
        speed: null,
        currentRating: null,
        maxWatts: 0,
        isActive: cable.type === 'active',
        isPassive: cable.type === 'passive',
        vendorId,
        vendorName: vendorId ? lookupVendor(vendorId) : null,
    };
    if (idHeader === undefined || cableVdoRaw === undefined) return base;

    const active = decodeIDHeader(idHeader).ufpProductType === ProductType.ActiveCable;
    const cableVdo = decodeCableVDO(cableVdoRaw, active);
    return {
        ...base,
        speed: cableVdo.speed,
        currentRating: cableVdo.currentRating,
        maxWatts: cableVdo.maxWatts,
        isActive: cableVdo.isActive,
        isPassive: !cableVdo.isActive,
    };
}

// Return the PD port that represents the *charger's* offer for this typec
// port. Never return a port-self entry: its source caps describe what the
// host can advertise, not what the charger provides, and surfacing it as
// "charger max" is the bug this provenance tagging exists to prevent.
function pairPdPort(tcPort, pdPorts, typecCount) {
    // Preferred: kernel's own typec→PD symlink (typec/portN/usb_power_delivery).
    // That symlink targets the *port's* PD entry (port-self), so a name match
    // is only useful as a hint — we still gate on provenance below.
    if (tcPort.pdPortName) {
        const named = pdPorts.find(pd => pd.name === tcPort.pdPortName);
        if (named && isPartnerProvenance(named.provenance)) return named;
    }
    // UCSI: partner exposes its PDOs inline; tagged Partner at read time.
    const partnerPds = tcPort.partner?.pdPorts ?? [];
    const partnerInline = partnerPds.find(p => p.sourceCapabilities.length > 0)
        ?? partnerPds[0];
    if (partnerInline) return partnerInline;
    // Class dir may carry a partner-owned entry even without a typec symlink.
    const partnerClass = pdPorts.find(p => p.provenance === PdProvenance.PartnerClass);
    if (partnerClass) return partnerClass;
    // Topology fallback: one typec port, one unclassified PD entry. Only
    // accept if we couldn't identify it as port-self; otherwise we'd be
    // surfacing the host's own caps as the charger's.
    if (pdPorts.length === 1 && typecCount === 1
        && pdPorts[0].provenance !== PdProvenance.PortSelf)
        return pdPorts[0];
    return null;
}

export async function collectDevices() {
    const [usbDevices, typecPorts, pdPorts] = await Promise.all([
        enumerateUsbDevices(),
        enumerateTypecPorts(),
        enumeratePdPorts(),
    ]);

    const summaries = [];

    for (const tc of typecPorts) {
        const pd = pairPdPort(tc, pdPorts, typecPorts.length);
        const cable = cableInfo(tc.cable);
        summaries.push(DeviceSummary.fromTypeCPort(tc, pd, cable));
    }

    for (const dev of usbDevices) {
        if (dev.isRootHub) continue;
        summaries.push(DeviceSummary.fromUsbDevice(dev));
    }

    return summaries;
}
