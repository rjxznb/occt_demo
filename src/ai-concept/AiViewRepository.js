export const AI_VIEW_DRAFT_SCHEMA_VERSION = 1;

const STORAGE_PREFIX = 'occt.ai-concept.views';

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

export class AiViewRepository {
    async load() { throw new Error('AiViewRepository.load must be implemented'); }
    async save() { throw new Error('AiViewRepository.save must be implemented'); }
    async clear() { throw new Error('AiViewRepository.clear must be implemented'); }
}

export class LocalAiViewRepository extends AiViewRepository {
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
        if (!normalizedPlanId || !normalizedVersion) throw new Error('planId and version are required');
        return `${STORAGE_PREFIX}.v${AI_VIEW_DRAFT_SCHEMA_VERSION}`
            + `:${encodeURIComponent(normalizedPlanId)}:${encodeURIComponent(normalizedVersion)}`;
    }

    async load(planId, version) {
        let rawValue;
        try {
            rawValue = this.storage.getItem(this.keyFor(planId, version));
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
        if (envelope?.schemaVersion !== AI_VIEW_DRAFT_SCHEMA_VERSION) {
            return this._recoverInvalidDraft(
                planId,
                version,
                rawValue,
                'INCOMPATIBLE_SCHEMA',
                new Error(`Unsupported AI view draft schema: ${envelope?.schemaVersion ?? 'missing'}`),
            );
        }
        return { ok: true, draft: envelope.draft ?? null };
    }

    async save(planId, version, draft) {
        try {
            this.storage.setItem(this.keyFor(planId, version), JSON.stringify({
                schemaVersion: AI_VIEW_DRAFT_SCHEMA_VERSION,
                planId: String(planId),
                version: String(version),
                savedAt: this.clock(),
                draft,
            }));
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
        this.logger?.warn?.(`[AiViewDraft] ${code}`);
        const backup = await this.backupCorrupted(planId, version, rawValue);
        if (!backup.ok) return { ...backup, draft: null };
        return errorResult(code, error, { draft: null, backupKey: backup.backupKey });
    }
}
