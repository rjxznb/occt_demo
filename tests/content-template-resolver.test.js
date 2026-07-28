import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    ContentTemplateResolver, createTemplateCatalog, mapCadTypeId, selectTemplateResource,
} from '../src/components/ContentTemplateResolver.js';
import { collectContentModelInstances } from '../src/components/ContentModelRegistry.js';

const entry = (TypeId, StyleItemType, ResList) => ({
    TypeId, TypeName: TypeId, StyleItemType, ResList,
    SizeSampleModelMap: Object.fromEntries(ResList.map(resource => [resource.ResId, resource])),
});

const catalog = createTemplateCatalog({ AllItemInfo: [
    entry('7314', 0, [{ ResId: 'fold-2', X: 100, Y: 20, Z: 220 }]),
    entry('1302', 0, [{ ResId: 'door-fallback', X: 90, Y: 20, Z: 220 }]),
    entry('203d', 1, [{ ResId: 'wine', X: 120, Y: 40, Z: 220 }]),
] });

test('ports UE folding-door, cabinet-style, and template fallback mappings', () => {
    assert.equal(mapCadTypeId({ typeId: '130402', rawBlockInnerInfo: {} }, catalog), '7314');
    assert.equal(mapCadTypeId({ typeId: '20dc', rawBlockInnerInfo: { '\u6837\u5f0f': '\u9152\u67dc' } }, catalog), '203d');
    assert.equal(mapCadTypeId({ typeId: '1301', rawBlockInnerInfo: {} }, catalog), '1302');
});

test('ports every source-visible UE type mapping without decoding binary tables', () => {
    const local = createTemplateCatalog({ AllItemInfo: [entry('7317', 0, [])] });
    const map = (typeId, style) => mapCadTypeId({
        typeId,
        rawBlockInnerInfo: style ? { '\u6837\u5f0f': style } : {},
    }, local);

    assert.deepEqual([
        map('130402'), map('130403'), map('130404'), map('130405'), map('130406'), map('130499'),
        map('1305'), map('1311a'), map('1301'), map('1303'), map('unmapped'),
    ], ['7314', '7324', '7312', '7325', '7313', '1304', '7319', '7323', '7317', '7318', 'unmapped']);
    assert.deepEqual([
        map('20dc', '\u7384\u5173\u67dc'), map('20dc', '\u9152\u67dc'), map('20dc', '\u4e66\u67dc'),
        map('20dc', '\u9910\u8fb9\u67dc'), map('20dc', '\u5f00\u95e8\u67dc'), map('20dc', '\u6597\u67dc'),
        map('20dc', '\u5f00\u653e\u683c'), map('20dc', '\u540a\u67dc'), map('20dc', '\u60ac\u7a7a\u50a8\u7269\u67dc'),
        map('20dc', '\u60ac\u7a7a\u62bd\u5c49\u67dc'),
    ], ['203c', '203d', '203e', '203g', '0db00', '0db01', '0db02', '0f200', '20f201', '20f202']);
});

test('selects the UE minimum area-difference sample after mm-to-cm conversion', () => {
    const local = createTemplateCatalog({ AllItemInfo: [entry('chair', 0, [
        { ResId: 'small', X: 50, Y: 50, Z: 80 },
        { ResId: 'large', X: 100, Y: 60, Z: 90 },
    ])] });
    const selected = selectTemplateResource({
        typeId: 'chair', size: { x: 980, y: 590, z: 900 },
        footprint: [], rawBlockInnerInfo: {},
    }, local);
    assert.equal(selected.resId, 'large');
    assert.equal(selected.selection, 'nearest-area');
});

test('selects range entries with UE tolerance and falls back stably', () => {
    const local = createTemplateCatalog({ AllItemInfo: [{
        TypeId: 'cabinet', TypeName: '\u67dc', StyleItemType: 1,
        ResList: [
            { ResId: 'default', X: 0, Y: 0, Z: 0 },
            { ResId: 'range', X: 0, Y: 0, Z: 0,
                SizeRangeX: '105,155', SizeRangeY: '30,40' },
        ],
    }] });
    assert.equal(selectTemplateResource({
        typeId: 'cabinet', size: { x: 1050.05, y: 350, z: 0 },
        footprint: [], rawBlockInnerInfo: {},
    }, local).resId, 'range');
    assert.equal(selectTemplateResource({
        typeId: 'cabinet', size: { x: 2000, y: 900, z: 0 },
        footprint: [], rawBlockInnerInfo: {},
    }, local).resId, 'default');
});

test('returns explicit errors when a mapped template or resource is unavailable', () => {
    assert.equal(selectTemplateResource({ typeId: 'missing', size: { x: 1, y: 1 }, footprint: [] }, catalog).errorCode,
        'TEMPLATE_TYPE_NOT_FOUND');
    const empty = createTemplateCatalog({ AllItemInfo: [entry('empty', 0, [])] });
    assert.equal(selectTemplateResource({ typeId: 'empty', size: { x: 1, y: 1 }, footprint: [] }, empty).errorCode,
        'TEMPLATE_RESOURCE_MISSING');
});

test('caches the template fetch and per-size selection while retaining instance transform fields', async () => {
    let fetchCount = 0;
    const resolver = new ContentTemplateResolver(async () => {
        fetchCount += 1;
        return {
            ok: true,
            json: async () => ({ AllItemInfo: [entry('chair', 0, [
                { ResId: 'small', X: 50, Y: 50, Z: 80 },
                { ResId: 'large', X: 100, Y: 60, Z: 90 },
            ])] }),
        };
    });
    await Promise.all([resolver.load(), resolver.load()]);
    assert.equal(fetchCount, 1);

    const base = { typeId: 'chair', size: { x: 980, y: 590 }, footprint: [] };
    assert.equal(resolver.select(base).resId, 'large');
    resolver.catalog.get('chair').ResList = [{ ResId: 'replacement', X: 100, Y: 60, Z: 90 }];
    const mirrored = resolver.select({ ...base, outScale: { x: -1 }, groundHeight: 50 });
    assert.equal(mirrored.resId, 'large');
    assert.equal(mirrored.xMirror, true);
    assert.equal(mirrored.groundDist, 5);
});

test('Drawing2 selects the audited non-first nearest resources', async () => {
    const [drawingText, templateText] = await Promise.all([
        readFile(new URL('../public/data/Drawing2.json', import.meta.url), 'utf8'),
        readFile(new URL('../public/data/template.json', import.meta.url), 'utf8'),
    ]);
    const instances = collectContentModelInstances(JSON.parse(drawingText));
    const fullCatalog = createTemplateCatalog(JSON.parse(templateText));
    const expected = new Map([
        ['225903', '1316568'],
        ['206902', '975654'],
        ['219102', '817646'],
        ['216002', '856945'],
        ['21f802', '962871'],
    ]);

    for (const [typeId, resId] of expected) {
        const matches = instances
            .filter(instance => instance.typeId === typeId)
            .map(instance => selectTemplateResource(instance, fullCatalog));
        assert.ok(matches.some(selection => selection.resId === resId && selection.selection === 'nearest-area'),
            `${typeId} should select ${resId} by nearest-area`);
    }
});
