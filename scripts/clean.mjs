import { rm } from 'node:fs/promises';

await rm('.build', { recursive: true, force: true });
await rm('dist/core', { recursive: true, force: true });
