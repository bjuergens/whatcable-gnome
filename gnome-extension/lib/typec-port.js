// Enumerate /sys/class/typec/.

import {sysfsToJson, asString, asHex, symlinkTarget} from './sysfsToJson.js';
import {readPort as readPdPort, PdProvenance, PD_FILES} from './power-delivery.js';

const TYPEC_PORT_FILES = new Set([
    // port attrs
    'data_role', 'power_role', 'port_type', 'power_operation_mode',
    'orientation', 'usb_power_delivery_revision', 'usb_typec_revision',
    // partner / cable attrs
    'type', 'plug_type', 'supports_usb_power_delivery',
    // identity (named VDO files; vdo* pattern handled in the predicate)
    'id_header', 'cert_stat', 'product',
    'product_type_vdo1', 'product_type_vdo2', 'product_type_vdo3',
]);

function typecAllow(name) {
    return TYPEC_PORT_FILES.has(name) || PD_FILES.has(name) || name.startsWith('vdo');
}

const TYPEC_PATH = '/sys/class/typec';
const PARTNER_PD_RE = /^pd\d+$/;
const PORT_NUM_RE = /^port(\d+)$/;

const VDO_FILES = new Set([
    'id_header',
    'cert_stat',
    'product',
    'product_type_vdo1',
    'product_type_vdo2',
    'product_type_vdo3',
]);

function readIdentity(entry) {
    const id = entry?.identity;
    if (!id || typeof id !== 'object' || id._error) return null;

    // Keyed by filename, not position. The kernel exposes id_header, cert_stat,
    // product, product_type_vdo1..3 as named files; alphabetical iteration would
    // put cert_stat (= PD VDO2) at index 0 and decoders that expect VDO1 at
    // index 0 would silently decode the wrong word.
    const vdos = {};
    for (const [name, val] of Object.entries(id)) {
        if (!(name.startsWith('vdo') || VDO_FILES.has(name))) continue;
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
        if (!PARTNER_PD_RE.test(key)) continue;
        if (!val || typeof val !== 'object' || val._error) continue;
        const port = readPdPort(val, key, PdProvenance.Partner);
        if (port) ports.push(port);
    }
    return ports;
}

function readPartner(partnerEntry) {
    return {
        type: asString(partnerEntry.type) ?? '',
        pdRevision: asString(partnerEntry.usb_power_delivery_revision) ?? '',
        identity: readIdentity(partnerEntry),
        pdPorts: readPartnerPdPorts(partnerEntry),
    };
}

function readCable(cableEntry) {
    return {
        type: asString(cableEntry.type) ?? '',
        plugType: asString(cableEntry.plug_type) ?? '',
        pdRevision: asString(cableEntry.usb_power_delivery_revision) ?? '',
        identity: readIdentity(cableEntry),
    };
}

function readPort(entry, partnerEntry, cableEntry) {
    const numMatch = PORT_NUM_RE.exec(entry._name);
    if (!numMatch) return null;

    // Kernel exposes the typec→PD association as a `usb_power_delivery`
    // symlink (e.g. `/sys/class/typec/port0/usb_power_delivery -> ../../usb_power_delivery/source0`).
    // Pick up the basename to pair with the PD port enumeration without
    // guessing port indices.
    const pdPortName = symlinkTarget(entry.usb_power_delivery);
    const partner = partnerEntry ? readPartner(partnerEntry) : null;
    const cable = cableEntry ? readCable(cableEntry) : null;

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
        pdPortName,
        partner,
        cable,
        hasPartner: partner !== null,
        hasCable: cable !== null,
    };
}

const BRACKET_RE = /\[([^\]]+)\]/;

function extractCurrentRole(value) {
    if (!value) return '';
    return BRACKET_RE.exec(value)?.[1] ?? value;
}

export function isConnected(port) {
    return port.hasPartner || port.hasCable;
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
