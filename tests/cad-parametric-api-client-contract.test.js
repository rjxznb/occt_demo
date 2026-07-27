import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CLIENT_PATH = process.env.CAD_PARAMETRIC_API_CLIENT_PATH;
const integrationSkip = CLIENT_PATH
    ? false
    : 'requires CAD_PARAMETRIC_API_CLIENT_PATH to point to k_parametric_api_client.cpp';

test('native parametric API client keeps fixed endpoints and bounded secure curl settings', { skip: integrationSkip }, async () => {
    const source = await readFile(CLIENT_PATH, 'utf8');

    assert.match(source, /kMaxResponseBytes\s*=\s*64u\s*\*\s*1024u\s*\*\s*1024u/);
    assert.match(source, /CURLOPT_PROTOCOLS[\s\S]*?CURLPROTO_HTTP\s*\|\s*CURLPROTO_HTTPS/);
    assert.match(source, /CURLOPT_FOLLOWLOCATION\s*,\s*0L/);
    assert.match(source, /CURLOPT_SSL_VERIFYPEER\s*,\s*1L/);
    assert.match(source, /CURLOPT_SSL_VERIFYHOST\s*,\s*2L/);
    assert.match(source, /RESPONSE_TOO_LARGE/);
    assert.match(source, /http:\/\/i\.bim-zeus\.home\.ke\.com\/api\/resGoods\/getGoodsDetailById\?id=/);
    assert.match(source, /https:\/\/beinuan\.ke\.com\/mortise-api\/parameter\/modelUrlToObj/);
    assert.match(source, /materialIdDedup/);
    assert.match(source, /mergeGeometry/);
    assert.match(source, /useCache/);
    assert.match(source, /generateWireframe/);
    assert.match(source, /checkSize/);
    assert.doesNotMatch(source, /KeCurlWrapper/);
});
