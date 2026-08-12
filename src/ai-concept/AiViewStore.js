import { normalizeAiView } from './AiViewModel.js';

const EDITABLE_FIELDS = new Set([
    'name', 'roomId', 'roomIndex', 'roomName', 'roomType',
    'x', 'y', 'z', 'yaw', 'pitch', 'fov',
    'status', 'selected', 'score', 'valid', 'invalidReason',
    'validationMode', 'generationReason', 'taskIds', 'resultIds',
]);

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function canUse(view) {
    return Boolean(view)
        && view.valid !== false
        && !['excluded', 'disabled'].includes(view.status);
}

function sameValue(a, b) {
    return Object.is(a, b);
}

function normalizeDraft(input, context) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.views)) return null;
    return {
        views: input.views.map(view => normalizeAiView(view, context)),
        roomResults: Array.isArray(input.roomResults) ? clone(input.roomResults) : [],
        activeViewId: input.activeViewId == null ? null : String(input.activeViewId),
        activeRoomId: input.activeRoomId == null ? null : String(input.activeRoomId),
    };
}

export class AiViewStore {
    constructor({
        repository = null,
        idFactory = () => `ai-custom:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        clock = () => new Date().toISOString(),
    } = {}) {
        this.repository = repository;
        this.idFactory = idFactory;
        this.clock = clock;
        this.context = null;
        this.phase = 'idle';
        this.views = [];
        this.roomResults = [];
        this.activeViewId = null;
        this.activeRoomId = null;
        this.editingViewId = null;
        this.draftRecovered = false;
        this.persistenceError = null;
        this.listeners = new Set();
    }

    async initialize({ generatedViews = [], roomResults = [], context = null, draft = undefined } = {}) {
        this.context = clone(context);
        let loadedDraft = draft;
        if (loadedDraft === undefined && this.repository && this.context) {
            const result = await this.repository.load(this.context.planId, this.context.version);
            if (result.ok) loadedDraft = result.draft;
            else this.persistenceError = clone(result.error);
        }
        const normalizedDraft = normalizeDraft(loadedDraft, this.context);
        if (normalizedDraft) {
            this.views = normalizedDraft.views;
            this.roomResults = normalizedDraft.roomResults;
            this.activeViewId = normalizedDraft.activeViewId;
            this.activeRoomId = normalizedDraft.activeRoomId;
            this.draftRecovered = true;
        } else {
            this.views = generatedViews.map(view => normalizeAiView(view, this.context));
            this.roomResults = clone(roomResults);
            this.draftRecovered = false;
        }
        this.phase = 'ready';
        this._ensureActiveView();
        return this.getState();
    }

    getState() {
        return deepFreeze({
            phase: this.phase,
            context: clone(this.context),
            views: clone(this.views),
            roomResults: clone(this.roomResults),
            activeViewId: this.activeViewId,
            activeRoomId: this.activeRoomId,
            editingViewId: this.editingViewId,
            draftRecovered: this.draftRecovered,
            persistenceError: clone(this.persistenceError),
            canContinue: this.views.some(view => canUse(view) && view.selected),
        });
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notify() {
        const state = this.getState();
        for (const listener of this.listeners) listener(state);
    }

    _viewIndex(id) {
        return this.views.findIndex(view => view.id === id);
    }

    _ensureActiveView() {
        const current = this.views.find(view => view.id === this.activeViewId);
        if (!canUse(current)) {
            const sameRoom = this.views.find(view => canUse(view) && view.roomId === this.activeRoomId);
            const selected = this.views.find(view => canUse(view) && view.selected);
            const first = this.views.find(canUse);
            this.activeViewId = (sameRoom ?? selected ?? first)?.id ?? null;
        }
        const active = this.views.find(view => view.id === this.activeViewId);
        this.activeRoomId = active?.roomId ?? this.activeRoomId ?? null;
    }

    _draft() {
        return {
            views: clone(this.views),
            roomResults: clone(this.roomResults),
            activeViewId: this.activeViewId,
            activeRoomId: this.activeRoomId,
        };
    }

    async _persist() {
        if (!this.repository || !this.context) return null;
        const result = await this.repository.save(
            this.context.planId,
            this.context.version,
            this._draft(),
        );
        this.persistenceError = result.ok ? null : clone(result.error);
        return result;
    }

    async _commit(changed) {
        if (!changed) return false;
        this._ensureActiveView();
        await this._persist();
        this._notify();
        return true;
    }

    async setActiveView(id) {
        const view = this.views.find(candidate => candidate.id === id);
        if (!canUse(view) || this.activeViewId === id) return false;
        this.activeViewId = id;
        this.activeRoomId = view.roomId;
        return this._commit(true);
    }

    async setRoomFilter(roomId) {
        const normalized = String(roomId ?? '');
        if (!normalized || normalized === this.activeRoomId) return false;
        const view = this.views.find(candidate => canUse(candidate) && candidate.roomId === normalized);
        if (!view) return false;
        this.activeRoomId = normalized;
        this.activeViewId = view.id;
        return this._commit(true);
    }

    async toggleSelected(id) {
        const index = this._viewIndex(id);
        if (index < 0 || !canUse(this.views[index])) return false;
        this.views[index] = { ...this.views[index], selected: !this.views[index].selected, updatedAt: this.clock() };
        return this._commit(true);
    }

    async excludeView(id) {
        const index = this._viewIndex(id);
        const view = this.views[index];
        if (index < 0 || view.source !== 'auto' || view.status === 'excluded') return false;
        this.views[index] = { ...view, status: 'excluded', selected: false, updatedAt: this.clock() };
        if (this.activeViewId === id) this.activeViewId = null;
        return this._commit(true);
    }

    async restoreExcluded() {
        let changed = false;
        this.views = this.views.map(view => {
            if (view.status !== 'excluded') return view;
            changed = true;
            return { ...view, status: 'available', selected: false, updatedAt: this.clock() };
        });
        return this._commit(changed);
    }

    async addCustomView(input = {}) {
        let id = String(input.id ?? '').trim() || String(this.idFactory());
        const used = new Set(this.views.map(view => view.id));
        if (used.has(id)) {
            const base = id;
            let suffix = 2;
            while (used.has(`${base}-${suffix}`)) suffix += 1;
            id = `${base}-${suffix}`;
        }
        const timestamp = this.clock();
        const view = normalizeAiView({
            ...clone(input),
            id,
            source: 'custom',
            status: 'available',
            createdAt: input.createdAt || timestamp,
            updatedAt: timestamp,
        }, this.context);
        this.views.push(view);
        this.activeViewId = view.id;
        this.activeRoomId = view.roomId;
        await this._commit(true);
        return clone(view);
    }

    async deleteCustomView(id) {
        const index = this._viewIndex(id);
        const view = this.views[index];
        if (index < 0 || view.source !== 'custom') return false;
        const linked = (Array.isArray(view.taskIds) && view.taskIds.length)
            || (Array.isArray(view.resultIds) && view.resultIds.length);
        if (linked) {
            this.views[index] = { ...view, status: 'disabled', selected: false, updatedAt: this.clock() };
        } else {
            this.views.splice(index, 1);
        }
        if (this.activeViewId === id) this.activeViewId = null;
        return this._commit(true);
    }

    async disableView(id) {
        const index = this._viewIndex(id);
        if (index < 0 || this.views[index].status === 'disabled') return false;
        this.views[index] = { ...this.views[index], status: 'disabled', selected: false, updatedAt: this.clock() };
        if (this.activeViewId === id) this.activeViewId = null;
        return this._commit(true);
    }

    async updateView(id, patch = {}) {
        const index = this._viewIndex(id);
        if (index < 0) return false;
        const current = this.views[index];
        const next = { ...current };
        let changed = false;
        for (const [key, value] of Object.entries(patch)) {
            if (!EDITABLE_FIELDS.has(key) || sameValue(current[key], value)) continue;
            next[key] = clone(value);
            changed = true;
        }
        if (!changed) return false;
        next.updatedAt = this.clock();
        this.views[index] = normalizeAiView(next, this.context);
        if (Array.isArray(next.taskIds)) this.views[index].taskIds = clone(next.taskIds);
        if (Array.isArray(next.resultIds)) this.views[index].resultIds = clone(next.resultIds);
        return this._commit(true);
    }

    async setPhase(phase, editingViewId = null) {
        const normalized = String(phase ?? 'ready');
        if (this.phase === normalized && this.editingViewId === editingViewId) return false;
        this.phase = normalized;
        this.editingViewId = editingViewId == null ? null : String(editingViewId);
        this._notify();
        return true;
    }
}
