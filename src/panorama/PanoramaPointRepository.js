export const PANORAMA_DRAFT_SCHEMA_VERSION = 1;

const STORAGE_PREFIX = 'occt.panorama.points';

function errorResult(code, error, extra = {}) {
    return {
        ok: false,
        ...extra,
        error: {
            code,
            message: error instanceof Error ? error.message : String(error),
        },
    };
}

export class PanoramaPointRepository {
    async load() {
        throw new Error('PanoramaPointRepository.load must be implemented');
    }

    async save() {
        throw new Error('PanoramaPointRepository.save must be implemented');
    }

    async clear() {
        throw new Error('PanoramaPointRepository.clear must be implemented');
    }
}

export class LocalPanoramaPointRepository extends PanoramaPointRepository {
    constructor({
        storage = globalThis.localStorage,
        clock = () => new Date().toISOString(),
        logger = console,
    } = {}) {
        super();
        this.storage = storage;
        this.clock = clock;
        this.logger = logger;
    }

    keyFor(planId, version) {
        const normalizedPlanId = String(planId ?? '').trim();
        const normalizedVersion = String(version ?? '').trim();
        if (!normalizedPlanId || !normalizedVersion) {
            throw new Error('planId and version are required');
        }
        return `${STORAGE_PREFIX}.v${PANORAMA_DRAFT_SCHEMA_VERSION}`
            + `:${encodeURIComponent(normalizedPlanId)}:${encodeURIComponent(normalizedVersion)}`;
    }

    async load(planId, version) {
        let key;
        let rawValue;
        try {
            key = this.keyFor(planId, version);
            rawValue = this.storage.getItem(key);
        } catch (error) {
            return errorResult('STORAGE_ERROR', error, { draft: null });
        }
        if (rawValue == null) return { ok: true, draft: null };

        let envelope;
        try {
            envelope = JSON.parse(rawValue);
        } catch (error) {
            return this._recoverInvalidDraft(planId, version, rawValue, 'CORRUPTED_DRAFT', error);
        }

        if (envelope?.schemaVersion !== PANORAMA_DRAFT_SCHEMA_VERSION) {
            return this._recoverInvalidDraft(
                planId,
                version,
                rawValue,
                'INCOMPATIBLE_SCHEMA',
                new Error(`Unsupported panorama draft schema: ${envelope?.schemaVersion ?? 'missing'}`),
            );
        }
        return { ok: true, draft: envelope.draft ?? null };
    }

    async save(planId, version, draft) {
        try {
            const key = this.keyFor(planId, version);
            const envelope = {
                schemaVersion: PANORAMA_DRAFT_SCHEMA_VERSION,
                planId: String(planId),
                version: String(version),
                savedAt: this.clock(),
                draft,
            };
            this.storage.setItem(key, JSON.stringify(envelope));
            return { ok: true };
        } catch (error) {
            return errorResult('STORAGE_ERROR', error);
        }
    }

    async clear(planId, version) {
        try {
            this.storage.removeItem(this.keyFor(planId, version));
            return { ok: true };
        } catch (error) {
            return errorResult('STORAGE_ERROR', error);
        }
    }

    async backupCorrupted(planId, version, rawValue) {
        try {
            const key = this.keyFor(planId, version);
            const backupKey = `${key}:corrupted:${encodeURIComponent(this.clock())}`;
            this.storage.setItem(backupKey, rawValue);
            this.storage.removeItem(key);
            return { ok: true, backupKey };
        } catch (error) {
            return errorResult('STORAGE_ERROR', error);
        }
    }

    async _recoverInvalidDraft(planId, version, rawValue, code, error) {
        this.logger?.warn?.(`[PanoramaDraft] ${code}`);
        const backup = await this.backupCorrupted(planId, version, rawValue);
        if (!backup.ok) return { ...backup, draft: null };
        return errorResult(code, error, { draft: null, backupKey: backup.backupKey });
    }
}
