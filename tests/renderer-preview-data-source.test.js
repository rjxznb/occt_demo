import test from 'node:test';
import assert from 'node:assert/strict';
import { RendererPreviewDataSource } from '../src/core/DataSource.js';

class FakeWindow {
    constructor({ embedded = true } = {}) {
        this.listeners = new Map();
        this.parent = embedded ? {} : this;
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }

    emit(type, event) {
        this.listeners.get(type)?.(event);
    }
}

test('embedded renderer uses the CAD context JSON instead of the bundled drawing', async () => {
    const windowRef = new FakeWindow();
    const parentWindow = windowRef.parent;
    const bundled = {
        async loadDrawing() {
            throw new Error('bundled drawing must not be loaded in CAD');
        },
        async loadSoftlist(id) {
            return { id };
        },
    };
    const source = new RendererPreviewDataSource({ windowRef, fallback: bundled });
    const drawingPromise = source.loadDrawing();
    const drawing = { final_room_list: [{ RoomName: '厨房' }], soft_list: [] };

    windowRef.emit('message', {
        source: parentWindow,
        data: {
            channel: 'renderer-preview',
            version: 1,
            type: 'context',
            payload: { renderPreviewData: drawing },
        },
    });

    assert.deepEqual(await drawingPromise, drawing);
});

test('embedded renderer retains context that arrives before drawing initialization', async () => {
    const windowRef = new FakeWindow();
    const parentWindow = windowRef.parent;
    const source = new RendererPreviewDataSource({
        windowRef,
        fallback: { async loadDrawing() { throw new Error('unexpected fallback'); } },
    });
    const drawing = { final_room_list: [{ RoomName: '客厅' }], soft_list: [] };

    windowRef.emit('message', {
        source: parentWindow,
        data: {
            channel: 'renderer-preview',
            version: 1,
            type: 'context',
            payload: { renderPreviewData: drawing },
        },
    });

    assert.deepEqual(await Promise.race([
        source.loadDrawing(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('drawing timed out')), 20)),
    ]), drawing);
});

test('standalone renderer keeps the bundled drawing fallback', async () => {
    const windowRef = new FakeWindow({ embedded: false });
    const fallback = {
        async loadDrawing() {
            return { final_room_list: [{ RoomName: '本地示例' }] };
        },
        async loadSoftlist(id) {
            return { id };
        },
    };
    const source = new RendererPreviewDataSource({ windowRef, fallback });

    assert.deepEqual(await source.loadDrawing(), {
        final_room_list: [{ RoomName: '本地示例' }],
    });
});
