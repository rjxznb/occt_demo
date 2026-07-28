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
    const instances = collectContentModelInstances(JSON.parse(drawingText));
    const catalog = createTemplateCatalog(JSON.parse(templateText));
    const selections = instances.map(instance => ({
        instance,
        selection: selectTemplateResource(instance, catalog),
    }));
    return { instances, selections };
}

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
