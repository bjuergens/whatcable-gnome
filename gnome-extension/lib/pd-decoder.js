// USB Power Delivery VDO bit-field decoding. Direct port of src/core/PDDecoder.cpp.
// JS bitwise ops produce signed int32; use `>>> 0` and `>>>` to keep VDOs unsigned.

export const ProductType = Object.freeze({
    Undefined: 'undefined',
    Hub: 'hub',
    Peripheral: 'peripheral',
    PassiveCable: 'passive-cable',
    ActiveCable: 'active-cable',
    AMA: 'ama',
    VPD: 'vpd',
    Other: 'other',
});

export const CableSpeed = Object.freeze({
    USB20: 'usb20',
    USB32Gen1: 'usb32-gen1',
    USB32Gen2: 'usb32-gen2',
    USB4Gen3: 'usb4-gen3',
    USB4Gen4: 'usb4-gen4',
});

export const CableCurrent = Object.freeze({
    USBDefault: 'usb-default',
    ThreeAmp: 'three-amp',
    FiveAmp: 'five-amp',
});

export function productTypeLabel(type) {
    switch (type) {
    case ProductType.Hub:          return 'USB Hub';
    case ProductType.Peripheral:   return 'USB Peripheral';
    case ProductType.PassiveCable: return 'Passive Cable';
    case ProductType.ActiveCable:  return 'Active Cable';
    case ProductType.AMA:          return 'Alternate Mode Adapter';
    case ProductType.VPD:          return 'VCONN-Powered Device';
    case ProductType.Other:        return 'Other';
    default:                       return 'Unknown';
    }
}

export function cableSpeedLabel(speed) {
    switch (speed) {
    case CableSpeed.USB20:     return 'USB 2.0';
    case CableSpeed.USB32Gen1: return 'USB 3.2 Gen 1 (5 Gbps)';
    case CableSpeed.USB32Gen2: return 'USB 3.2 Gen 2 (10 Gbps)';
    case CableSpeed.USB4Gen3:  return 'USB4 Gen 3 (20/40 Gbps)';
    case CableSpeed.USB4Gen4:  return 'USB4 Gen 4 (40/80 Gbps)';
    default:                   return 'Unknown';
    }
}

export function cableCurrentLabel(current) {
    switch (current) {
    case CableCurrent.USBDefault: return 'USB Default';
    case CableCurrent.ThreeAmp:   return '3A';
    case CableCurrent.FiveAmp:    return '5A';
    default:                      return 'Unknown';
    }
}

export function cableCurrentMaxAmps(current) {
    switch (current) {
    case CableCurrent.ThreeAmp: return 3.0;
    case CableCurrent.FiveAmp:  return 5.0;
    default:                    return 0.9;
    }
}

// USB PD 3.x ID Header VDO (vdo[0]):
//   31:    USB host capable
//   30:    USB device capable
//   29-27: UFP product type
//   26:    Modal operation
//   25-23: DFP product type
//   15-0:  Vendor ID
export function decodeIDHeader(vdo) {
    const v = vdo >>> 0;
    const ufpBits = (v >>> 27) & 0x7;
    const dfpBits = (v >>> 23) & 0x7;

    let ufpProductType = ProductType.Undefined;
    switch (ufpBits) {
    case 1: ufpProductType = ProductType.Hub; break;
    case 2: ufpProductType = ProductType.Peripheral; break;
    case 3: ufpProductType = ProductType.PassiveCable; break;
    case 4: ufpProductType = ProductType.ActiveCable; break;
    case 5: ufpProductType = ProductType.AMA; break;
    case 6: ufpProductType = ProductType.VPD; break;
    }

    let dfpProductType = ProductType.Undefined;
    switch (dfpBits) {
    case 1: dfpProductType = ProductType.Hub; break;
    case 2: dfpProductType = ProductType.Peripheral; break;
    }

    return {
        usbCommCapableAsHost: ((v >>> 31) & 1) === 1,
        usbCommCapableAsDevice: ((v >>> 30) & 1) === 1,
        modalOperation: ((v >>> 26) & 1) === 1,
        ufpProductType,
        dfpProductType,
        vendorId: v & 0xFFFF,
    };
}

// USB PD 3.x Cable VDO:
//   2-0:   Speed
//   4:     VBUS through cable
//   6-5:   Current capability
//   10-9:  Max VBUS voltage
export function decodeCableVDO(vdo, isActive) {
    const v = vdo >>> 0;

    let speed = CableSpeed.USB20;
    switch (v & 0x7) {
    case 0: speed = CableSpeed.USB20; break;
    case 1: speed = CableSpeed.USB32Gen1; break;
    case 2: speed = CableSpeed.USB32Gen2; break;
    case 3: speed = CableSpeed.USB4Gen3; break;
    case 4: speed = CableSpeed.USB4Gen4; break;
    }

    let currentRating = CableCurrent.USBDefault;
    switch ((v >>> 5) & 0x3) {
    case 0: currentRating = CableCurrent.USBDefault; break;
    case 1: currentRating = CableCurrent.ThreeAmp; break;
    case 2: currentRating = CableCurrent.FiveAmp; break;
    }

    let maxVbusVolts = 20;
    switch ((v >>> 9) & 0x3) {
    case 0: maxVbusVolts = 20; break;
    case 1: maxVbusVolts = 30; break;
    case 2: maxVbusVolts = 40; break;
    case 3: maxVbusVolts = 50; break;
    }

    const amps = cableCurrentMaxAmps(currentRating);
    return {
        speed,
        currentRating,
        vbusThroughCable: ((v >>> 4) & 1) === 1,
        maxVbusVolts,
        isActive,
        maxWatts: Math.floor(maxVbusVolts * amps),
    };
}
