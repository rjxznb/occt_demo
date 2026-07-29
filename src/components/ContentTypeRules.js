const RULES = new Map([
    ['1402', { family: 'standard-window' }],
    ['140a', { family: 'standard-window' }],
    ['1403', { family: 'bay-window' }],
    ['140302', { family: 'bay-window' }],
    ['140303', { family: 'bay-window' }],
    ['1404', { family: 'bay-window' }],
    ['1405', { family: 'arc-bay-window' }],
    ['1406', { family: 'corner-bay-window' }],
    ['140e', { family: 'railing-composite', compositeParent: true }],
    ['140e01', { family: 'straight-railing', templateTypeId: '140e' }],
    ['140e02', { family: 'arc-railing' }],
    ['140f', { family: 'door-window' }],
    ['1305', { family: 'barn-door' }],
    ['1311', { family: 'pocket-door' }],
].map(([typeId, rule]) => [typeId, Object.freeze({ typeId, ...rule })]));

function normalizeTypeId(typeId) {
    return String(typeId ?? '').trim();
}

export function contentTypeRuleFor(typeId) {
    return RULES.get(normalizeTypeId(typeId)) ?? null;
}

export function templateTypeIdAliasFor(typeId) {
    const normalized = normalizeTypeId(typeId);
    return contentTypeRuleFor(normalized)?.templateTypeId ?? normalized;
}
