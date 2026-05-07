// Enumerate /sys/class/usb_power_delivery/.

import * as Sysfs from './sysfs.js';

const PD_PATH = '/sys/class/usb_power_delivery';

export const PdoType = Object.freeze({
    FixedSupply: 'fixed',
    Battery: 'battery',
    VariableSupply: 'variable',
    PPS: 'pps',
    Unknown: 'unknown',
});

const PDO_TYPE_LABELS = {
    [PdoType.FixedSupply]: 'Fixed',
    [PdoType.Battery]: 'Battery',
    [PdoType.VariableSupply]: 'Variable',
    [PdoType.PPS]: 'PPS',
};

const PDO_TYPE_FROM_SYSFS = {
    fixed_supply: PdoType.FixedSupply,
    battery: PdoType.Battery,
    variable_supply: PdoType.VariableSupply,
};

function pdoTypeLabel(type) {
    return PDO_TYPE_LABELS[type] ?? 'Unknown';
}

function classifyPdoType(typeStr) {
    if (!typeStr) return PdoType.Unknown;
    if (PDO_TYPE_FROM_SYSFS[typeStr]) return PDO_TYPE_FROM_SYSFS[typeStr];
    if (typeStr.includes('pps')) return PdoType.PPS;
    return PdoType.Unknown;
}

async function parsePdo(pdoPath, entryName) {
    const [typeStr, voltage, minVoltage, maxCurrent, current, maxPower] =
        await Promise.all([
            Sysfs.readAttribute(`${pdoPath}/type`),
            Sysfs.readIntAttribute(`${pdoPath}/voltage`),
            Sysfs.readIntAttribute(`${pdoPath}/minimum_voltage`),
            Sysfs.readIntAttribute(`${pdoPath}/maximum_current`),
            Sysfs.readIntAttribute(`${pdoPath}/current`),
            Sysfs.readIntAttribute(`${pdoPath}/maximum_power`),
        ]);

    const type = classifyPdoType(typeStr);
    const voltageMV = voltage || minVoltage || 0;
    const currentMA = maxCurrent ?? current ?? 0;
    const powerMW = maxPower
        || (voltageMV > 0 && currentMA > 0 ? Math.floor((voltageMV * currentMA) / 1000) : 0);

    const colon = entryName.lastIndexOf(':');
    const index = parseInt(colon >= 0 ? entryName.slice(colon + 1) : entryName, 10) || 0;

    return {
        index, type, voltageMV, currentMA, powerMW,
        // TODO: detect the active PDO. The kernel doesn't expose this directly
        // via /sys/class/usb_power_delivery/; it lives in the negotiated PD
        // request DO and is only reachable through driver-specific debugfs or
        // PD trace events. Until then, every PDO renders as inactive.
        isActive: false,
        typeLabel: pdoTypeLabel(type),
    };
}

async function parseCapabilities(capsPath) {
    if (!Sysfs.pathExists(capsPath)) return [];
    const entries = await Sysfs.listSubdirectories(capsPath);
    const pdos = await Promise.all(entries.map(e => parsePdo(`${capsPath}/${e}`, e)));
    return pdos.sort((a, b) => a.index - b.index);
}

async function readPort(path, name) {
    const [sourceCapabilities, sinkCapabilities] = await Promise.all([
        parseCapabilities(`${path}/source-capabilities`),
        parseCapabilities(`${path}/sink-capabilities`),
    ]);

    if (sourceCapabilities.length === 0 && sinkCapabilities.length === 0)
        return null;

    const maxSourcePowerMW = sourceCapabilities.reduce(
        (max, pdo) => Math.max(max, pdo.powerMW), 0);

    return {
        sysfsPath: path,
        name,
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
