/**
 * 数据源
 *
 * 渲染一套户型需要两样东西，且二者是配套的：
 *   1. 户型 JSON —— 房间、门窗，以及软装清单（含每个软装实例的 TypeId 与宽/长）
 *   2. parsed_dxf/{TypeId}_{序号}.json —— 每个软装实例的几何
 *
 * 注意 parsed_dxf 不是 DXF 图例库的直接产物：外部解析器会按实例的宽/长
 * 对图例做参数化拉伸后再输出，因此几何是「按实例」而非「按 TypeId」的，
 * 文件名里的序号就是该软装在 soft_list 中的下标。换一份户型 JSON，
 * 就必须换上与之一同产出的那套 parsed_dxf。
 *
 * 原始 .dxf 用不上——拉伸逻辑不在 DXF 里，浏览器无法自行还原。
 */

import { applySceneFixture } from '../dev/SceneFixtures.js';

/** 内置示例数据：public/data/ 下随仓库分发的那一套 */
export class BundledDataSource {
    constructor(drawingUrl = '/data/Drawing2.json', softlistDir = '/data/parsed_dxf') {
        this.drawingUrl = drawingUrl;
        this.softlistDir = softlistDir;
        this.name = '内置示例数据';
    }

    async loadDrawing() {
        const response = await fetch(this.drawingUrl);
        if (!response.ok) {
            throw new Error(`加载户型数据失败: HTTP ${response.status}`);
        }
        return response.json();
    }

    async loadSoftlist(id) {
        const response = await fetch(`${this.softlistDir}/${id}.json`);
        if (response.status === 404) {
            throw new Error(`软装数据文件不存在: ${id}.json`);
        }
        if (!response.ok) {
            throw new Error(`加载软装${id}失败: HTTP ${response.status}`);
        }
        return response.json();
    }
}

/** 用户从本地选中的文件 */
/**
 * Uses the JSON supplied by the CAD render-preview shell when embedded.
 * Standalone development keeps using the bundled fixture data.
 */
export class RendererPreviewDataSource {
    constructor({ windowRef = globalThis.window, fallback } = {}) {
        this.window = windowRef;
        this.fallback = fallback;
        this.name = 'CAD render preview';
        this.parent = this.window?.parent;
        this.embedded = Boolean(this.parent && this.parent !== this.window);
        this.drawingPromise = null;
        this.contextDrawing = null;
        this.contextError = null;
        this._onMessage = this._onMessage.bind(this);

        if (this.embedded) {
            this.window.addEventListener('message', this._onMessage);
        }
    }

    _onMessage(event) {
        const message = event?.data;
        if (event?.source !== this.parent
            || !message
            || message.channel !== 'renderer-preview'
            || message.version !== 1
            || message.type !== 'context') {
            return;
        }

        const rawData = message.payload?.renderPreviewData;
        if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
            this.contextDrawing = rawData;
            this._resolveDrawing?.(rawData);
            this._clearMessageListener();
            return;
        }

        this.contextError = new Error('CAD render preview data is unavailable');
        this._rejectDrawing?.(this.contextError);
        this._clearMessageListener();
    }

    _clearMessageListener() {
        this.window?.removeEventListener('message', this._onMessage);
        this._resolveDrawing = null;
        this._rejectDrawing = null;
    }

    async loadDrawing() {
        if (!this.embedded) {
            if (!this.fallback) throw new Error('Standalone renderer data source is unavailable');
            return this.fallback.loadDrawing();
        }

        if (this.contextDrawing) return this.contextDrawing;
        if (this.contextError) throw this.contextError;

        if (!this.drawingPromise) {
            this.drawingPromise = new Promise((resolve, reject) => {
                this._resolveDrawing = resolve;
                this._rejectDrawing = reject;
            });
        }
        return this.drawingPromise;
    }

    async loadSoftlist(id) {
        if (!this.fallback) throw new Error(`Softlist data source is unavailable: ${id}`);
        return this.fallback.loadSoftlist(id);
    }

    dispose() {
        this._clearMessageListener();
    }
}

export class LocalFileDataSource {
    /**
     * @param {File} drawingFile - 户型 JSON
     * @param {Map<string, File>} softlistFiles - id（不含 .json）→ 文件
     */
    constructor(drawingFile, softlistFiles = new Map()) {
        this.drawingFile = drawingFile;
        this.softlistFiles = softlistFiles;
        this.name = drawingFile.name;
    }

    async loadDrawing() {
        return readJsonFile(this.drawingFile);
    }

    async loadSoftlist(id) {
        const file = this.softlistFiles.get(id);
        if (!file) {
            throw new Error(`软装数据文件不存在: ${id}.json`);
        }
        return readJsonFile(file);
    }
}

class SceneFixtureDataSource {
    constructor(source, fixtureName) {
        this.source = source;
        this.fixtureName = fixtureName;
        this.name = source?.name;
        this.softlistDir = source?.softlistDir;
    }

    async loadDrawing() {
        return applySceneFixture(await this.source.loadDrawing(), this.fixtureName);
    }

    async loadSoftlist(id) {
        return this.source.loadSoftlist(id);
    }
}

export function withSceneFixture(source, search = '') {
    const fixtureName = new URLSearchParams(String(search).replace(/^\?/, '')).get('fixture');
    const supportedFixtures = new Set([
        '1313', '1408',
        '1402', '140302', '1405', '1406', '140e', '140f', '1305', '1311',
        'ue-specials',
        'cameras',
        'panorama-empty',
    ]);
    return supportedFixtures.has(fixtureName)
        ? new SceneFixtureDataSource(source, fixtureName)
        : source;
}

async function readJsonFile(file) {
    const text = await file.text();
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${file.name} 不是合法的 JSON: ${error.message}`);
    }
}
