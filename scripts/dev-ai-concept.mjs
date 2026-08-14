import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const common = { stdio: 'inherit', windowsHide: true, env: process.env };
const api = spawn(process.execPath, ['server/ai-concept-server.mjs'], common);
const vite = spawn(npmCommand, ['run', 'dev:3d'], common);
const children = [api, vite];
let stopping = false;

function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
        if (!child.killed) child.kill('SIGTERM');
    }
    setTimeout(() => process.exit(exitCode), 100).unref();
}

for (const child of children) {
    child.once('error', () => stop(1));
    child.once('exit', code => {
        if (!stopping) stop(Number.isInteger(code) ? code : 1);
    });
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
