// Single entrypoint for the panel indicator: returns the device list as
// JSON-shaped objects ready for validateDevice() / _buildDeviceItem().

import {enumerateUsbDevices} from './usb-device.js';
import {enumerateTypecPorts} from './typec-port.js';
import {enumeratePdPorts} from './power-delivery.js';
import {fromTypeCCable} from './cable-info.js';
import * as DeviceSummary from './device-summary.js';

function pairPdPort(tcPort, pdPorts, typecCount) {
    // Preferred: kernel's own typec→PD symlink (typec/portN/usb_power_delivery).
    if (tcPort.pdPortName) {
        for (const pd of pdPorts) {
            if (pd.name === tcPort.pdPortName) return pd;
        }
    }
    // Fallback used when the kernel didn't expose the symlink (older drivers)
    // and the topology is unambiguous.
    if (pdPorts.length === 1 && typecCount === 1) return pdPorts[0];
    return null;
}

export async function collectDevices() {
    const [usbDevices, typecPorts, pdPorts] = await Promise.all([
        enumerateUsbDevices(),
        enumerateTypecPorts(),
        enumeratePdPorts(),
    ]);

    const summaries = [];

    for (const tc of typecPorts) {
        const pd = pairPdPort(tc, pdPorts, typecPorts.length);
        const cable = tc.cable ? fromTypeCCable(tc.cable) : null;
        summaries.push(DeviceSummary.fromTypeCPort(tc, pd, cable));
    }

    for (const dev of usbDevices) {
        if (dev.isRootHub) continue;
        summaries.push(DeviceSummary.fromUsbDevice(dev));
    }

    return summaries;
}
