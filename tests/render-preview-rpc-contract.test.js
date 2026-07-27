import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const RENDER_PREVIEW_PATH =
  'C:/Users/User/Desktop/cad_plugin/build_resource/PluginResource/html/renderer/render_preview.js';

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.children = [];
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
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
    ...nativeMethods,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    }
  };

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
    invoke(message) {
      listeners.get('message')({ source: iframe.contentWindow, data: {
        channel: 'renderer-preview', version: 1, tabId: 'page-1', type: 'invoke', ...message
      } });
    }
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('render preview validates and forwards parametric native calls with parsed JSON results', async () => {
  const calls = [];
  const harness = createHarness({
    getRenderPreviewContext: () => '{}',
    getParametricGoodsDetail(resId) {
      calls.push(['goods', resId]);
      return '{"id":"42"}';
    },
    convertParametricModel(requestJson) {
      calls.push(['convert', requestJson]);
      return '{"obj":"mesh"}';
    }
  });

  harness.invoke({ requestId: 'goods', method: 'getParametricGoodsDetail', payload: { resId: ' 42 ' } });
  await flush();
  assert.deepEqual(calls[0], ['goods', '42']);
  assert.deepEqual(plain(harness.posts.at(-1).payload), { id: '42' });

  harness.invoke({ requestId: 'convert', method: 'convertParametricModel', payload: {
    url: 'https://example.test/model', parameters: []
  } });
  await flush();
  assert.deepEqual(JSON.parse(calls[1][1]), { url: 'https://example.test/model', parameters: [] });
  assert.deepEqual(plain(harness.posts.at(-1).payload), { obj: 'mesh' });
});

test('render preview rejects invalid parametric payloads and preserves native structured errors', async () => {
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
