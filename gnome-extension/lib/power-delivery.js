// Enumerate /sys/class/usb_power_delivery/.

import {sysfsToJson, asString, asInt, symlinkTarget} from './sysfsToJson.js';

const PD_PATH = '/sys/class/usb_power_delivery';

// Where a PD port's data came from. The kernel exposes "what *this* port can
// source/sink" and "what the *partner* advertised" through the same sysfs
// shape, and confusing the two means displaying the local port's mandatory
// 5V/3A as if it were the charger's offer (see UCSI bug). Tag at read time so
// downstream code can refuse to misattribute.
export const PdProvenance = Object.freeze({
    Partner: 'partner',
    PartnerClass: 'partner-class',
    PortSelf: 'port-self',
    Unknown: 'unknown',
});

export function isPartnerProvenance(p) {
    return p === PdProvenance.Partner || p === PdProvenance.PartnerClass;
}

export const PdoType = Object.freeze({
    FixedSupply: 'fixed',
    Battery: 'battery',
    VariableSupply: 'variable',
    PPS: 'pps',
    AVS: 'avs',
    Unknown: 'unknown',
});

const PDO_TYPE_LABELS = {
    [PdoType.FixedSupply]: 'Fixed',
    [PdoType.Battery]: 'Battery',
    [PdoType.VariableSupply]: 'Variable',
    [PdoType.PPS]: 'PPS',
    [PdoType.AVS]: 'AVS',
};

// PDO type is encoded in the directory-name suffix ("1:fixed_supply" →
// fixed_supply). There is no `type` attribute file inside the PDO directory.
const PDO_TYPE_FROM_DIRNAME = {
    fixed_supply: PdoType.FixedSupply,
    battery: PdoType.Battery,
    variable_supply: PdoType.VariableSupply,
    programmable_supply: PdoType.PPS,
    spr_adjustable_voltage_supply: PdoType.AVS,
};

function pdoTypeLabel(type) {
    return PDO_TYPE_LABELS[type] ?? 'Unknown';
}

function splitDirname(name) {
    const colon = name.lastIndexOf(':');
    if (colon < 0) return {index: parseInt(name, 10) || 0, suffix: name};
    return {
        index: parseInt(name.slice(0, colon), 10) || 0,
        suffix: name.slice(colon + 1),
    };
}

const watts = (mV, mA) => mV > 0 && mA > 0 ? Math.floor((mV * mA) / 1000) : 0;

function readFixed(pdo, role) {
    const currentAttr = role === 'sink' ? 'operational_current' : 'maximum_current';
    const voltageMV = asInt(pdo.voltage) ?? 0;
    const currentMA = asInt(pdo[currentAttr]) ?? 0;
    const peak = role === 'source' ? asInt(pdo.peak_current) : null;
    return {
        voltageMV, currentMA, powerMW: watts(voltageMV, currentMA),
        peakCurrentMA: peak ?? 0,
    };
}

function readVariable(pdo, role) {
    const currentAttr = role === 'sink' ? 'operational_current' : 'maximum_current';
    const voltageMV = asInt(pdo.maximum_voltage) ?? 0;
    const currentMA = asInt(pdo[currentAttr]) ?? 0;
    return {
        voltageMV, currentMA, powerMW: watts(voltageMV, currentMA),
        minVoltageMV: asInt(pdo.minimum_voltage) ?? 0,
    };
}

function readBattery(pdo, role) {
    const powerAttr = role === 'sink' ? 'operational_power' : 'maximum_power';
    const voltageMV = asInt(pdo.maximum_voltage) ?? 0;
    const powerMW = asInt(pdo[powerAttr]) ?? 0;
    // Battery PDOs advertise power, not current. Synthesize the top-end
    // effective current so existing UI rows ("V @ A — W") render numerically.
    const currentMA = voltageMV > 0 ? Math.floor((powerMW * 1000) / voltageMV) : 0;
    return {
        voltageMV, currentMA, powerMW,
        minVoltageMV: asInt(pdo.minimum_voltage) ?? 0,
    };
}

function readPPS(pdo, role) {
    const voltageMV = asInt(pdo.maximum_voltage) ?? 0;
    const currentMA = asInt(pdo.maximum_current) ?? 0;
    const ppsLimited = role === 'source' ? asInt(pdo.pps_power_limited) : null;
    return {
        voltageMV, currentMA, powerMW: watts(voltageMV, currentMA),
        minVoltageMV: asInt(pdo.minimum_voltage) ?? 0,
        ppsPowerLimited: ppsLimited === 1,
    };
}

