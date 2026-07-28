export const STYLE_ITEM = Object.freeze({
    MOVEABLE: 0, CABINET: 1, CUPBOARD: 2, TABLE: 3,
    GROUP: 4, LAMP: 5, PAINTING: 6, HARD: 7, MATERIAL: 8, WINDOW: 9,
});

const NEAREST_TYPES = new Set([
    STYLE_ITEM.MOVEABLE, STYLE_ITEM.GROUP, STYLE_ITEM.LAMP,
    STYLE_ITEM.PAINTING, STYLE_ITEM.HARD,
]);
const RANGE_TYPES = new Set([
    STYLE_ITEM.CABINET, STYLE_ITEM.CUPBOARD, STYLE_ITEM.TABLE, STYLE_ITEM.WINDOW,
]);
const RANGE_TOLERANCE_CM = 0.01;
const DEFAULT_SELECTION_CACHE_LIMIT = 512;

const CABINET_STYLE_TYPE_IDS = new Map([
    ['\u7384\u5173\u67dc', '203c'],
    ['\u9152\u67dc', '203d'],
    ['\u4e66\u67dc', '203e'],
    ['\u9910\u8fb9\u67dc', '203g'],
    ['\u5f00\u95e8\u67dc', '20db00'],
    ['\u6597\u67dc', '20db01'],
    ['\u5f00\u653e\u683c', '20db02'],
    ['\u540a\u67dc', '20f200'],
    ['\u60ac\u7a7a\u50a8\u7269\u67dc', '20f201'],
    ['\u60ac\u7a7a\u62bd\u5c49\u67dc', '20f202'],
]);

export function createTemplateCatalog(raw) {
    const catalog = new Map();
    for (const item of raw?.AllItemInfo ?? []) {
        if (!item || item.TypeId == null) continue;
        const typeId = String(item.TypeId);
        catalog.set(typeId, {
            ...item,
            TypeId: typeId,
            TypeName: item.TypeName ?? '',
            StyleItemType: Number(item.StyleItemType),
            ResList: Array.isArray(item.ResList) ? item.ResList : [],
        });
    }
    return catalog;
}

