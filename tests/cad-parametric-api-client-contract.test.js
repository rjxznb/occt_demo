import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CLIENT_PATH = process.env.CAD_PARAMETRIC_API_CLIENT_PATH;
const integrationSkip = CLIENT_PATH
    ? false
    : 'requires CAD_PARAMETRIC_API_CLIENT_PATH to point to k_parametric_api_client.cpp';

test('native parametric API client keeps fixed endpoints and bounded secure curl settings', { skip: integrationSkip }, async () => {
    const source = await readFile(CLIENT_PATH, 'utf8');
    const header = await readFile(join(dirname(CLIENT_PATH), 'k_parametric_api_client.h'), 'utf8');

    assert.match(header, /GetGoodsDetails\(\s*const std::vector<std::string>& res_ids\s*\) const/);
    assert.match(header, /GetMaterialDetails\(\s*const std::vector<std::string>& material_codes\s*\) const/);
    assert.match(header, /GetPreparedWebModel\(\s*const std::string& res_id\s*\) const/);
    assert.match(source, /kMaxResponseBytes\s*=\s*64u\s*\*\s*1024u\s*\*\s*1024u/);
    assert.match(source, /CURLOPT_PROTOCOLS[\s\S]*?CURLPROTO_HTTP\s*\|\s*CURLPROTO_HTTPS/);
    assert.match(source, /CURLOPT_FOLLOWLOCATION\s*,\s*0L/);
    assert.match(source, /CURLOPT_SSL_VERIFYPEER\s*,\s*1L/);
    assert.match(source, /CURLOPT_SSL_VERIFYHOST\s*,\s*2L/);
    assert.match(
        source,
        /CURLOPT_SSL_OPTIONS\s*,\s*(?:static_cast<long>\(\s*)?CURLSSLOPT_NATIVE_CA\s*\)?/,
        'HTTPS requests must trust the Windows native CA store',
    );
    assert.match(source, /RESPONSE_TOO_LARGE/);
    assert.match(source, /http:\/\/i\.bim-zeus\.home\.ke\.com\/api\/resGoods\/getGoodsDetailById\?id=/);
    assert.match(source, /biz-gateway\.home\.ke\.com\/utopia-render-platform\/bim\/pc\/render\/getResGoodsDetail/);
    assert.match(source, /resGoodsIdList=/);
    assert.match(source, /loadTexturesFile/);
    assert.match(source, /webV2Url/);
    assert.match(source, /webV2Md5/);
    assert.match(source, /std::unordered_set<std::string>\s+seen_res_ids/);
    assert.match(source, /!seen_res_ids\.insert\(res_id\)\.second/);
    assert.match(source, /CURLSSLOPT_NATIVE_CA/);
    assert.match(source, /https:\/\/beinuan\.ke\.com\/mortise-api\/parameter\/modelUrlToObj/);
    assert.match(source, /materialIdDedup/);
    assert.match(source, /mergeGeometry/);
    assert.match(source, /useCache/);
    assert.match(source, /generateWireframe/);
    assert.match(source, /checkSize/);
    assert.doesNotMatch(source, /CURLOPT_SSL_VERIFYPEER\s*,\s*0/);
    assert.doesNotMatch(source, /CURLOPT_SSL_VERIFYHOST\s*,\s*0/);
    assert.doesNotMatch(source, /KeCurlWrapper/);
});
