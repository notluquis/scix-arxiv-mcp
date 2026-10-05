import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const APP = 'scix-arxiv-mcp';
export const DAY_MS = 86_400_000;
export const TTL_VERSIONED_MS = 30 * DAY_MS;
export const TTL_UNVERSIONED_MS = 3 * DAY_MS;
export const TTL_S2_MS = DAY_MS;
export function cacheDir() {
    return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), APP);
}
export function stateDir() {
    return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), APP);
}
function warn(what, e) {
    process.stderr.write(`scix-arxiv-mcp: cache ${what} failed (${e instanceof Error ? e.message : String(e)}); continuing without it\n`);
}
/**
 * JSON file cache under cacheDir()/kind/sha256(key); TTL by mtime, atomic write (temp + rename).
 * Any cache failure is logged to stderr and falls through to `produce`. A null/undefined result
 * is returned but never stored.
 */
export async function cached(kind, key, ttlMs, produce) {
    let file;
    try {
        file = path.join(cacheDir(), kind, createHash('sha256').update(key).digest('hex'));
        const stat = await fs.stat(file).catch(() => undefined);
        if (stat && Date.now() - stat.mtimeMs < ttlMs) {
            return JSON.parse(await fs.readFile(file, 'utf8'));
        }
    }
    catch (e) {
        warn('read', e);
    }
    const value = await produce();
    if (file && value !== null && value !== undefined) {
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        try {
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(tmp, JSON.stringify(value));
            await fs.rename(tmp, file);
        }
        catch (e) {
            warn('write', e);
            await fs.rm(tmp, { force: true }).catch(() => undefined);
        }
    }
    return value;
}
