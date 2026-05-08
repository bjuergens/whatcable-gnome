// Lightweight sysfs read for the panel-icon badge. Computes only what the
// badge displays — net wattage across typec ports and the count of external
// (non-fixed) USB devices — by narrowing sysfsToJson's file allowlist to the
// few attributes those numbers depend on. Skips identity VDOs, interface
// details, manufacturer strings, sink caps, etc. that the full
// collectDevices() pulls for the popup.

import {sysfsToJson, asInt, asString} from './sysfsToJson.js';

const TYPEC_PATH = '/sys/class/typec';
const PD_PATH = '/sys/class/usb_power_delivery';
const USB_PATH = '/sys/bus/usb/devices';

const TYPEC_FILES = new Set(['power_role']);
const PD_FILES = new Set(['voltage', 'maximum_current', 'maximum_voltage', 'maximum_power']);
const USB_FILES = new Set(['removable']);

const BRACKET_RE = /\[([^\]]+)\]/;
const PORT_NUM_RE = /^port(\d+)$/;
const IFACE_KEY_RE = /:/;

function currentRole(value) {
    if (!value) return '';
    return BRACKET_RE.exec(value)?.[1] ?? value;
}

function pdoMaxPowerMW(capsObj) {
    if (!capsObj || typeof capsObj !== 'object' || capsObj._error) return 0;
    let maxMW = 0;
    for (const [name, pdo] of Object.entries(capsObj)) {
        if (!pdo || typeof pdo !== 'object' || pdo._error || pdo._symlink !== undefined)
            continue;
        const suffix = name.slice(name.lastIndexOf(':') + 1);
        let mV = 0, mA = 0, mW = 0;
        if (suffix === 'fixed_supply') {
            mV = asInt(pdo.voltage) ?? 0;
            mA = asInt(pdo.maximum_current) ?? 0;
        } else if (suffix === 'battery') {
            mW = asInt(pdo.maximum_power) ?? 0;
        } else {
            mV = asInt(pdo.maximum_voltage) ?? 0;
            mA = asInt(pdo.maximum_current) ?? 0;
        }
        if (mW === 0 && mV > 0 && mA > 0) mW = Math.floor((mV * mA) / 1000);
        if (mW > maxMW) maxMW = mW;
    }
    return maxMW;
}

async function readTypecPorts() {
    const allow = name => TYPEC_FILES.has(name) || PD_FILES.has(name);
    const tree = await sysfsToJson(TYPEC_PATH, {files: allow});
    const ports = [];
    for (const entry of tree) {
        if (!PORT_NUM_RE.test(entry._name)) continue;
        const role = currentRole(asString(entry.power_role) ?? '');
        // Find max wattage from any pdN/source-capabilities that hangs off the
        // partner (UCSI inline) or the linked PD class entry.
        let maxMW = 0;
        const partner = tree.find(e => e._name === `${entry._name}-partner`);
        if (partner) {
            for (const [k, v] of Object.entries(partner)) {
                if (!/^pd\d+$/.test(k) || !v || typeof v !== 'object') continue;
                const mW = pdoMaxPowerMW(v['source-capabilities']);
                if (mW > maxMW) maxMW = mW;
            }
        }
        ports.push({role, maxPowerMW: maxMW, partnerName: `${entry._name}-partner`});
    }
    return ports;
}

async function readPdMaxByOwner() {
    // Map partner-owning PD entries to their max source watts. Only entries
    // whose `device` symlink points at a `*-partner` count — port-self caps
    // describe the host's own offer, not the charger's.
    const tree = await sysfsToJson(PD_PATH, {files: PD_FILES});
    const byOwner = new Map();
    for (const entry of tree) {
        const owner = entry.device?._symlink;
        if (!owner || !owner.includes('-partner')) continue;
        const mW = pdoMaxPowerMW(entry['source-capabilities']);
        if (mW > (byOwner.get(owner) ?? 0)) byOwner.set(owner, mW);
    }
    return byOwner;
}

async function countExternalUsb() {
    const tree = await sysfsToJson(USB_PATH, {files: USB_FILES});
    let count = 0;
    for (const entry of tree) {
        const name = entry._name;
        if (IFACE_KEY_RE.test(name)) continue;          // interface dirs
        if (name.startsWith('usb')) continue;            // root hubs
        const removable = asString(entry.removable) ?? '';
        if (removable === 'fixed') continue;
        count++;
    }
    return count;
}

export async function collectIconStats() {
    const [typecPorts, pdByOwner, externalCount] = await Promise.all([
        readTypecPorts(),
        readPdMaxByOwner(),
        countExternalUsb(),
    ]);

    let chargeW = 0, dischargeW = 0;
    for (const p of typecPorts) {
        let mW = p.maxPowerMW;
        if (mW === 0) mW = pdByOwner.get(p.partnerName) ?? 0;
        const w = Math.floor(mW / 1000);
        if (p.role === 'sink') chargeW += w;
        else if (p.role === 'source') dischargeW += w;
    }
    return {chargeW, dischargeW, externalCount};
}
