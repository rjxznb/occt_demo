import { createHash, randomUUID } from 'node:crypto';
import {
    mkdir, readFile, readdir, rename, stat, writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { aggregateJobStatus } from './AiGenerationJobModel.mjs';

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MIME_EXTENSIONS = Object.freeze({ 'image/webp': 'webp', 'image/png': 'png' });

function repositoryError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function assertId(value, pattern, code) {
    const id = String(value ?? '');
    if (!pattern.test(id)) throw repositoryError(code);
    return id;
}

function safeSegment(value) {
    const raw = String(value ?? '');
    const slug = raw.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'id';
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12);
    return `${slug}-${hash}`;
}

function clone(value) {
    return structuredClone(value);
}

async function walkForJobFiles(rootDir) {
    const found = [];
    async function walk(directory) {
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
            if (error?.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.isFile() && entry.name === 'job.json') found.push(path);
        }
    }
    await walk(rootDir);
    return found;
}

export class AiGenerationRepository {
    constructor({ rootDir = resolve('runtime/ai-concept') } = {}) {
        this.rootDir = resolve(rootDir);
        this.jobPaths = new Map();
        this.indexed = false;
    }

    _jobDirectory(job) {
        const id = assertId(job?.id, JOB_ID, 'INVALID_JOB_ID');
        return join(this.rootDir, safeSegment(job?.planId), safeSegment(job?.planVersion), id);
    }

    _assertControlled(path) {
        const resolved = resolve(path);
        if (resolved !== this.rootDir && !resolved.startsWith(`${this.rootDir}${sep}`)) {
            throw repositoryError('PATH_OUTSIDE_REPOSITORY');
        }
        return resolved;
    }

    async _index() {
        if (this.indexed) return;
        await mkdir(this.rootDir, { recursive: true });
        for (const metadataPath of await walkForJobFiles(this.rootDir)) {
            try {
                const parsed = JSON.parse(await readFile(metadataPath, 'utf8'));
                if (JOB_ID.test(String(parsed?.id ?? ''))) this.jobPaths.set(parsed.id, metadataPath);
            } catch {}
        }
        this.indexed = true;
    }

    async _atomicWrite(path, bytes) {
        const target = this._assertControlled(path);
        await mkdir(dirname(target), { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, bytes);
            for (let attempt = 1; ; attempt += 1) {
                try {
                    await rename(temporary, target);
                    break;
                } catch (error) {
                    const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
                    if (!transient || attempt >= 5) throw error;
                    await new Promise(resolveDelay => setTimeout(resolveDelay, attempt * 5));
                }
            }
        } catch (error) {
            try {
                const { rm } = await import('node:fs/promises');
                await rm(temporary, { force: true });
            } catch {}
            throw error;
        }
    }

    async createJob(job) {
        await this._index();
        const id = assertId(job?.id, JOB_ID, 'INVALID_JOB_ID');
        if (this.jobPaths.has(id)) throw repositoryError('JOB_ALREADY_EXISTS');
        const directory = this._jobDirectory(job);
        const metadataPath = join(directory, 'job.json');
        await this._atomicWrite(metadataPath, `${JSON.stringify(job, null, 2)}\n`);
        this.jobPaths.set(id, metadataPath);
        return clone(job);
    }

    async loadJob(jobId) {
        const id = assertId(jobId, JOB_ID, 'INVALID_JOB_ID');
        await this._index();
        const metadataPath = this.jobPaths.get(id);
        if (!metadataPath) return null;
        return JSON.parse(await readFile(metadataPath, 'utf8'));
    }

    async findJobByRequestId(requestId) {
        const target = String(requestId ?? '');
        if (!target) return null;
        await this._index();
        for (const id of [...this.jobPaths.keys()].sort()) {
            const job = await this.loadJob(id);
            if (job?.requestId === target) return job;
        }
        return null;
    }

    async saveJob(job) {
        const id = assertId(job?.id, JOB_ID, 'INVALID_JOB_ID');
        await this._index();
        const metadataPath = this.jobPaths.get(id);
        if (!metadataPath) throw repositoryError('JOB_NOT_FOUND');
        await this._atomicWrite(metadataPath, `${JSON.stringify(job, null, 2)}\n`);
        return clone(job);
    }

    async _writeAsset(kind, jobId, assetId, bytes, mimeType) {
        const id = assertId(jobId, JOB_ID, 'INVALID_JOB_ID');
        const controlledAssetId = assertId(assetId, ASSET_ID, 'INVALID_ASSET_ID');
        const extension = MIME_EXTENSIONS[mimeType];
        if (!extension) throw repositoryError('INVALID_ASSET_MIME_TYPE');
        await this._index();
        const metadataPath = this.jobPaths.get(id);
        if (!metadataPath) throw repositoryError('JOB_NOT_FOUND');
        const path = join(dirname(metadataPath), kind, `${controlledAssetId}.${extension}`);
        await this._atomicWrite(path, Buffer.from(bytes));
        return {
            assetId: controlledAssetId,
            mimeType,
            url: `/api/ai-concept/jobs/${id}/assets/${controlledAssetId}`,
        };
    }

    writeInput(jobId, assetId, bytes, mimeType = 'image/webp') {
        return this._writeAsset('inputs', jobId, assetId, bytes, mimeType);
    }

    writeOutput(jobId, assetId, bytes, mimeType = 'image/png') {
        return this._writeAsset('outputs', jobId, assetId, bytes, mimeType);
    }

    async readAsset(jobId, assetId) {
        const id = assertId(jobId, JOB_ID, 'INVALID_JOB_ID');
        const controlledAssetId = assertId(assetId, ASSET_ID, 'INVALID_ASSET_ID');
        await this._index();
        const metadataPath = this.jobPaths.get(id);
        if (!metadataPath) throw repositoryError('JOB_NOT_FOUND');
        const directory = dirname(metadataPath);
        for (const kind of ['inputs', 'outputs']) {
            for (const [mimeType, extension] of Object.entries(MIME_EXTENSIONS)) {
                const path = this._assertControlled(join(directory, kind, `${controlledAssetId}.${extension}`));
                try {
                    if ((await stat(path)).isFile()) return { assetId: controlledAssetId, mimeType, path, bytes: await readFile(path) };
                } catch (error) {
                    if (error?.code !== 'ENOENT') throw error;
                }
            }
        }
        throw repositoryError('ASSET_NOT_FOUND');
    }

    async listRecoverableJobs() {
        await this._index();
        const recoverable = [];
        for (const id of [...this.jobPaths.keys()].sort()) {
            const job = await this.loadJob(id);
            let changed = false;
            for (const item of job?.items ?? []) {
                if (item.status !== 'running') continue;
                item.status = 'interrupted';
                item.error = { code: 'PROCESS_RESTARTED', retryable: true };
                changed = true;
            }
            if (changed) {
                job.status = aggregateJobStatus(job.items);
                await this.saveJob(job);
            }
            if ((job?.items ?? []).some(item => ['queued', 'interrupted'].includes(item.status))) {
                recoverable.push(job);
            }
        }
        return recoverable;
    }
}
