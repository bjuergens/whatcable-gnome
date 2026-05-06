// USB-C cable e-marker info derived from typec partner/cable identity VDOs.
// Direct port of src/core/CableInfo.cpp.

import {decodeIDHeader, decodeCableVDO, ProductType} from './pd-decoder.js';
import {lookupVendor} from './vendor-db.js';

export function fromTypeCCable(cable) {
    if (!cable) return null;

    const info = {
        isActive: cable.type === 'active',
        isPassive: cable.type === 'passive',
        cableType: cable.type ?? '',
        plugType: cable.plugType ?? '',
        speed: null,
        currentRating: null,
        maxWatts: 0,
        vendorId: 0,
        vendorName: '',
    };

    if (cable.identity) {
        info.vendorId = cable.identity.vendorId;
        info.vendorName = lookupVendor(cable.identity.vendorId);

        if (cable.identity.vdos.length > 0) {
            const hdr = decodeIDHeader(cable.identity.vdos[0]);
            const active = hdr.ufpProductType === ProductType.ActiveCable;

            if (cable.identity.vdos.length > 3) {
                const cableVdo = decodeCableVDO(cable.identity.vdos[3], active);
                info.speed = cableVdo.speed;
                info.currentRating = cableVdo.currentRating;
                info.maxWatts = cableVdo.maxWatts;
                info.isActive = cableVdo.isActive;
                info.isPassive = !cableVdo.isActive;
            }
        }
    }

    return info;
}
