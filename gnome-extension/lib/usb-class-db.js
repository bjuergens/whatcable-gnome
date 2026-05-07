// USB class-code → human-readable name.

const CLASS_NAMES = {
    0x00: 'Composite',
    0x01: 'Audio',
    0x02: 'Communications',
    0x03: 'HID',
    0x05: 'Physical',
    0x06: 'Image',
    0x07: 'Printer',
    0x08: 'Mass Storage',
    0x09: 'Hub',
    0x0A: 'CDC Data',
    0x0B: 'Smart Card',
    0x0D: 'Content Security',
    0x0E: 'Video',
    0x0F: 'Personal Healthcare',
    0x10: 'Audio/Video',
    0x11: 'Billboard',
    0x12: 'USB Type-C Bridge',
    0xDC: 'Diagnostic',
    0xE0: 'Wireless',
    0xEF: 'Miscellaneous',
    0xFE: 'Application Specific',
    0xFF: 'Vendor Specific',
};

const SUBCLASS_NAMES = {
    0x01: {0x01: 'Audio Control', 0x02: 'Audio Streaming', 0x03: 'MIDI Streaming'},
    0x03: {0x00: 'HID (No Subclass)', 0x01: 'HID Boot Interface'},
    0x08: {0x01: 'RBC', 0x02: 'MMC-5 (ATAPI)', 0x04: 'UFI', 0x06: 'SCSI', 0x08: 'UAS'},
    0x0E: {0x01: 'Video Control', 0x02: 'Video Streaming'},
    0xE0: {0x01: 'Bluetooth', 0x02: 'Wireless USB'},
};

export function className(classCode) {
    return CLASS_NAMES[classCode] ?? `0x${classCode.toString(16).padStart(2, '0')}`;
}

export function interfaceClassName(classCode, subClass) {
    return SUBCLASS_NAMES[classCode]?.[subClass] ?? className(classCode);
}
