import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BRIDGE_PATH = process.env.CAD_PARAMETRIC_MODEL_BRIDGE_PATH;
const BROWSER_PATH = process.env.CAD_RENDER_PREVIEW_BROWSER_PATH;
const integrationSkip = BRIDGE_PATH
    ? false
    : 'requires CAD_PARAMETRIC_MODEL_BRIDGE_PATH to point to k_parametric_model_bridge.cpp';
const browserIntegrationSkip = BROWSER_PATH
    ? false
    : 'requires CAD_RENDER_PREVIEW_BROWSER_PATH to point to k_render_preview_browser.cpp';

test('native parametric model bridge validates inputs and suppresses callbacks after shutdown', { skip: integrationSkip }, async () => {
    const source = await readFile(BRIDGE_PATH, 'utf8');

    assert.match(source, /BindAsync\(\s*"getParametricGoodsDetail"/);
    assert.match(source, /BindAsync\(\s*"getContentGoodsDetails"/);
    assert.match(source, /BindAsync\(\s*"getContentMaterialDetails"/);
    assert.match(source, /BindAsync\(\s*"prepareWebModelPackage"/);
    assert.match(source, /BindAsync\(\s*"convertParametricModel"/);
    assert.match(source, /args\.size\(\)\s*!=\s*1/);
    assert.match(source, /args\.front\(\)\.size\(\)\s*>\s*kMaxSerializedRequestBytes[\s\S]*?nlohmann::json::parse/);
    assert.match(source, /kMaxGoodsDetailResIdLength\s*=\s*128/);
    assert.match(source, /kMaxGoodsDetailsCount\s*=\s*50/);
    assert.match(source, /kMaxGoodsDetailsSerializedBytes\s*=\s*8192/);
    assert.match(source, /std::unordered_set<std::string>\s+seen_res_ids/);
    assert.match(source, /!seen_res_ids\.insert\(res_id\)\.second/);
    assert.match(source, /kMaxModelUrlBytes\s*=\s*8192/);
    assert.match(source, /kMaxParameterCount\s*=\s*64/);
    assert.match(source, /kMaxSerializedRequestBytes\s*=\s*65536/);
    assert.match(source, /std::isfinite/);
    assert.match(source, /INVALID_ARGUMENT/);
    assert.match(source, /INVALID_RESPONSE/);
    assert.match(source, /zstd-base64/);
    assert.match(source, /base64_encode/);
    assert.match(source, /bool KParametricModelBridge::ResolveIfActive[\s\S]*?noexcept/);
    assert.match(source, /std::lock_guard<std::mutex> lock\(state->mutex\)/);
    assert.match(source, /!state->active\s*\|\|\s*!state->bridge/);
    assert.match(source, /state_->active\s*=\s*false/);
    assert.match(source, /state_->bridge\s*=\s*nullptr/);
    assert.match(source, /if \(KParametricModelBridge::ResolveIfActive\([\s\S]*?LogSummary/);
    assert.match(source, /\]\([^)]*\)\s+noexcept\s*\{/);
    assert.doesNotMatch(source, /\[this\]/);
});

test('render preview drains queued WebView dispatches before bridge and WebView teardown', { skip: browserIntegrationSkip }, async () => {
    const source = await readFile(BROWSER_PATH, 'utf8');
    const shutdown = source.indexOf('parametric_bridge_->Shutdown()');
    const drain = source.indexOf('DrainWebViewDispatchQueue(webview_, webview_thread_id_)', shutdown);
    const clearBindings = source.indexOf('bridge_->ClearBindings()', shutdown);
    const destroy = source.indexOf('webview_destroy(webview_)', shutdown);

    assert.ok(shutdown >= 0, 'shutdown must occur before teardown');
    assert.ok(drain > shutdown, 'dispatch drain must follow shutdown');
    assert.ok(drain < clearBindings, 'dispatch drain must precede ClearBindings');
    assert.ok(drain < destroy, 'dispatch drain must precede webview_destroy');
    assert.match(source, /webview_dispatch\(/);
    assert.match(source, /PeekMessageW\([^\n]*WM_APP[^\n]*WM_APP/);
    assert.match(source, /GetCurrentThreadId\(\)/);
    assert.match(source, /for\s*\(\s*;\s*;\s*\)[\s\S]*?PeekMessageW[\s\S]*?if\s*\(barrier->completed\)\s*break/);
    assert.match(source, /barrier completion[\s\S]{0,240}?WM_APP queue is empty/i);
});

test('render preview accepts only fixed safe WebView diagnostic envelopes', { skip: browserIntegrationSkip }, async () => {
    const source = await readFile(BROWSER_PATH, 'utf8');

    assert.match(source, /kRenderPreviewDiagnosticMaxBytes\s*=\s*512/);
    assert.match(source, /renderer-preview-diagnostic/);
    assert.match(source, /IsAllowedDiagnosticStage/);
    assert.match(source, /IsAllowedDiagnosticCode/);
    assert.match(source, /diagnostic\.size\(\)\s*!=\s*4/);
    assert.match(source, /get_Source\(&source\)/);
    assert.match(source, /https:\/\/renderer\.local\//);
    assert.match(source, /get_WebMessageAsJson/);
    assert.match(source, /AddScriptToExecuteOnDocumentCreated/);
    assert.match(source, /add_WebMessageReceived/);
    assert.match(source, /add_NavigationCompleted/);
    assert.match(source, /\[RenderPreviewDiag\] stage=%s code=%s/);
    assert.match(source, /document-created/);
    assert.match(source, /dom-content-loaded/);
    assert.match(source, /unhandled-rejection/);
    assert.doesNotMatch(source, /remote-debugging-port|OpenDevToolsWindow/);
});
