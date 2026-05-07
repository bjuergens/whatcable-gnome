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

        const idHeader = cable.identity.vdos.id_header;
        // For cables, "Cable VDO" sits in product_type_vdo1 (PD VDO4) — see
        // USB PD r3.x spec, Discover Identity response for SOP'.
        const cableVdoRaw = cable.identity.vdos.product_type_vdo1;
        if (idHeader !== undefined) {
            const hdr = decodeIDHeader(idHeader);
            const active = hdr.ufpProductType === ProductType.ActiveCable;
            if (cableVdoRaw !== undefined) {
                const cableVdo = decodeCableVDO(cableVdoRaw, active);
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
