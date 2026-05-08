// Enumerate /sys/class/usb_power_delivery/.

import * as Sysfs from './sysfs.js';

const PD_PATH = '/sys/class/usb_power_delivery';

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

async function readFixed(pdoPath, role) {
    const currentAttr = role === 'sink' ? 'operational_current' : 'maximum_current';
    const [voltage, current, peak] = await Promise.all([
        Sysfs.readIntAttribute(`${pdoPath}/voltage`),
        Sysfs.readIntAttribute(`${pdoPath}/${currentAttr}`),
        role === 'source'
            ? Sysfs.readIntAttribute(`${pdoPath}/peak_current`)
            : Promise.resolve(null),
    ]);
    const voltageMV = voltage ?? 0;
    const currentMA = current ?? 0;
    return {
        voltageMV, currentMA, powerMW: watts(voltageMV, currentMA),
        peakCurrentMA: peak ?? 0,
    };
}

async function readVariable(pdoPath, role) {
    const currentAttr = role === 'sink' ? 'operational_current' : 'maximum_current';
    const [maxV, minV, current] = await Promise.all([
        Sysfs.readIntAttribute(`${pdoPath}/maximum_voltage`),
        Sysfs.readIntAttribute(`${pdoPath}/minimum_voltage`),
        Sysfs.readIntAttribute(`${pdoPath}/${currentAttr}`),
    ]);
    const voltageMV = maxV ?? 0;
    const currentMA = current ?? 0;
    return {
        voltageMV, currentMA, powerMW: watts(voltageMV, currentMA),
        minVoltageMV: minV ?? 0,
    };
}

async function readBattery(pdoPath, role) {
    const powerAttr = role === 'sink' ? 'operational_power' : 'maximum_power';
    const [maxV, minV, power] = await Promise.all([
        Sysfs.readIntAttribute(`${pdoPath}/maximum_voltage`),
        Sysfs.readIntAttribute(`${pdoPath}/minimum_voltage`),
        Sysfs.readIntAttribute(`${pdoPath}/${powerAttr}`),
    ]);
    const voltageMV = maxV ?? 0;
    const powerMW = power ?? 0;
    // Battery PDOs advertise power, not current. Synthesize the top-end
    // effective current so existing UI rows ("V @ A — W") render numerically.
    const currentMA = voltageMV > 0 ? Math.floor((powerMW * 1000) / voltageMV) : 0;
    return {voltageMV, currentMA, powerMW, minVoltageMV: minV ?? 0};
}

async function readPPS(pdoPath, role) {
    const [maxV, minV, maxI, ppsLimited] = await Promise.all([
        Sysfs.readIntAttribute(`${pdoPath}/maximum_voltage`),
        Sysfs.readIntAttribute(`${pdoPath}/minimum_voltage`),
        Sysfs.readIntAttribute(`${pdoPath}/maximum_current`),
        role === 'source'
            ? Sysfs.readIntAttribute(`${pdoPath}/pps_power_limited`)
            : Promise.resolve(null),
    ]);
    const voltageMV = maxV ?? 0;
    const currentMA = maxI ?? 0;
    return {
        voltageMV, currentMA, powerMW: watts(voltageMV, currentMA),
        minVoltageMV: minV ?? 0,
        ppsPowerLimited: ppsLimited === 1,
    };
}

async function readAVS(pdoPath, role) {
    // SPR-AVS spans 9-20 V with two separate current limits and (source-only)
    // a peak current. Headline numbers reflect the upper segment so the
    // common "max watts" path stays meaningful; raw fields preserve detail.
    const [i15to20, i9to15, peak] = await Promise.all([
        Sysfs.readIntAttribute(`${pdoPath}/maximum_current_15V_to_20V`),
        Sysfs.readIntAttribute(`${pdoPath}/maximum_current_9V_to_15V`),
        role === 'source'
            ? Sysfs.readIntAttribute(`${pdoPath}/peak_current`)
            : Promise.resolve(null),
    ]);
    const voltageMV = 20000;
    const currentMA = i15to20 ?? 0;
    return {
        voltageMV, currentMA, powerMW: watts(voltageMV, currentMA),
        minVoltageMV: 9000,
        currentMA9to15: i9to15 ?? 0,
        currentMA15to20: i15to20 ?? 0,
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

async function parsePdo(pdoPath, entryName, role) {
    const {index, suffix} = splitDirname(entryName);
    const type = PDO_TYPE_FROM_DIRNAME[suffix] ?? PdoType.Unknown;
    const reader = PDO_READERS[type];
    const fields = reader
        ? await reader(pdoPath, role)
        : {voltageMV: 0, currentMA: 0, powerMW: 0};
    return {
        index, type,
        typeLabel: pdoTypeLabel(type),
        ...fields,
        // The negotiated PDO index is not exposed by /sys/class/usb_power_delivery
        // — verified against Documentation/ABI/testing/sysfs-class-usb_power_delivery
        // and drivers/usb/typec/pd.c. The PD Request Data Object lives inside
        // the controller and is only reachable via driver-specific debugfs
        // (e.g. /sys/kernel/debug/tcpm/) or PD trace events.
        // /sys/class/typec/portN/power_operation_mode signals *whether* PD is
        // in use ("usb_power_delivery") but not which PDO; the typec port
        // surfaces it as the "Power mode" bullet rather than per-PDO. Until
        // something better lands upstream, every PDO renders as inactive.
        isActive: false,
    };
}

async function parseCapabilities(capsPath, role) {
    if (!Sysfs.pathExists(capsPath)) return [];
    const entries = await Sysfs.listSubdirectories(capsPath);
    const pdos = await Promise.all(entries.map(e =>
        parsePdo(`${capsPath}/${e}`, e, role)));
    return pdos.sort((a, b) => a.index - b.index);
}

async function readPort(path, name) {
    const [revision, version, sourceCapabilities, sinkCapabilities] = await Promise.all([
        Sysfs.readAttribute(`${path}/revision`),
        Sysfs.readAttribute(`${path}/version`),
        parseCapabilities(`${path}/source-capabilities`, 'source'),
        parseCapabilities(`${path}/sink-capabilities`, 'sink'),
    ]);

    if (sourceCapabilities.length === 0 && sinkCapabilities.length === 0)
        return null;

    const maxSourcePowerMW = sourceCapabilities.reduce(
        (max, pdo) => Math.max(max, pdo.powerMW), 0);

    return {
        sysfsPath: path,
        name,
        revision: revision ?? '',
        version: version ?? '',
        sourceCapabilities,
        sinkCapabilities,
        maxSourcePowerMW,
    };
}

export async function enumeratePdPorts() {
    if (!Sysfs.pathExists(PD_PATH)) return [];
    const entries = await Sysfs.listSubdirectories(PD_PATH);
    const ports = await Promise.all(
        entries.map(name => readPort(`${PD_PATH}/${name}`, name)));
    return ports.filter(p => p !== null);
}
