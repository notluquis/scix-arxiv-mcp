import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate cache/state from the real home and neutralise rate limiting (Step 4 relies on this).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scix-arxiv-test-'));
process.env.XDG_CACHE_HOME = dir;
process.env.XDG_STATE_HOME = dir;
process.env.SCIX_ARXIV_RATE_SCALE = '0';

// Cache is on disk and shared by every test in a file; start each test cold.
import { beforeEach } from 'vitest';
beforeEach(() => fs.rmSync(path.join(dir, 'scix-arxiv-mcp'), { recursive: true, force: true }));
