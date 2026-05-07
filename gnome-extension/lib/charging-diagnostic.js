// Identify charging bottlenecks (cable limit vs charger limit vs device).

export const Bottleneck = Object.freeze({
    NoCharger: 'no-charger',
    ChargerLimit: 'charger-limit',
    CableLimit: 'cable-limit',
    DeviceLimit: 'device-limit',
    Fine: 'fine',
});

export function evaluate(pdPort, cable) {
    if (!pdPort || pdPort.sourceCapabilities.length === 0) return null;

    const chargerMaxW = Math.floor(pdPort.maxSourcePowerMW / 1000);
    if (chargerMaxW <= 0) return null;

    let activeW = 0;
    for (const pdo of pdPort.sourceCapabilities) {
        if (pdo.isActive) {
            activeW = Math.floor(pdo.powerMW / 1000);
            break;
        }
    }
    if (activeW <= 0) activeW = chargerMaxW;

    const cableMaxW = (cable && cable.maxWatts > 0) ? cable.maxWatts : 0;

    if (cableMaxW > 0 && cableMaxW < chargerMaxW) {
        return {
            bottleneck: Bottleneck.CableLimit,
            summary: 'Cable is limiting charging speed',
            detail: `Cable rated for ${cableMaxW}W, but charger can deliver ${chargerMaxW}W`,
            isWarning: true,
        };
    }
    if (activeW > 0 && activeW < chargerMaxW * 0.8) {
        return {
            bottleneck: Bottleneck.DeviceLimit,
            summary: `Charging at ${activeW}W`,
            detail: `Charging at ${activeW}W (charger can do up to ${chargerMaxW}W)`,
            isWarning: false,
        };
    }
    return {
        bottleneck: Bottleneck.Fine,
        summary: `Charging well at ${activeW > 0 ? activeW : chargerMaxW}W`,
        detail: '',
        isWarning: false,
    };
}
