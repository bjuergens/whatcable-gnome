// USB Power Delivery VDO bit-field decoding.
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

const PRODUCT_TYPE_LABELS = {
    [ProductType.Hub]: 'USB Hub',
    [ProductType.Peripheral]: 'USB Peripheral',
    [ProductType.PassiveCable]: 'Passive Cable',
    [ProductType.ActiveCable]: 'Active Cable',
    [ProductType.AMA]: 'Alternate Mode Adapter',
    [ProductType.VPD]: 'VCONN-Powered Device',
    [ProductType.Other]: 'Other',
};

const CABLE_SPEED_LABELS = {
    [CableSpeed.USB20]: 'USB 2.0',
    [CableSpeed.USB32Gen1]: 'USB 3.2 Gen 1 (5 Gbps)',
    [CableSpeed.USB32Gen2]: 'USB 3.2 Gen 2 (10 Gbps)',
    [CableSpeed.USB4Gen3]: 'USB4 Gen 3 (20/40 Gbps)',
    [CableSpeed.USB4Gen4]: 'USB4 Gen 4 (40/80 Gbps)',
};

const CABLE_CURRENT_LABELS = {
    [CableCurrent.USBDefault]: 'USB Default',
    [CableCurrent.ThreeAmp]: '3A',
    [CableCurrent.FiveAmp]: '5A',
};

const CABLE_CURRENT_AMPS = {
    [CableCurrent.ThreeAmp]: 3.0,
    [CableCurrent.FiveAmp]: 5.0,
};

// Bit-field 29:27 (UFP) and 25:23 (DFP) of the ID Header VDO.
const UFP_PRODUCT_TYPES = [
    ProductType.Undefined,
    ProductType.Hub,
    ProductType.Peripheral,
    ProductType.PassiveCable,
    ProductType.ActiveCable,
    ProductType.AMA,
    ProductType.VPD,
    ProductType.Undefined,
];

const DFP_PRODUCT_TYPES = [
    ProductType.Undefined,
    ProductType.Hub,
    ProductType.Peripheral,
];

// Bits 2:0 of the Cable VDO.
const CABLE_SPEED_BITS = [
    CableSpeed.USB20,
    CableSpeed.USB32Gen1,
    CableSpeed.USB32Gen2,
    CableSpeed.USB4Gen3,
    CableSpeed.USB4Gen4,
];

// Bits 6:5 of the Cable VDO.
const CABLE_CURRENT_BITS = [
    CableCurrent.USBDefault,
    CableCurrent.ThreeAmp,
    CableCurrent.FiveAmp,
];

export function productTypeLabel(type) {
    return PRODUCT_TYPE_LABELS[type] ?? 'Unknown';
}

export function cableSpeedLabel(speed) {
    return CABLE_SPEED_LABELS[speed] ?? 'Unknown';
}

export function cableCurrentLabel(current) {
    return CABLE_CURRENT_LABELS[current] ?? 'Unknown';
}

function cableCurrentMaxAmps(current) {
    return CABLE_CURRENT_AMPS[current] ?? 0.9;
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
    return {
        usbCommCapableAsHost: ((v >>> 31) & 1) === 1,
        usbCommCapableAsDevice: ((v >>> 30) & 1) === 1,
        ufpProductType: UFP_PRODUCT_TYPES[(v >>> 27) & 0x7],
        modalOperation: ((v >>> 26) & 1) === 1,
        dfpProductType: DFP_PRODUCT_TYPES[(v >>> 23) & 0x7] ?? ProductType.Undefined,
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
    const speed = CABLE_SPEED_BITS[v & 0x7] ?? CableSpeed.USB20;
    const currentRating = CABLE_CURRENT_BITS[(v >>> 5) & 0x3] ?? CableCurrent.USBDefault;
    const maxVbusVolts = 20 + 10 * ((v >>> 9) & 0x3);
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
