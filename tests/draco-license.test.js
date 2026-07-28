import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const dracoDirectory = new URL('../public/data/draco/', import.meta.url);

test('Draco redistribution includes the official local license and locked Three provenance', async () => {
    const [license, readme, packageJson] = await Promise.all([
        readFile(new URL('LICENSE', dracoDirectory), 'utf8'),
        readFile(new URL('README.md', dracoDirectory), 'utf8'),
        readFile(new URL('../node_modules/three/package.json', import.meta.url), 'utf8'),
    ]);
    const normalizedLicense = license.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';

    assert.equal(JSON.parse(packageJson).version, '0.178.0');
    assert.equal(
        createHash('sha256').update(normalizedLicense).digest('hex'),
        'd3709b0fb4b8a94bbb1d02b8a2e484f258b0d9c5c5a01f940391f3fe662cd1a4',
    );
    assert.match(readme, /three@0\.178\.0/);
    assert.match(readme, /node_modules\/three\/examples\/jsm\/libs\/draco\/gltf/);
    assert.match(readme, /\[local Apache-2\.0 license\]\(\.\/LICENSE\)/);
});
