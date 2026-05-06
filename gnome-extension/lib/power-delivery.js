// Enumerate /sys/class/usb_power_delivery/. Direct port of src/core/PowerDelivery.cpp.

import * as Sysfs from './sysfs.js';

const PD_PATH = '/sys/class/usb_power_delivery';

export const PdoType = Object.freeze({
    FixedSupply: 'fixed',
    Battery: 'battery',
    VariableSupply: 'variable',
    PPS: 'pps',
    Unknown: 'unknown',
});

function pdoTypeLabel(type) {
    switch (type) {
    case PdoType.FixedSupply:    return 'Fixed';
    case PdoType.Battery:        return 'Battery';
    case PdoType.VariableSupply: return 'Variable';
    case PdoType.PPS:            return 'PPS';
    default:                     return 'Unknown';
    }
}

async function parsePdo(pdoPath, entryName) {
    const [typeStr, voltage, maxVoltage, minVoltage, maxCurrent, current, maxPower] =
        await Promise.all([
            Sysfs.readAttribute(`${pdoPath}/type`),
            Sysfs.readIntAttribute(`${pdoPath}/voltage`),
            Sysfs.readIntAttribute(`${pdoPath}/maximum_voltage`),
            Sysfs.readIntAttribute(`${pdoPath}/minimum_voltage`),
            Sysfs.readIntAttribute(`${pdoPath}/maximum_current`),
            Sysfs.readIntAttribute(`${pdoPath}/current`),
            Sysfs.readIntAttribute(`${pdoPath}/maximum_power`),
        ]);

    let type = PdoType.Unknown;
    if (typeStr === 'fixed_supply') type = PdoType.FixedSupply;
    else if (typeStr === 'battery') type = PdoType.Battery;
    else if (typeStr === 'variable_supply') type = PdoType.VariableSupply;
    else if (typeStr && typeStr.includes('pps')) type = PdoType.PPS;

    let voltageMV = voltage ?? 0;
    let maxVoltageMV = maxVoltage ?? 0;
    if (!voltageMV && minVoltage !== null) voltageMV = minVoltage;

    const currentMA = (maxCurrent !== null ? maxCurrent : current) ?? 0;

    let powerMW = maxPower ?? 0;
    if (!powerMW && voltageMV > 0 && currentMA > 0)
        powerMW = Math.floor((voltageMV * currentMA) / 1000);

    const colon = entryName.lastIndexOf(':');
    const indexStr = colon >= 0 ? entryName.slice(colon + 1) : entryName;
    const index = parseInt(indexStr, 10) || 0;

    return {
        index, type, voltageMV, maxVoltageMV, currentMA, powerMW,
        isActive: false,
        typeLabel: pdoTypeLabel(type),
    };
}

async function parseCapabilities(capsPath) {
    if (!Sysfs.pathExists(capsPath)) return [];
    const entries = await Sysfs.listSubdirectories(capsPath);
    const pdos = await Promise.all(
        entries.map(e => parsePdo(`${capsPath}/${e}`, e)),
    );
    return pdos.sort((a, b) => a.index - b.index);
}

async function readPort(path, name) {
    const [sourceCapabilities, sinkCapabilities] = await Promise.all([
        parseCapabilities(`${path}/source-capabilities`),
        parseCapabilities(`${path}/sink-capabilities`),
    ]);

    if (sourceCapabilities.length === 0 && sinkCapabilities.length === 0)
        return null;

    let maxSourcePowerMW = 0;
    for (const pdo of sourceCapabilities) {
        if (pdo.powerMW > maxSourcePowerMW)
            maxSourcePowerMW = pdo.powerMW;
    }

    return {
        sysfsPath: path,
        name,
        parentPortNumber: -1,
        sourceCapabilities,
        sinkCapabilities,
        maxSourcePowerMW,
    };
}

export async function enumeratePdPorts() {
    if (!Sysfs.pathExists(PD_PATH)) return [];
    const entries = await Sysfs.listSubdirectories(PD_PATH);
    const ports = await Promise.all(
        entries.map(name => readPort(`${PD_PATH}/${name}`, name)),
    );
    return ports.filter(p => p !== null);
}
