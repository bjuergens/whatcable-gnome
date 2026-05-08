// Filename allowlists for sysfsToJson.
//
// `sysfsToJson` reads every regular file it sees by default; sysfs has
// thousands of files no consumer in this extension touches. Each module
// passes one of these sets (or a predicate built from them) to bound the
// per-refresh I/O.
//
// Sync rule: every name a parser pulls out of an entry must be in the
// matching set here. A missing name reads as `null` silently — no error.

export const PD_FILES = new Set([
    'revision', 'version',
    'voltage', 'maximum_current', 'operational_current', 'peak_current',
    'maximum_voltage', 'minimum_voltage',
    'maximum_power', 'operational_power',
    'pps_power_limited',
    'maximum_current_15V_to_20V', 'maximum_current_9V_to_15V',
]);

const TYPEC_PORT_FILES = new Set([
    'data_role', 'power_role', 'port_type', 'power_operation_mode',
    'orientation', 'usb_power_delivery_revision', 'usb_typec_revision',
    'type', 'plug_type', 'supports_usb_power_delivery',
    'id_header', 'cert_stat', 'product',
    'product_type_vdo1', 'product_type_vdo2', 'product_type_vdo3',
]);

// Typec partners under UCSI carry inline pdN/ subdirs with the same shape
// as /sys/class/usb_power_delivery, so the typec walk needs PD attrs too.
// vdo* covers any extra Discover Identity VDOs the kernel might expose.
export function typecAllow(name) {
    return TYPEC_PORT_FILES.has(name) || PD_FILES.has(name) || name.startsWith('vdo');
}

export const USB_FILES = new Set([
    'idVendor', 'idProduct', 'manufacturer', 'product', 'serial', 'version',
    'removable', 'speed', 'bMaxPower', 'busnum', 'devnum',
    'rx_lanes', 'tx_lanes', 'bNumConfigurations',
    'bDeviceClass', 'bDeviceSubClass', 'bDeviceProtocol', 'bNumInterfaces',
    'bInterfaceClass', 'bInterfaceSubClass', 'bInterfaceProtocol',
]);
