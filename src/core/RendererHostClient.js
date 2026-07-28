const CHANNEL = 'renderer-preview';
const VERSION = 1;

export class RendererHostClient {
    constructor({
        selfWindow = globalThis.window,
        parentWindow = selfWindow?.parent,
        tabId = 'page-2',
        defaultTimeoutMs = 30_000,
    } = {}) {
        this.selfWindow = selfWindow;
        this.parentWindow = parentWindow;
        this.tabId = tabId;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.pending = new Map();
        this.sequence = 0;
        this.disposed = false;
        this.targetOrigin = selfWindow?.location?.origin || '*';
        this.handleMessage = this.handleMessage.bind(this);
        selfWindow?.addEventListener('message', this.handleMessage);
    }

    isAvailable() {
        return !this.disposed && !!this.selfWindow && !!this.parentWindow &&
            this.parentWindow !== this.selfWindow;
    }

    diagnose(stage, code) {
        this.selfWindow?.__renderPreviewDiagnostic?.(stage, code);
    }

    invoke(method, payload, { timeoutMs = this.defaultTimeoutMs } = {}) {
        if (!this.isAvailable()) {
            this.diagnose('rpc-result', 'BRIDGE_UNAVAILABLE');
            return Promise.reject(Object.assign(new Error('CAD host bridge is unavailable'), {
                code: 'BRIDGE_UNAVAILABLE',
            }));
        }
        const requestId = `${this.tabId}-${Date.now()}-${++this.sequence}`;
        return new Promise((resolve, reject) => {
            const timeoutId = this.selfWindow.setTimeout(() => {
                this.pending.delete(requestId);
                this.diagnose('rpc-timeout', 'TIMEOUT');
                reject(Object.assign(new Error(`Native call timed out: ${method}`), {
                    code: 'TIMEOUT',
                }));
            }, timeoutMs);
            this.pending.set(requestId, { resolve, reject, timeoutId });
            this.diagnose('rpc-send', 'OK');
            this.parentWindow.postMessage({
                channel: CHANNEL,
                version: VERSION,
                tabId: this.tabId,
                type: 'invoke',
                requestId,
                method,
                payload,
            }, this.targetOrigin);
        });
    }

    handleMessage(event) {
        const message = event.data;
        if (event.source !== this.parentWindow || event.origin !== this.targetOrigin ||
            !message || message.channel !== CHANNEL || message.version !== VERSION ||
            message.tabId !== this.tabId || message.type !== 'result') return;
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        this.selfWindow.clearTimeout(pending.timeoutId);
        if (message.ok) {
            this.diagnose('rpc-result', 'OK');
            pending.resolve(message.payload);
            return;
        }
        this.diagnose('rpc-result', 'NATIVE_ERROR');
        const error = new Error(message.error?.message || 'Native call failed');
        error.code = message.error?.code || 'NATIVE_ERROR';
        error.status = message.error?.status;
        pending.reject(error);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.selfWindow?.removeEventListener('message', this.handleMessage);
        for (const pending of this.pending.values()) {
            this.selfWindow.clearTimeout(pending.timeoutId);
            pending.reject(Object.assign(new Error('CAD host bridge disposed'), {
                code: 'CANCELLED',
            }));
        }
        this.pending.clear();
    }
}

export const rendererHostClient = typeof window === 'undefined'
    ? null
    : new RendererHostClient({ tabId: 'page-2' });
