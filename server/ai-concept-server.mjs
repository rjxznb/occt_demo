import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createAiConceptApiHandler } from './ai-concept/AiConceptApiHandler.mjs';
import { AiGenerationQueue } from './ai-concept/AiGenerationQueue.mjs';
import { AiGenerationRepository } from './ai-concept/AiGenerationRepository.mjs';
import { OpenAiImageClient, OpenAiImageError } from './ai-concept/OpenAiImageClient.mjs';

const MIME_TYPES = Object.freeze({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
});

function positiveInteger(value, code) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new Error(code);
    return number;
}

function notConfiguredClient() {
    return {
        async edit() {
            throw new OpenAiImageError('OPENAI_NOT_CONFIGURED', 'OpenAI is not configured.');
        },
    };
}

async function serveStatic(req, res, staticDir) {
    if (!['GET', 'HEAD'].includes(req.method ?? '')) return false;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
    const relative = pathname === '/' ? 'index-ai-concept.html' : pathname.replace(/^\/+/, '');
    const root = resolve(staticDir);
    const path = resolve(root, relative);
    if (path !== root && !path.startsWith(`${root}${sep}`)) return false;
    try {
        const bytes = await readFile(path);
        res.writeHead(200, {
            'content-type': MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
            'content-length': bytes.length,
        });
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return false;
        throw error;
    }
}

export async function startAiConceptServer({
    host = '127.0.0.1',
    port = process.env.AI_CONCEPT_PORT ?? 8787,
    concurrency = process.env.AI_CONCEPT_CONCURRENCY ?? 2,
    apiKey = process.env.OPENAI_API_KEY ?? '',
    runtimeDir = resolve('runtime/ai-concept'),
    staticDir = resolve('dist-3d'),
    production = false,
} = {}) {
    const queueConcurrency = positiveInteger(concurrency, 'INVALID_AI_CONCEPT_CONCURRENCY');
    const listenPort = Number(port);
    if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
        throw new Error('INVALID_AI_CONCEPT_PORT');
    }
    const repository = new AiGenerationRepository({ rootDir: runtimeDir });
    const configured = typeof apiKey === 'string' && apiKey.trim().length > 0;
    const imageClient = configured ? new OpenAiImageClient({ apiKey }) : notConfiguredClient();
    const queue = new AiGenerationQueue({ repository, imageClient, concurrency: queueConcurrency });
    await queue.recover();
    const apiHandler = createAiConceptApiHandler({ repository, queue, apiConfigured: configured });
    const server = createServer(async (req, res) => {
        try {
            if (await apiHandler(req, res)) return;
            if (production && await serveStatic(req, res, staticDir)) return;
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Not found');
        } catch {
            if (!res.writableEnded) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ code: 'INTERNAL_ERROR' }));
            }
        }
    });
    await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(listenPort, host, () => {
            server.off('error', rejectListen);
            resolveListen();
        });
    });
    const address = server.address();
    const origin = `http://${host}:${address.port}`;
    let closed = false;
    return {
        origin,
        async close() {
            if (closed) return;
            closed = true;
            server.closeAllConnections?.();
            await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
        },
    };
}

const isMain = process.argv[1]
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
    const server = await startAiConceptServer({ production: true });
    console.log(`AI concept server listening at ${server.origin}`);
    const shutdown = async () => { await server.close(); process.exit(0); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}