function readAVS(pdo, role) {
    // SPR-AVS spans 9-20 V with two separate current limits and (source-only)
    // a peak current. Headline numbers reflect the upper segment so the
    // common "max watts" path stays meaningful; raw fields preserve detail.
    const i15to20 = asInt(pdo.maximum_current_15V_to_20V) ?? 0;
    const i9to15 = asInt(pdo.maximum_current_9V_to_15V) ?? 0;
    const peak = role === 'source' ? asInt(pdo.peak_current) : null;
    const voltageMV = 20000;
    const currentMA = i15to20;
    return {
        voltageMV, currentMA, powerMW: watts(voltageMV, currentMA),
        minVoltageMV: 9000,
        currentMA9to15: i9to15,
        currentMA15to20: i15to20,
        peakCurrentMA: peak ?? 0,
    };
}

const PDO_READERS = {
    [PdoType.FixedSupply]: readFixed,
    [PdoType.VariableSupply]: readVariable,
    [PdoType.Battery]: readBattery,
    [PdoType.PPS]: readPPS,
    [PdoType.AVS]: readAVS,
};

function parsePdo(pdo, entryName, role) {
    const {index, suffix} = splitDirname(entryName);
    const type = PDO_TYPE_FROM_DIRNAME[suffix] ?? PdoType.Unknown;
    const reader = PDO_READERS[type];
    const fields = reader
        ? reader(pdo, role)
        : {voltageMV: 0, currentMA: 0, powerMW: 0};
    return {
        index, type,
        typeLabel: pdoTypeLabel(type),
        ...fields,
        // The negotiated PDO index is not exposed by /sys/class/usb_power_delivery
        // — verified against Documentation/ABI/testing/sysfs-class-usb_power_delivery
        // and drivers/usb/typec/pd.c. The PD Request Data Object lives inside
        // the controller and is only reachable via driver-specific debugfs
        // (e.g. /sys/kernel/debug/tcpm/) or PD trace events. Until something
        // better lands upstream, every PDO renders as inactive.
        isActive: false,
    };
}

function parseCapabilities(capsObj, role) {
    if (!capsObj || typeof capsObj !== 'object' || capsObj._error) return [];
    const pdos = [];
    for (const [name, val] of Object.entries(capsObj)) {
        if (!val || typeof val !== 'object' || val._error || val._symlink !== undefined)
            continue;
        pdos.push(parsePdo(val, name, role));
    }
    return pdos.sort((a, b) => a.index - b.index);
}

// `entry` is one element of sysfsToJson('/sys/class/usb_power_delivery') or a
// pdN/ subobject hanging off a typec partner — both share the same shape.
export function readPort(entry, name, provenance = PdProvenance.Unknown) {
    const sourceCapabilities = parseCapabilities(entry['source-capabilities'], 'source');
    const sinkCapabilities = parseCapabilities(entry['sink-capabilities'], 'sink');

    if (sourceCapabilities.length === 0 && sinkCapabilities.length === 0)
        return null;

    const maxSourcePowerMW = sourceCapabilities.reduce(
        (max, pdo) => Math.max(max, pdo.powerMW), 0);

    return {
        name,
        provenance,
        revision: asString(entry.revision) ?? '',
        version: asString(entry.version) ?? '',
        sourceCapabilities,
        sinkCapabilities,
        maxSourcePowerMW,
    };
}

// Classify a /sys/class/usb_power_delivery/<name> entry by following its
// `device` symlink: targets named `portN-partner` are charger-side, `portN`
// are host-side. Anything else stays Unknown.
function classifyClassEntry(entry) {
    const owner = symlinkTarget(entry.device);
    if (!owner) return PdProvenance.Unknown;
    if (owner.includes('-partner')) return PdProvenance.PartnerClass;
    if (/^port\d+$/.test(owner)) return PdProvenance.PortSelf;
    return PdProvenance.Unknown;
}

export async function enumeratePdPorts() {
    const tree = await sysfsToJson(PD_PATH);
    const ports = [];
    for (const entry of tree) {
        const port = readPort(entry, entry._name, classifyClassEntry(entry));
        if (port) ports.push(port);
    }
    return ports;
}
