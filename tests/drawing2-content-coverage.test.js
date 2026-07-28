import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { collectContentModelInstances } from '../src/components/ContentModelRegistry.js';
import {
    createTemplateCatalog,
    selectTemplateResource,
} from '../src/components/ContentTemplateResolver.js';

async function loadDrawing2Coverage() {
    const [drawingText, templateText] = await Promise.all([
        readFile(new URL('../public/data/Drawing2.json', import.meta.url), 'utf8'),
        readFile(new URL('../public/data/template.json', import.meta.url), 'utf8'),
    ]);
    const drawing = JSON.parse(drawingText);
    const instances = collectContentModelInstances(drawing);
    const catalog = createTemplateCatalog(JSON.parse(templateText));
    const selections = instances.map(instance => ({
        instance,
        selection: selectTemplateResource(instance, catalog),
    }));
    return { drawing, instances, selections };
}

test('Drawing2 discovers every TypeId-bearing record from every array-valued *_list', async () => {
    const { drawing, instances } = await loadDrawing2Coverage();
    const expectedIdentities = Object.entries(drawing).flatMap(([sourceList, records]) => {
        if (!sourceList.endsWith('_list') || !Array.isArray(records)) return [];
        return records.flatMap((record, sourceIndex) => {
            const typeId = String(record?.TypeId ?? '').trim();
            return typeId ? [`${sourceList}:${sourceIndex}`] : [];
        });
    });

    assert.deepEqual(instances.map(instance => instance.instanceId), expectedIdentities);
    const freeWindows = instances.filter(instance =>
        instance.sourceList === 'window_list' && instance.typeId === '140d02');
    assert.equal(freeWindows.length, 2);
    assert.ok(freeWindows.every(instance => instance.size === null));
});

test('Drawing2 preserves authoritative finite CAD paths for both free windows', async () => {
    const { instances } = await loadDrawing2Coverage();
    const freeWindows = instances.filter(instance =>
        instance.sourceList === 'window_list' && instance.typeId === '140d02');

    assert.deepEqual(freeWindows.map(instance => instance.cadPath.length), [6, 10]);
    assert.deepEqual(freeWindows.map(instance => {
        const front = instance.cadPath.slice(0, instance.cadPath.length / 2);
        return front.filter(point => Math.abs(point.bulge) > 1e-6).length;
    }), [1, 1]);
    assert.ok(freeWindows.every(instance => instance.cadPath.every(point =>
        [point.x, point.y, point.z, point.bulge].every(Number.isFinite))));
});

test('Drawing2 keeps audited soft-content and template-selection coverage', async () => {
    const { instances, selections } = await loadDrawing2Coverage();
    const softInstances = instances.filter(item => item.sourceList === 'soft_list');
    const successfulSelections = selections.filter(item => item.selection.resId);

    assert.equal(softInstances.length, 62);
    assert.equal(new Set(softInstances.map(item => item.typeId)).size, 38);
    assert.ok(successfulSelections.length >= 56);
    assert.ok(successfulSelections.some(item => item.selection.resId === '1316568'));
    assert.ok(successfulSelections.some(item => item.selection.resId === '975654'));

    const goodsRequestSet = new Set(successfulSelections.map(item => item.selection.resId));
    assert.ok(goodsRequestSet.has('1961100'), 'audited static resource must be requested');
    assert.ok(goodsRequestSet.has('2406734'), 'audited parameterized resource must be requested');
});
