const EDITABLE_POINT_FIELDS = new Set([
    'name', 'x', 'y', 'z', 'yaw', 'pitch', 'fov',
    'roomIndex', 'roomName', 'valid', 'invalidReason',
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

function emptyDraft() {
    return {
        overrides: {},
        addedPoints: [],
        deletedPointIds: [],
        initialPointId: null,
        lastActivePointId: null,
        views: {},
    };
}

function normalizeDraft(input) {
    const draft = emptyDraft();
    if (!input || typeof input !== 'object') return draft;
    if (input.overrides && typeof input.overrides === 'object' && !Array.isArray(input.overrides)) {
        draft.overrides = clone(input.overrides);
    }
    if (Array.isArray(input.addedPoints)) draft.addedPoints = clone(input.addedPoints);
    if (Array.isArray(input.deletedPointIds)) {
        draft.deletedPointIds = [...new Set(input.deletedPointIds.map(String))];
    }
    if (input.initialPointId != null) draft.initialPointId = String(input.initialPointId);
    if (input.lastActivePointId != null) draft.lastActivePointId = String(input.lastActivePointId);
    if (input.views && typeof input.views === 'object' && !Array.isArray(input.views)) {
        draft.views = clone(input.views);
    }
    return draft;
}

function sameValue(a, b) {
    return Object.is(a, b);
}

export class PanoramaPointStore {
    constructor({ repository = null, idFactory = null } = {}) {
        this.repository = repository;
        this.idFactory = idFactory ?? (() => `draft:${crypto.randomUUID()}`);
        this.originalPoints = [];
        this.context = null;
        this.draft = emptyDraft();
        this.activePointId = null;
        this.listeners = new Set();
        this.lastPersistenceResult = null;
    }

    async initialize(options = {}) {
        this.originalPoints = clone(Array.isArray(options.originalPoints) ? options.originalPoints : []);
        this.context = clone(options.context ?? null);

        let loadedDraft = Object.prototype.hasOwnProperty.call(options, 'draft')
            ? options.draft
            : undefined;
        if (loadedDraft === undefined && this.repository && this.context) {
            const loaded = await this.repository.load(this.context.planId, this.context.version);
            this.lastPersistenceResult = loaded;
            loadedDraft = loaded.draft;
        }
        this.draft = normalizeDraft(loadedDraft);
        this._ensureSelection();
        return this.getState();
    }

    _points() {
        const deleted = new Set(this.draft.deletedPointIds);
        const originals = this.originalPoints
            .filter(point => !deleted.has(point.id))
            .map(point => ({ ...clone(point), ...clone(this.draft.overrides[point.id] ?? {}) }));
        const added = this.draft.addedPoints
            .filter(point => point && !deleted.has(point.id))
            .map(clone);
        return [...originals, ...added];
    }

    _validPoints() {
        return this._points().filter(point => point.valid !== false);
    }

    _ensureSelection() {
        const validPoints = this._validPoints();
        const validIds = new Set(validPoints.map(point => point.id));
        const firstId = validPoints[0]?.id ?? null;
        if (!validIds.has(this.draft.initialPointId)) this.draft.initialPointId = firstId;
        if (!validIds.has(this.activePointId)) {
            this.activePointId = validIds.has(this.draft.lastActivePointId)
                ? this.draft.lastActivePointId
                : this.draft.initialPointId;
        }
        this.draft.lastActivePointId = this.activePointId;
    }

    getState() {
        const dirtyPointIds = [
            ...Object.keys(this.draft.overrides),
            ...this.draft.addedPoints.map(point => point.id),
            ...this.draft.deletedPointIds,
        ];
        return deepFreeze({
            originalPoints: clone(this.originalPoints),
            points: this._points(),
            initialPointId: this.draft.initialPointId,
            activePointId: this.activePointId,
            lastActivePointId: this.draft.lastActivePointId,
            views: clone(this.draft.views),
            dirtyPointIds: [...new Set(dirtyPointIds)],
            lastPersistenceResult: clone(this.lastPersistenceResult),
        });
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notify() {
        const snapshot = this.getState();
        for (const listener of this.listeners) listener(snapshot);
    }

    async _persist() {
        if (!this.repository || !this.context) return null;
        this.lastPersistenceResult = await this.repository.save(
            this.context.planId,
            this.context.version,
            clone(this.draft),
        );
        return this.lastPersistenceResult;
    }

    async _commitChange(changed) {
        if (!changed) return false;
        this._ensureSelection();
        await this._persist();
        this._notify();
        return true;
    }

    _pointById(id) {
        return this._points().find(point => point.id === id) ?? null;
    }

    async selectPoint(id) {
        const point = this._pointById(id);
        if (!point || point.valid === false || this.activePointId === id) return false;
        this.activePointId = id;
        this.draft.lastActivePointId = id;
        return this._commitChange(true);
    }

    async addPoint(input = {}) {
        let id = String(input.id ?? this.idFactory());
        const usedIds = new Set([...this.originalPoints, ...this.draft.addedPoints].map(point => point.id));
        if (usedIds.has(id)) {
            const base = id;
            let suffix = 2;
            while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
            id = `${base}-${suffix}`;
        }
        const point = {
            name: `点位 ${this._points().length + 1}`,
            x: 0,
            y: 0,
            z: 1500,
            yaw: 0,
            pitch: 0,
            fov: 90,
            valid: true,
            ...clone(input),
            id,
        };
        this.draft.addedPoints.push(point);
        await this._commitChange(true);
        return clone(point);
    }

    async renamePoint(id, name) {
        const normalizedName = String(name ?? '').trim();
        if (!normalizedName) return false;
        return this.updatePoint(id, { name: normalizedName });
    }

    async updatePoint(id, patch = {}) {
        const current = this._pointById(id);
        if (!current) return false;
        const sanitized = {};
        for (const [key, value] of Object.entries(patch)) {
            if (EDITABLE_POINT_FIELDS.has(key) && !sameValue(current[key], value)) {
                sanitized[key] = clone(value);
            }
        }
        if (!Object.keys(sanitized).length) return false;

        const addedIndex = this.draft.addedPoints.findIndex(point => point.id === id);
        if (addedIndex >= 0) {
            this.draft.addedPoints[addedIndex] = {
                ...this.draft.addedPoints[addedIndex],
                ...sanitized,
            };
        } else {
            this.draft.overrides[id] = {
                ...(this.draft.overrides[id] ?? {}),
                ...sanitized,
            };
        }
        return this._commitChange(true);
    }

    async deletePoint(id) {
        if (!this._pointById(id)) return false;
        const addedIndex = this.draft.addedPoints.findIndex(point => point.id === id);
        if (addedIndex >= 0) {
            this.draft.addedPoints.splice(addedIndex, 1);
        } else if (!this.draft.deletedPointIds.includes(id)) {
            this.draft.deletedPointIds.push(id);
        }
        delete this.draft.overrides[id];
        delete this.draft.views[id];
        if (this.activePointId === id) this.activePointId = null;
        if (this.draft.initialPointId === id) this.draft.initialPointId = null;
        return this._commitChange(true);
    }

    async setInitialPoint(id) {
        const point = this._pointById(id);
        if (!point || point.valid === false || this.draft.initialPointId === id) return false;
        this.draft.initialPointId = id;
        return this._commitChange(true);
    }

    async restorePoint(id) {
        let changed = false;
        const addedIndex = this.draft.addedPoints.findIndex(point => point.id === id);
        if (addedIndex >= 0) {
            this.draft.addedPoints.splice(addedIndex, 1);
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(this.draft.overrides, id)) {
            delete this.draft.overrides[id];
            changed = true;
        }
        const deletedIndex = this.draft.deletedPointIds.indexOf(id);
        if (deletedIndex >= 0) {
            this.draft.deletedPointIds.splice(deletedIndex, 1);
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(this.draft.views, id)) {
            delete this.draft.views[id];
            changed = true;
        }
        return this._commitChange(changed);
    }

    async restoreAll() {
        const changed = Object.keys(this.draft.overrides).length > 0
            || this.draft.addedPoints.length > 0
            || this.draft.deletedPointIds.length > 0
            || Object.keys(this.draft.views).length > 0
            || this.draft.initialPointId !== this.originalPoints.find(point => point.valid !== false)?.id
            || this.draft.lastActivePointId !== this.originalPoints.find(point => point.valid !== false)?.id;
        if (!changed) return false;
        this.draft = emptyDraft();
        this.activePointId = null;
        this._ensureSelection();
        if (this.repository && this.context) {
            this.lastPersistenceResult = await this.repository.clear(
                this.context.planId,
                this.context.version,
            );
        }
        this._notify();
        return true;
    }

    async updateView(id, view = {}) {
        if (!this._pointById(id)) return false;
        const current = this.draft.views[id] ?? {};
        const next = { ...current };
        for (const key of ['yaw', 'pitch', 'fov']) {
            const value = Number(view[key]);
            if (Number.isFinite(value)) next[key] = value;
        }
        const changed = ['yaw', 'pitch', 'fov'].some(key => !sameValue(current[key], next[key]));
        if (!changed) return false;
        this.draft.views[id] = next;
        return this._commitChange(true);
    }
}
