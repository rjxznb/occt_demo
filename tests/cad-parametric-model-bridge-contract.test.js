import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BRIDGE_PATH = process.env.CAD_PARAMETRIC_MODEL_BRIDGE_PATH;
const integrationSkip = BRIDGE_PATH
    ? false
    : 'requires CAD_PARAMETRIC_MODEL_BRIDGE_PATH to point to k_parametric_model_bridge.cpp';

test('native parametric model bridge validates inputs and suppresses callbacks after shutdown', { skip: integrationSkip }, async () => {
    const source = await readFile(BRIDGE_PATH, 'utf8');

    assert.match(source, /BindAsync\(\s*"getParametricGoodsDetail"/);
    assert.match(source, /BindAsync\(\s*"convertParametricModel"/);
    assert.match(source, /args\.size\(\)\s*!=\s*1/);
    assert.match(source, /kMaxGoodsDetailResIdLength\s*=\s*128/);
    assert.match(source, /kMaxModelUrlBytes\s*=\s*8192/);
    assert.match(source, /kMaxParameterCount\s*=\s*64/);
    assert.match(source, /kMaxSerializedRequestBytes\s*=\s*65536/);
    assert.match(source, /std::isfinite/);
    assert.match(source, /INVALID_ARGUMENT/);
    assert.match(source, /INVALID_RESPONSE/);
    assert.match(source, /zstd-base64/);
    assert.match(source, /base64_encode/);
    assert.match(source, /std::lock_guard<std::mutex> lock\(state->mutex\)/);
    assert.match(source, /!state->active\s*\|\|\s*!state->bridge/);
    assert.match(source, /state_->active\s*=\s*false/);
    assert.match(source, /state_->bridge\s*=\s*nullptr/);
    assert.doesNotMatch(source, /\[this\]/);
});
