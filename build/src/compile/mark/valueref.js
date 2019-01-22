import { isArray, isFunction, isString, stringValue } from 'vega-util';
import { isBinned, isBinning } from '../../bin';
import { getMainRangeChannel, X, X2, Y, Y2 } from '../../channel';
import { forEach } from '../../encoding';
import { binRequiresRange, format, hasConditionalFieldDef, isFieldDef, isTypedFieldDef, isValueDef, title, vgField } from '../../fielddef';
import * as log from '../../log';
import { hasDiscreteDomain, ScaleType } from '../../scale';
import { QUANTITATIVE } from '../../type';
import { contains, some } from '../../util';
import { formatSignalRef } from '../common';
// TODO: we need to find a way to refactor these so that scaleName is a part of scale
// but that's complicated.  For now, this is a huge step moving forward.
/**
 * @return Vega ValueRef for normal x- or y-position without projection
 */
export function position(channel, channelDef, channel2Def, scaleName, scale, stack, defaultRef) {
    if (isFieldDef(channelDef) && stack && channel === stack.fieldChannel) {
        // x or y use stack_end so that stacked line's point mark use stack_end too.
        return fieldRef(channelDef, scaleName, { suffix: 'end' });
    }
    return midPoint(channel, channelDef, channel2Def, scaleName, scale, stack, defaultRef);
}
/**
 * @return Vega ValueRef for normal x2- or y2-position without projection
 */
export function position2(channel, aFieldDef, a2fieldDef, scaleName, scale, stack, defaultRef) {
    if (isFieldDef(aFieldDef) &&
        stack &&
        // If fieldChannel is X and channel is X2 (or Y and Y2)
        channel.charAt(0) === stack.fieldChannel.charAt(0)) {
        return fieldRef(aFieldDef, scaleName, { suffix: 'start' });
    }
    return midPoint(channel, a2fieldDef, undefined, scaleName, scale, stack, defaultRef);
}
export function getOffset(channel, markDef) {
    const offsetChannel = channel + 'Offset';
    // TODO: in the future read from encoding channel too
    const markDefOffsetValue = markDef[offsetChannel];
    if (markDefOffsetValue) {
        return markDefOffsetValue;
    }
    return undefined;
}
/**
 * Value Ref for binned fields
 */
export function bin(fieldDef, scaleName, side, offset) {
    const binSuffix = side === 'start' ? undefined : 'end';
    return fieldRef(fieldDef, scaleName, { binSuffix }, offset ? { offset } : {});
}
export function fieldRef(fieldDef, scaleName, opt, mixins) {
    const ref = Object.assign({}, (scaleName ? { scale: scaleName } : {}), { field: vgField(fieldDef, opt) });
    if (mixins) {
        return Object.assign({}, ref, mixins);
    }
    return ref;
}
export function bandRef(scaleName, band = true) {
    return {
        scale: scaleName,
        band: band
    };
}
/**
 * Signal that returns the middle of a bin from start and end field. Should only be used with x and y.
 */
function binMidSignal(scaleName, fieldDef, fieldDef2) {
    const start = vgField(fieldDef, { expr: 'datum' });
    const end = fieldDef2 !== undefined
        ? vgField(fieldDef2, { expr: 'datum' })
        : vgField(fieldDef, { binSuffix: 'end', expr: 'datum' });
    return {
        signal: `scale("${scaleName}", (${start} + ${end}) / 2)`
    };
}
/**
 * @returns {VgValueRef} Value Ref for xc / yc or mid point for other channels.
 */
