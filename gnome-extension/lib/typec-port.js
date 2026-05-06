// Enumerate /sys/class/typec/. Direct port of src/core/TypeCPort.cpp.

import * as Sysfs from './sysfs.js';

const TYPEC_PATH = '/sys/class/typec';
const BRACKET_RE = /\[([^\]]+)\]/;

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
    const m = BRACKET_RE.exec(value);
    return m ? m[1] : value;
}

async function readIdentity(path) {
    const idPath = `${path}/identity`;
    if (!Sysfs.pathExists(idPath)) return null;

    const files = await Sysfs.listFiles(idPath);
    const relevant = files.filter(f => f.startsWith('vdo') || VDO_FILES.has(f));

    const reads = await Promise.all(
        relevant.map(f => Sysfs.readHexAttribute(`${idPath}/${f}`)),
    );

    const id = {vendorId: 0, productId: 0, vdos: []};
    relevant.forEach((name, i) => {
        const val = reads[i];
        if (val === null) return;
        if (name === 'id_header') id.vendorId = val & 0xFFFF;
        else if (name === 'product') id.productId = val & 0xFFFF;
        id.vdos.push(val);
    });

    if (id.vendorId === 0 && id.vdos.length === 0) return null;
    return id;
}

async function readPort(path, name) {
    if (!name.startsWith('port')) return null;

    const numMatch = /^port(\d+)$/.exec(name);
    const portNumber = numMatch ? parseInt(numMatch[1], 10) : -1;

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

    let partner = null;
    const partnerPath = `${path}-partner`;
    if (Sysfs.pathExists(partnerPath)) {
        const [type, identity] = await Promise.all([
            Sysfs.readAttribute(`${partnerPath}/type`),
            readIdentity(partnerPath),
        ]);
        partner = {type: type ?? '', identity};
    }

    let cable = null;
    const cablePath = `${path}-cable`;
    if (Sysfs.pathExists(cablePath)) {
        const [type, plugType, identity] = await Promise.all([
            Sysfs.readAttribute(`${cablePath}/type`),
            Sysfs.readAttribute(`${cablePath}/plug_type`),
            readIdentity(cablePath),
        ]);
        cable = {type: type ?? '', plugType: plugType ?? '', identity};
    }

    return {
        sysfsPath: path,
        portName: name,
        portNumber,
        dataRole: dataRole ?? '',
        powerRole: powerRole ?? '',
        portType: portType ?? '',
        powerOpMode: powerOpMode ?? '',
        orientation: orientation ?? '',
        pdRevision: pdRevision ?? '',
        usbTypeCRev: usbTypeCRev ?? '',
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
        entries.map(name => readPort(`${TYPEC_PATH}/${name}`, name)),
    );
    return ports.filter(p => p !== null);
}
