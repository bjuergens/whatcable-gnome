// Enumerate /sys/class/typec/.

import {sysfsToJson, asString, asHex, isDirObject} from './sysfsToJson.js';
import {readPort as readPdPort, PdProvenance} from './power-delivery.js';
import {typecAllow} from './sysfs-allowlist.js';

const TYPEC_PATH = '/sys/class/typec';
const PORT_NUM_RE = /^port(\d+)$/;
const BRACKET_RE = /\[([^\]]+)\]/;

function readIdentity(entry) {
    const id = entry?.identity;
    if (!isDirObject(id)) return null;

    // Keyed by filename, not position. The kernel exposes id_header, cert_stat,
    // product, product_type_vdo1..3 as named files; alphabetical iteration would
    // put cert_stat (= PD VDO2) at index 0 and decoders that expect VDO1 at
    // index 0 would silently decode the wrong word. The allowlist already
    // restricts what's in here to VDO names, so just parse them all.
    const vdos = {};
    for (const [name, val] of Object.entries(id)) {
        const n = asHex(val);
        if (n !== null) vdos[name] = n;
    }
    if (Object.keys(vdos).length === 0) return null;

    return {
        vendorId: (vdos.id_header ?? 0) & 0xFFFF,
        productId: (vdos.product ?? 0) & 0xFFFF,
        vdos,
    };
}

// UCSI drivers (e.g. ucsi_acpi) leave /sys/class/usb_power_delivery empty and
// instead expose the partner's advertised PDOs inline under the typec partner
// (port1-partner/pdN/). Layout matches usb_power_delivery so readPdPort parses
// it as-is.
function readPartnerPdPorts(partnerEntry) {
    const ports = [];
    for (const [key, val] of Object.entries(partnerEntry)) {
        if (!/^pd\d+$/.test(key)) continue;
        if (!isDirObject(val)) continue;
        const port = readPdPort(val, key, PdProvenance.Partner);
        if (port) ports.push(port);
    }
    return ports;
}

// Partners and cables share most of their attribute shape; cable adds
// plug_type, partner adds inline pdN/ subdirs. Empty defaults on the
// non-applicable side are harmless and let consumers stop branching.
function readPeer(entry) {
    return {
        type: asString(entry.type) ?? '',
        plugType: asString(entry.plug_type) ?? '',
        pdRevision: asString(entry.usb_power_delivery_revision) ?? '',
        identity: readIdentity(entry),
        pdPorts: readPartnerPdPorts(entry),
    };
}

function readPort(entry, partnerEntry, cableEntry) {
    const numMatch = PORT_NUM_RE.exec(entry._name);
    if (!numMatch) return null;

    return {
        portName: entry._name,
        portNumber: parseInt(numMatch[1], 10),
        dataRole: asString(entry.data_role) ?? '',
        powerRole: asString(entry.power_role) ?? '',
        portType: asString(entry.port_type) ?? '',
        powerOpMode: asString(entry.power_operation_mode) ?? '',
        orientation: asString(entry.orientation) ?? '',
        pdRevision: asString(entry.usb_power_delivery_revision) ?? '',
        usbTypeCRev: asString(entry.usb_typec_revision) ?? '',
        partner: partnerEntry ? readPeer(partnerEntry) : null,
        cable: cableEntry ? readPeer(cableEntry) : null,
    };
}

function extractCurrentRole(value) {
    if (!value) return '';
    return BRACKET_RE.exec(value)?.[1] ?? value;
}

export function isConnected(port) {
    return port.partner !== null || port.cable !== null;
}

export function currentDataRole(port) {
    return extractCurrentRole(port.dataRole);
}

export function currentPowerRole(port) {
    return extractCurrentRole(port.powerRole);
}

export async function enumerateTypecPorts() {
    const tree = await sysfsToJson(TYPEC_PATH, {files: typecAllow});
    // The class root mixes portN, portN-partner, portN-cable (and plugN) as
    // sibling entries. Index by name so each port can pick up its companions.
    const byName = new Map(tree.map(e => [e._name, e]));

    const ports = [];
    for (const entry of tree) {
        if (!PORT_NUM_RE.test(entry._name)) continue;
        const port = readPort(
            entry,
            byName.get(`${entry._name}-partner`) ?? null,
            byName.get(`${entry._name}-cable`) ?? null,
        );
        if (port) ports.push(port);
    }
    return ports;
}
