import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const cadPluginRoot = process.env.CAD_PLUGIN_ROOT;
const configuredRendererRoot = process.env.CAD_RENDERER_ROOT;

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.hidden = false;
    this.textContent = '';
    this.title = '';
    this.id = '';
    this.className = '';
    this.type = '';
    this.contentWindow = this.tagName === 'IFRAME'
      ? { postMessage() {} }
      : undefined;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ preventDefault() {}, ...event });
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  focus() {}
}

function createShellHarness() {
  const elements = new Map([
    ['plan-name', new FakeElement('output')],
    ['order-id', new FakeElement('output')],
    ['preview-close', new FakeElement('button')],
    ['preview-tabs', new FakeElement('nav')],
    ['preview-stage', new FakeElement('section')],
  ]);

  const document = {
    hidden: false,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    addEventListener() {},
  };

  const window = {
    addEventListener() {},
    removeEventListener() {},
  };
  window.window = window;

  return { document, elements, window };
}

test('CAD render preview keeps 2D unchanged and exposes the three migrated pages', {
  skip: !cadPluginRoot && !configuredRendererRoot,
}, async () => {
  const rendererRoot = configuredRendererRoot ?? path.join(
      cadPluginRoot,
      'build_resource',
      'PluginResource',
      'html',
      'renderer',
    );
  const source = await readFile(path.join(rendererRoot, 'render_preview.js'), 'utf8');
  const harness = createShellHarness();

  vm.runInNewContext(source, {
    console,
    document: harness.document,
    window: harness.window,
    Map,
    Object,
    Set,
    String,
    Number,
    Array,
    Promise,
  }, { filename: 'render_preview.js' });

  const tabs = harness.elements.get('preview-tabs').children;
  assert.deepEqual(
    tabs.map((tab) => tab.textContent),
    ['户型编辑器', '3D 鸟瞰图', '全景看房', '局部示意图'],
  );

  assert.equal(harness.elements.get('preview-stage').children.length, 4);
  const expectedSources = [
    './cartoon/index.html',
    './preview3d/index.html',
    './preview-panorama/index.html',
    './preview-ai-concept/index.html',
  ];

  for (let index = 0; index < tabs.length; index += 1) {
    tabs[index].dispatch('click');
    const panel = harness.elements.get('preview-stage').children[index];
    assert.equal(panel.children.length, 1);
    assert.equal(panel.children[0].src, expectedSources[index]);
  }
});
