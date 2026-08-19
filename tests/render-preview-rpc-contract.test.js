import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const RENDER_PREVIEW_PATH = process.env.CAD_RENDER_PREVIEW_PATH;
const integrationSkip = RENDER_PREVIEW_PATH
  ? false
  : 'requires CAD_RENDER_PREVIEW_PATH to point to render_preview.js';

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.children = [];
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type, event = {}) {
    this.listeners.get(type)?.({ preventDefault() {}, ...event });
  }

  appendChild(child) {
    this.children.push(child);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  focus() {}
}

function createHarness(nativeMethods) {
  const listeners = new Map();
  const posts = [];
  const calls = [];
  const diagnostics = [];
  const elements = new Map();
  const document = {
    hidden: false,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
    createElement(tagName) {
      const element = new FakeElement();
      if (tagName === 'iframe') {
        element.contentWindow = {
          postMessage(message) {
            posts.push(message);
          }
        };
      }
      return element;
    },
    addEventListener() {}
  };
  const window = {
    __renderPreviewDiagnostic(stage, code) {
      diagnostics.push({ stage, code });
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    }
  };
  Object.entries(nativeMethods).forEach(([name, method]) => {
    window[name] = function (...args) {
      calls.push({ name, args });
      return method(...args);
    };
  });

  vm.runInNewContext(fs.readFileSync(RENDER_PREVIEW_PATH, 'utf8'), {
    window,
    document,
    Map,
    Object,
    Array,
    JSON,
    Number,
    String,
    Error
  });

  const iframe = document.getElementById('preview-stage').children[0].children[0];
  return {
    posts,
    calls,
    diagnostics,
    tabTitles() {
      return document.getElementById('preview-tabs').children.map(child => child.textContent);
    },
    invoke(message) {
      listeners.get('message')({ source: iframe.contentWindow, data: {
        channel: 'renderer-preview', version: 1, tabId: 'page-1', type: 'invoke', ...message
      } });
    },
    requestCartoonData(requestId) {
      listeners.get('message')({
        source: iframe.contentWindow,
        origin: 'https://renderer.local',
        data: { type: 'cartoon.render-preview.get-data', requestId },
      });
    },
    ready(tabId) {
      if (tabId !== 'page-1') {
        document.getElementById('preview-tabs').children[1].dispatch('click');
      }
      const readyFrame = document.getElementById('preview-stage').children[
        tabId === 'page-1' ? 0 : 1
      ].children[0];
      listeners.get('message')({
        source: readyFrame.contentWindow,
        origin: 'https://renderer.local',
        data: {
          channel: 'renderer-preview',
          version: 1,
          tabId,
          type: 'ready',
        },
      });
    },
    load(tabId) {
      if (tabId !== 'page-1') {
        document.getElementById('preview-tabs').children[1].dispatch('click');
      }
      const index = { 'page-1': 0, 'page-2': 1, 'page-3': 2, 'page-4': 3 }[tabId];
      const frame = document.getElementById('preview-stage').children[index].children[0];
      frame.dispatch('load');
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('render preview validates and forwards parametric native calls with parsed JSON results', { skip: integrationSkip }, async () => {
  const harness = createHarness({
    getRenderPreviewContext: () => '{}',
    getParametricGoodsDetail: () => '{"id":"42"}',
    getContentGoodsDetails: () => '[{"id":"1961100"},{"id":"2406734"}]',
    getContentMaterialDetails: () => '{"items":[{"code":"PT100"}]}',
    prepareWebModelPackage: () => '{"code":2000,"data":{"resId":"1961113"}}',
    convertParametricModel: () => '{"obj":"mesh"}'
  });

  harness.invoke({ requestId: 'goods', method: 'getParametricGoodsDetail', payload: { resId: ' 42 ' } });
  await flush();
  assert.deepEqual(harness.calls[1], { name: 'getParametricGoodsDetail', args: ['42'] });
  assert.deepEqual(plain(harness.posts.at(-1).payload), { id: '42' });

  harness.invoke({
    requestId: 'batch-goods', method: 'getContentGoodsDetails',
    payload: { resIds: ['1961100', '2406734'] },
  });
  await flush();
  assert.deepEqual(harness.calls.at(-1), {
    name: 'getContentGoodsDetails',
    args: ['{"resIds":["1961100","2406734"]}'],
  });

  harness.invoke({
    requestId: 'materials', method: 'getContentMaterialDetails',
    payload: { materialCodes: ['PT100'] },
  });
  await flush();
  assert.deepEqual(harness.calls.at(-1), {
    name: 'getContentMaterialDetails',
    args: ['{"materialCodes":["PT100"]}'],
  });

  harness.invoke({
    requestId: 'web-model', method: 'prepareWebModelPackage',
    payload: { resId: '1961113' },
  });
  await flush();
  assert.deepEqual(harness.calls.at(-1), {
    name: 'prepareWebModelPackage', args: ['1961113'],
  });

  harness.invoke({ requestId: 'convert', method: 'convertParametricModel', payload: {
    url: 'https://example.test/model', parameters: []
  } });
  await flush();
  assert.deepEqual(JSON.parse(harness.calls.at(-1).args[0]), { url: 'https://example.test/model', parameters: [] });
  assert.deepEqual(plain(harness.posts.at(-1).payload), { obj: 'mesh' });
});

test('render preview rejects invalid parametric payloads and preserves native structured errors', { skip: integrationSkip }, async () => {
  let invoked = false;
  const harness = createHarness({
    getRenderPreviewContext: () => '{}',
    getParametricGoodsDetail() {
      invoked = true;
      throw new Error('{"code":"HTTP_ERROR","message":"upstream failed","status":502}');
    }
  });

  harness.invoke({ requestId: 'invalid', method: 'getParametricGoodsDetail', payload: { resId: ' ' } });
  await flush();
  assert.equal(invoked, false);
  assert.deepEqual(plain(harness.posts.at(-1).error), {
    code: 'INVALID_ARGUMENT', message: 'resId 参数无效'
  });

  harness.invoke({ requestId: 'native-error', method: 'getParametricGoodsDetail', payload: { resId: '42' } });
  await flush();
  assert.deepEqual(plain(harness.posts.at(-1).error), {
    code: 'HTTP_ERROR', message: 'upstream failed', status: 502
  });
});

test('render preview rejects invalid batch goods payloads before calling native code', { skip: integrationSkip }, async () => {
  const harness = createHarness({
    getRenderPreviewContext: () => '{}',
    getContentGoodsDetails: () => '[]'
  });
  const invalidPayloads = [
    { resIds: [] },
    { resIds: Array.from({ length: 51 }, (_, index) => String(index + 1)) },
    { resIds: ['1961100', 'not-numeric'] },
    { resIds: ['1961100', '1961100'] },
    { resIds: ['1961100'], extra: true }
  ];

  for (const [index, payload] of invalidPayloads.entries()) {
    const callsBefore = harness.calls.length;
    harness.invoke({
      requestId: `invalid-batch-${index}`,
      method: 'getContentGoodsDetails',
      payload
    });
    await flush();
    assert.equal(harness.calls.length, callsBefore);
    assert.deepEqual(plain(harness.posts.at(-1).error), {
      code: 'INVALID_ARGUMENT', message: 'resIds 鍙傛暟鏃犳晥'
    });
  }
});

test('outer render preview reports fixed receive and result diagnostics', { skip: integrationSkip }, async () => {
  const successHarness = createHarness({
    getRenderPreviewContext: () => '{}',
    getContentGoodsDetails: () => '[]'
  });
  successHarness.invoke({
    requestId: 'batch', method: 'getContentGoodsDetails', payload: { resIds: ['1961100'] }
  });
  await flush();
  assert.deepEqual(successHarness.diagnostics, [
    { stage: 'outer-rpc-received', code: 'OK' },
    { stage: 'outer-rpc-result', code: 'OK' }
  ]);

  const errorHarness = createHarness({
    getRenderPreviewContext: () => '{}',
    getContentGoodsDetails: () => { throw new Error('private native error'); }
  });
  errorHarness.invoke({
    requestId: 'batch-error', method: 'getContentGoodsDetails', payload: { resIds: ['1961100'] }
  });
  await flush();
  assert.deepEqual(errorHarness.diagnostics, [
    { stage: 'outer-rpc-received', code: 'OK' },
    { stage: 'outer-rpc-result', code: 'NATIVE_ERROR' }
  ]);
  assert.doesNotMatch(JSON.stringify(errorHarness.diagnostics), /private native error|1961100/);
});

test('render preview supplies CAD JSON to the cartoon page on demand', { skip: integrationSkip }, async () => {
  const harness = createHarness({
    getRenderPreviewContext: () => '{}',
    getRenderPreviewData: () => '{"final_room_list":[{"RoomName":"厨房"}]}'
  });

  harness.requestCartoonData('drawing-request');
  await flush();

  assert.ok(harness.calls.some((call) => call.name === 'getRenderPreviewData'));
  assert.deepEqual(plain(harness.posts.at(-1)), {
    type: 'cartoon.render-preview.get-data.response',
    requestId: 'drawing-request',
    ok: true,
    data: '{"final_room_list":[{"RoomName":"厨房"}]}'
  });
});

test('render preview loads CAD JSON only when a data-backed preview page is ready', { skip: integrationSkip }, async () => {
  const harness = createHarness({
    getRenderPreviewContext: () => '{}',
    getRenderPreviewData: () => '{"final_room_list":[{"RoomName":"厨房"}]}',
  });

  await flush();
  assert.equal(
    harness.calls.filter((call) => call.name === 'getRenderPreviewData').length,
    0,
  );

  harness.ready('page-2');
  await flush();

  assert.equal(
    harness.calls.filter((call) => call.name === 'getRenderPreviewData').length,
    1,
  );
  const contextMessage = harness.posts.find(
    (message) => message.tabId === 'page-2' && message.type === 'context',
  );
  assert.deepEqual(plain(contextMessage.payload.renderPreviewData), {
    final_room_list: [{ RoomName: '厨房' }],
  });
});

test('render preview loads CAD JSON when a data-backed iframe loads without a ready handshake', { skip: integrationSkip }, async () => {
  const harness = createHarness({
    getRenderPreviewContext: () => '{}',
    getRenderPreviewData: () => '{"final_room_list":[{"RoomName":"鍘ㄦ埧"}]}',
  });

  harness.load('page-2');
  await flush();

  assert.equal(
    harness.calls.filter((call) => call.name === 'getRenderPreviewData').length,
    1,
  );
  const contextMessage = harness.posts.find(
    (message) => message.tabId === 'page-2' && message.type === 'context',
  );
  assert.deepEqual(plain(contextMessage.payload.renderPreviewData), {
    final_room_list: [{ RoomName: '鍘ㄦ埧' }],
  });
});

test('render preview exposes the three migrated preview tabs without VR', { skip: integrationSkip }, () => {
  const harness = createHarness({
    getRenderPreviewContext: () => '{}',
  });
  const tabs = harness.tabTitles();

  assert.deepEqual(tabs, ['户型编辑器', '3D 预览', '全景看房', '局部示意图']);
});
