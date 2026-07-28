const OPENING_ONLY_TYPE_IDS = new Set(['1307']);
const TEMPLATE_REASON_CODES = new Set([
    'TEMPLATE_TYPE_NOT_FOUND',
    'TEMPLATE_RESOURCE_MISSING',
]);

function selectionReasonCode(selection) {
    return TEMPLATE_REASON_CODES.has(selection?.errorCode)
        ? selection.errorCode
        : 'TEMPLATE_TYPE_NOT_FOUND';
}

export function classifyContentCandidates(candidates, templateResolver) {
    const selectedRecords = [];
    const localGeometry = [];
    const openingOnly = [];

    for (const instance of Array.isArray(candidates) ? candidates : []) {
        if (OPENING_ONLY_TYPE_IDS.has(String(instance?.typeId))) {
            openingOnly.push({
                instance,
                state: 'opening-only',
                reasonCode: 'INTENTIONAL_OPENING',
            });
            continue;
        }

        let selection;
        try {
            selection = templateResolver.select(instance);
        } catch {
            selection = { errorCode: 'TEMPLATE_TYPE_NOT_FOUND' };
        }

        if (!selection || selection.errorCode) {
            localGeometry.push({
                instance,
                state: 'local-geometry',
                reasonCode: selectionReasonCode(selection),
            });
            continue;
        }

        selectedRecords.push({ instance, selection });
    }

    return { selectedRecords, localGeometry, openingOnly };
}