export function midPoint(channel, channelDef, channel2Def, scaleName, scale, stack, defaultRef) {
    // TODO: datum support
    if (channelDef) {
        /* istanbul ignore else */
        if (isFieldDef(channelDef)) {
            if (isTypedFieldDef(channelDef)) {
                if (isBinning(channelDef.bin)) {
                    // Use middle only for x an y to place marks in the center between start and end of the bin range.
                    // We do not use the mid point for other channels (e.g. size) so that properties of legends and marks match.
                    if (contains([X, Y], channel) && channelDef.type === QUANTITATIVE) {
                        if (stack && stack.impute) {
                            // For stack, we computed bin_mid so we can impute.
                            return fieldRef(channelDef, scaleName, { binSuffix: 'mid' });
                        }
                        // For non-stack, we can just calculate bin mid on the fly using signal.
                        return binMidSignal(scaleName, channelDef);
                    }
                    return fieldRef(channelDef, scaleName, binRequiresRange(channelDef, channel) ? { binSuffix: 'range' } : {});
                }
                else if (isBinned(channelDef.bin)) {
                    if (isFieldDef(channel2Def)) {
                        return binMidSignal(scaleName, channelDef, channel2Def);
                    }
                    else {
                        const channel2 = channel === X ? X2 : Y2;
                        log.warn(log.message.channelRequiredForBinned(channel2));
                    }
                }
            }
            if (scale) {
                const scaleType = scale.get('type');
                if (hasDiscreteDomain(scaleType)) {
                    if (scaleType === 'band') {
                        // For band, to get mid point, need to offset by half of the band
                        return fieldRef(channelDef, scaleName, { binSuffix: 'range' }, { band: 0.5 });
                    }
                    return fieldRef(channelDef, scaleName, { binSuffix: 'range' });
                }
            }
            return fieldRef(channelDef, scaleName, {}); // no need for bin suffix
        }
        else if (isValueDef(channelDef)) {
            const value = channelDef.value;
            if (contains(['x', 'x2'], channel) && value === 'width') {
                return { field: { group: 'width' } };
            }
            else if (contains(['y', 'y2'], channel) && value === 'height') {
                return { field: { group: 'height' } };
            }
            return { value };
        }
        // If channelDef is neither field def or value def, it's a condition-only def.
        // In such case, we will use default ref.
    }
    return isFunction(defaultRef) ? defaultRef() : defaultRef;
}
export function tooltipForEncoding(encoding, config) {
    const keyValues = [];
    const usedKey = {};
    function add(fieldDef, channel) {
        const mainChannel = getMainRangeChannel(channel);
        if (channel !== mainChannel) {
            fieldDef = Object.assign({}, fieldDef, { type: encoding[mainChannel].type });
        }
        const key = title(fieldDef, config, { allowDisabling: false });
        const value = text(fieldDef, config).signal;
        if (!usedKey[key]) {
            keyValues.push(`${stringValue(key)}: ${value}`);
        }
        usedKey[key] = true;
    }
    forEach(encoding, (channelDef, channel) => {
        if (isFieldDef(channelDef)) {
            add(channelDef, channel);
        }
        else if (hasConditionalFieldDef(channelDef)) {
            add(channelDef.condition, channel);
        }
    });
    return keyValues.length ? { signal: `{${keyValues.join(', ')}}` } : undefined;
}
export function text(channelDef, config) {
    // text
    if (channelDef) {
        if (isValueDef(channelDef)) {
            return { value: channelDef.value };
        }
        if (isTypedFieldDef(channelDef)) {
            return formatSignalRef(channelDef, format(channelDef), 'datum', config);
        }
    }
    return undefined;
}
export function mid(sizeRef) {
    return Object.assign({}, sizeRef, { mult: 0.5 });
}
/**
 * Whether the scale definitely includes zero in the domain
 */
function domainDefinitelyIncludeZero(scale) {
    if (scale.get('zero') !== false) {
        return true;
    }
    const domains = scale.domains;
    if (isArray(domains)) {
        return some(domains, d => isArray(d) && d.length === 2 && d[0] <= 0 && d[1] >= 0);
    }
    return false;
}
export function getDefaultRef(defaultRef, channel, scaleName, scale, mark) {
    return () => {
        if (isString(defaultRef)) {
            if (scaleName) {
                const scaleType = scale.get('type');
                if (contains([ScaleType.LOG, ScaleType.TIME, ScaleType.UTC], scaleType)) {
                    // Log scales cannot have zero.
                    // Zero in time scale is arbitrary, and does not affect ratio.
                    // (Time is an interval level of measurement, not ratio).
                    // See https://en.wikipedia.org/wiki/Level_of_measurement for more info.
                    if (mark === 'bar' || mark === 'area') {
                        log.warn(log.message.nonZeroScaleUsedWithLengthMark(mark, channel, { scaleType }));
                    }
                }
                else {
                    if (domainDefinitelyIncludeZero(scale)) {
                        return {
                            scale: scaleName,
                            value: 0
                        };
                    }
                    if (mark === 'bar' || mark === 'area') {
                        log.warn(log.message.nonZeroScaleUsedWithLengthMark(mark, channel, { zeroFalse: scale.explicit.zero === false }));
                    }
                }
            }
            if (defaultRef === 'zeroOrMin') {
                return channel === 'x' ? { value: 0 } : { field: { group: 'height' } };
            }
            else {
                // zeroOrMax
                return channel === 'x' ? { field: { group: 'width' } } : { value: 0 };
            }
        }
        return defaultRef;
    };
}
//# sourceMappingURL=valueref.js.map