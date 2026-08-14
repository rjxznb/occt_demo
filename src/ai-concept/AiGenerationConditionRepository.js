import {
    DEFAULT_GENERATION_CONDITIONS,
    normalizeGenerationConditions,
} from './AiGenerationCatalog.js';

export const AI_GENERATION_CONDITION_SCHEMA_VERSION = 1;
const STORAGE_PREFIX = 'occt.ai-concept-generation.conditions';

function copyDefaults() {
    return {
        styleIds: [...DEFAULT_GENERATION_CONDITIONS.styleIds],
        environmentIds: [...DEFAULT_GENERATION_CONDITIONS.environmentIds],
    };
}

function failure(code, error) {
    return {
        ok: false,
        conditions: copyDefaults(),
        error: { code, message: error instanceof Error ? error.message : String(error) },
    };
}

export class LocalAiGenerationConditionRepository {
    constructor({ storage = globalThis.localStorage, clock = () => new Date().toISOString() } = {}) {
        this.storage = storage;
        this.clock = clock;
    }

    keyFor(context = {}) {
        const planId = String(context.planId ?? '').trim();
        const version = String(context.planVersion ?? context.version ?? '').trim();
        if (!planId || !version) throw new Error('planId and planVersion are required');
        return `${STORAGE_PREFIX}.v${AI_GENERATION_CONDITION_SCHEMA_VERSION}`
            + `:${encodeURIComponent(planId)}:${encodeURIComponent(version)}`;
    }

    async load(context) {
        let raw;
        try {
            raw = this.storage.getItem(this.keyFor(context));
        } catch (error) {
            return failure('STORAGE_ERROR', error);
        }
        if (raw == null) return { ok: true, conditions: copyDefaults() };
        let envelope;
        try {
            envelope = JSON.parse(raw);
        } catch (error) {
            return failure('CORRUPTED_DRAFT', error);
        }
        if (envelope?.schemaVersion !== AI_GENERATION_CONDITION_SCHEMA_VERSION) {
            return failure('INCOMPATIBLE_SCHEMA', new Error('Unsupported generation condition schema'));
        }
        const conditions = normalizeGenerationConditions(envelope.conditions);
        return {
            ok: true,
            conditions: conditions.styleIds.length && conditions.environmentIds.length
                ? conditions
                : copyDefaults(),
        };
    }

    async save(context, input) {
        const conditions = normalizeGenerationConditions(input);
        try {
            this.storage.setItem(this.keyFor(context), JSON.stringify({
                schemaVersion: AI_GENERATION_CONDITION_SCHEMA_VERSION,
                planId: String(context.planId),
                planVersion: String(context.planVersion ?? context.version),
                updatedAt: this.clock(),
                conditions,
            }));
            return { ok: true, conditions };
        } catch (error) {
            return failure('STORAGE_ERROR', error);
        }
    }
}
