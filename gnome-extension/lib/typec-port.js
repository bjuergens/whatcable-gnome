// Enumerate /sys/class/typec/.

import * as Sysfs from './sysfs.js';
import {readPort as readPdPort} from './power-delivery.js';

const TYPEC_PATH = '/sys/class/typec';
const PARTNER_PD_RE = /^pd\d+$/;
const BRACKET_RE = /\[([^\]]+)\]/;
const PORT_NUM_RE = /^port(\d+)$/;

const VDO_FILES = new Set([
    'id_header',
    'cert_stat',
    'product',
    'product_type_vdo1',
    'product_type_vdo2',
    'product_type_vdo3',
]);

function extractCurrentRole(value) {
    if (!value) return '';
    return BRACKET_RE.exec(value)?.[1] ?? value;
}

async function readIdentity(path) {
    const idPath = `${path}/identity`;
    if (!Sysfs.pathExists(idPath)) return null;

    const files = await Sysfs.listFiles(idPath);
    // Keyed by filename, not position. The kernel exposes id_header, cert_stat,
    // product, product_type_vdo1..3 as named files; alphabetical iteration would
    // put cert_stat (= PD VDO2) at index 0 and decoders that expect VDO1 at
    // index 0 would silently decode the wrong word.
    const relevant = files.filter(f => f.startsWith('vdo') || VDO_FILES.has(f));
    const reads = await Promise.all(
        relevant.map(f => Sysfs.readHexAttribute(`${idPath}/${f}`)));

    const vdos = Object.fromEntries(
        relevant.map((name, i) => [name, reads[i]])
            .filter(([, val]) => val !== null));

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
async function readPartnerPdPorts(partnerPath) {
    const entries = await Sysfs.listSubdirectories(partnerPath);
    const pdEntries = entries.filter(e => PARTNER_PD_RE.test(e));
    const ports = await Promise.all(
        pdEntries.map(name => readPdPort(`${partnerPath}/${name}`, name)));
    return ports.filter(p => p !== null);
}

async function readPort(path, name) {
    const numMatch = PORT_NUM_RE.exec(name);
    if (!numMatch) return null;

    const [
        dataRole, powerRole, portType, powerOpMode, orientation,
        pdRevision, usbTypeCRev,
    ] = await Promise.all([
        Sysfs.readAttribute(`${path}/data_role`),
        Sysfs.readAttribute(`${path}/power_role`),
        Sysfs.readAttribute(`${path}/port_type`),
        Sysfs.readAttribute(`${path}/power_operation_mode`),
        Sysfs.readAttribute(`${path}/orientation`),
        Sysfs.readAttribute(`${path}/usb_power_delivery_revision`),
        Sysfs.readAttribute(`${path}/usb_typec_revision`),
    ]);

    const partnerPath = `${path}-partner`;
    const partner = Sysfs.pathExists(partnerPath)
        ? await Promise.all([
            Sysfs.readAttribute(`${partnerPath}/type`),
            Sysfs.readAttribute(`${partnerPath}/usb_power_delivery_revision`),
            readIdentity(partnerPath),
            readPartnerPdPorts(partnerPath),
        ]).then(([type, pdRevision, identity, pdPorts]) => ({
            type: type ?? '',
            pdRevision: pdRevision ?? '',
            identity,
            pdPorts,
        }))
        : null;

    const cablePath = `${path}-cable`;
    const cable = Sysfs.pathExists(cablePath)
        ? await Promise.all([
            Sysfs.readAttribute(`${cablePath}/type`),
            Sysfs.readAttribute(`${cablePath}/plug_type`),
            Sysfs.readAttribute(`${cablePath}/usb_power_delivery_revision`),
            readIdentity(cablePath),
        ]).then(([type, plugType, pdRevision, identity]) => ({
            type: type ?? '',
            plugType: plugType ?? '',
            pdRevision: pdRevision ?? '',
            identity,
        }))
        : null;

    // Kernel exposes the typec→PD association as a `usb_power_delivery`
    // symlink (e.g. `/sys/class/typec/port0/usb_power_delivery -> ../../usb_power_delivery/source0`).
    // Pick up the basename to pair with the PD port enumeration without
    // guessing port indices.
    const pdPortName = Sysfs.readSymlinkTargetBasename(`${path}/usb_power_delivery`);

    return {
        sysfsPath: path,
        portName: name,
        portNumber: parseInt(numMatch[1], 10),
        dataRole: dataRole ?? '',
        powerRole: powerRole ?? '',
        portType: portType ?? '',
        powerOpMode: powerOpMode ?? '',
        orientation: orientation ?? '',
        pdRevision: pdRevision ?? '',
        usbTypeCRev: usbTypeCRev ?? '',
        pdPortName,
        partner,
        cable,
        hasPartner: partner !== null,
        hasCable: cable !== null,
    };
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
    if (!Sysfs.pathExists(TYPEC_PATH)) return [];
    const entries = await Sysfs.listSubdirectories(TYPEC_PATH);
    const ports = await Promise.all(
        entries.map(name => readPort(`${TYPEC_PATH}/${name}`, name)));
    return ports.filter(p => p !== null);
}
