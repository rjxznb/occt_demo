import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index-3d.html', import.meta.url);

test('3D controls use the approved compact Liquid Glass surface', async () => {
    const html = await readFile(htmlUrl, 'utf8');
    const controls = html.match(/#controls\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';

    assert.match(controls, /width:\s*154px/);
    assert.match(controls,
        /backdrop-filter:\s*blur\(28px\)\s+saturate\(175%\)\s+contrast\(106%\)/);
    assert.match(controls, /border-radius:\s*22px/);
    assert.match(html, /#controls::before\s*\{/);
    assert.match(html, /#controls::after\s*\{/);
    assert.match(html, /@supports\s+not\s+\(backdrop-filter:\s*blur\(1px\)\)/);
    assert.match(html,
        /#controls\s*>\s*\*\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*1;/);
    assert.match(html, /id="label-toggle"/);
    assert.match(html, /#label-toggle\.labels-hidden\s*\{/);
});