export function mapCadTypeId(instance, catalog) {
    const typeId = String(instance?.typeId ?? '').trim();
    if (typeId.startsWith('1304')) {
        const count = typeId.length > 4 ? typeId.slice(5) : '';
        return new Map([
            ['2', '7314'], ['3', '7324'], ['4', '7312'], ['5', '7325'], ['6', '7313'],
        ]).get(count) ?? '1304';
    }
    if (typeId.startsWith('1305')) return '7319';
    if (typeId.startsWith('1311')) return '7323';
    const style = instance?.rawBlockInnerInfo?.['\u6837\u5f0f'];
    if (CABINET_STYLE_TYPE_IDS.has(style)) return CABINET_STYLE_TYPE_IDS.get(style);
    if (catalog?.has(typeId)) return typeId;
    if (typeId === '1301') return catalog?.has('1302') ? '1302' : (catalog?.has('7317') ? '7317' : typeId);
    if (typeId === '1303' && catalog?.has('7318')) return '7318';
    return typeId;
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function derivePlanSize(size, footprint) {
    const source = size && typeof size === 'object' ? size : {};
    let x = finiteNumber(source.x);
    let y = finiteNumber(source.y);
    const z = finiteNumber(source.z);
    if ((!x || !y) && Array.isArray(footprint) && footprint.length >= 3) {
        const firstEdge = Math.hypot(
            finiteNumber(footprint[1]?.x) - finiteNumber(footprint[0]?.x),
            finiteNumber(footprint[1]?.y) - finiteNumber(footprint[0]?.y),
        );
        const secondEdge = Math.hypot(
            finiteNumber(footprint[2]?.x) - finiteNumber(footprint[1]?.x),
            finiteNumber(footprint[2]?.y) - finiteNumber(footprint[1]?.y),
        );
        if (!x && firstEdge > 0) x = firstEdge;
        if (!y && secondEdge > 0) y = secondEdge;
    }
    return { x: x / 10, y: y / 10, z: z / 10 };
}

function referenceSize(resource) {
    return {
        x: finiteNumber(resource?.X),
        y: finiteNumber(resource?.Y),
        z: finiteNumber(resource?.Z),
    };
}

function nonzeroSample(resource) {
    const size = referenceSize(resource);
    return size.x !== 0 && size.y !== 0;
}

function parseRange(value) {
    if (typeof value !== 'string') return null;
    const [minimum, maximum] = value.split(',').map(part => Number(part.trim()));
    return Number.isFinite(minimum) && Number.isFinite(maximum) ? { minimum, maximum } : null;
}

function containsRangeCorner(x, y, xRange, yRange) {
    return x >= xRange.minimum && x <= xRange.maximum
        && y >= yRange.minimum && y <= yRange.maximum;
}

function hasRangeToleranceCorners(sizeCm, xRange, yRange) {
    return [
        [sizeCm.x - RANGE_TOLERANCE_CM, sizeCm.y - RANGE_TOLERANCE_CM],
        [sizeCm.x - RANGE_TOLERANCE_CM, sizeCm.y + RANGE_TOLERANCE_CM],
        [sizeCm.x + RANGE_TOLERANCE_CM, sizeCm.y - RANGE_TOLERANCE_CM],
        [sizeCm.x + RANGE_TOLERANCE_CM, sizeCm.y + RANGE_TOLERANCE_CM],
    ].some(([x, y]) => containsRangeCorner(x, y, xRange, yRange));
}

function selectNearest(resources, sizeCm) {
    let selected = null;
    let difference = Infinity;
    for (const resource of resources) {
        if (!nonzeroSample(resource)) continue;
        const sample = referenceSize(resource);
        const areaDifference = Math.max(sizeCm.x, sample.x) * Math.max(sizeCm.y, sample.y)
            - Math.min(sizeCm.x, sample.x) * Math.min(sizeCm.y, sample.y);
        if (areaDifference < difference) {
            selected = resource;
            difference = areaDifference;
        }
    }
    return selected;
}

function selectRange(resources, sizeCm) {
    for (const resource of resources) {
        const xRange = parseRange(resource?.SizeRangeX);
        const yRange = parseRange(resource?.SizeRangeY);
        if (!xRange || !yRange) continue;
        if (hasRangeToleranceCorners(sizeCm, xRange, yRange)) return resource;
    }
    return resources[0] ?? null;
}

function selectResource(entry, sizeCm) {
    if (NEAREST_TYPES.has(entry.StyleItemType)) {
        return { resource: selectNearest(entry.ResList, sizeCm), selection: 'nearest-area' };
    }
    if (RANGE_TYPES.has(entry.StyleItemType)) {
        const resource = selectRange(entry.ResList, sizeCm);
        const hasRange = resource && (resource.SizeRangeX || resource.SizeRangeY);
        return { resource, selection: hasRange ? 'range' : 'range-default' };
    }
    return { resource: entry.ResList[0] ?? null, selection: 'first-resource' };
}

export function selectTemplateResource(instance, catalog) {
    const mappedTypeId = mapCadTypeId(instance, catalog);
    const templateEntry = catalog?.get(mappedTypeId);
    if (!templateEntry) return { errorCode: 'TEMPLATE_TYPE_NOT_FOUND', typeId: mappedTypeId };

    const sizeCm = derivePlanSize(instance?.size, instance?.footprint);
    const { resource, selection } = selectResource(templateEntry, sizeCm);
    if (!resource || resource.ResId == null) {
        return { errorCode: 'TEMPLATE_RESOURCE_MISSING', typeId: mappedTypeId, templateEntry };
    }
    const sampleMetadata = templateEntry.SizeSampleModelMap?.[resource.ResId];
    const selectedReferenceSize = referenceSize(resource);
    if (!selectedReferenceSize.z) {
        const templateHeightMillimeters = finiteNumber(templateEntry.Height);
        if (templateHeightMillimeters > 0) selectedReferenceSize.z = templateHeightMillimeters / 10;
    }

    return {
        typeId: mappedTypeId,
        typeName: templateEntry.TypeName,
        styleItemType: templateEntry.StyleItemType,
        resId: String(resource.ResId),
        referenceSize: selectedReferenceSize,
        selection,
        xMirror: Boolean(resource.XMirror ?? sampleMetadata?.XMirror),
        groundDist: finiteNumber(templateEntry.GroundDist),
        templateEntry,
    };
}

export class ContentTemplateResolver {
    constructor(fetchImpl = globalThis.fetch, {
        selectionCacheLimit = DEFAULT_SELECTION_CACHE_LIMIT,
    } = {}) {
        this.fetchImpl = fetchImpl;
        this.catalog = null;
        this.loadPromise = null;
        this.selectionCache = new Map();
        this.selectionCacheLimit = Math.max(1, Math.floor(Number(selectionCacheLimit)) || 1);
    }

    async load(templatePath = 'data/template.json') {
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = (async () => {
            const response = await this.fetchImpl(templatePath);
            if (!response.ok) throw new Error(`Template load failed: HTTP ${response.status}`);
            this.catalog = createTemplateCatalog(await response.json());
            return this.catalog;
        })();
        return this.loadPromise;
    }

    select(instance) {
        if (!this.catalog) throw new Error('Template catalog has not been loaded');
        const mappedTypeId = mapCadTypeId(instance, this.catalog);
        const sizeCm = derivePlanSize(instance?.size, instance?.footprint);
        const key = `${mappedTypeId}|${sizeCm.x}|${sizeCm.y}`;
        let selected = this.selectionCache.get(key);
        if (selected) {
            this.selectionCache.delete(key);
            this.selectionCache.set(key, selected);
        } else {
            selected = selectTemplateResource(instance, this.catalog);
            this.selectionCache.set(key, selected);
            while (this.selectionCache.size > this.selectionCacheLimit) {
                this.selectionCache.delete(this.selectionCache.keys().next().value);
            }
        }
        return selected;
    }
}
