// Test runner for the unit/integration suites.
// `node --test` defaults to availableParallelism() - 1 workers, which is a
// single worker on small CI boxes and left the suites running strictly one
// after another. Every suite here is self-contained (no ports, no servers,
// no wall-clock assertions), so files may run side by side. We keep one
// worker of headroom for the OS but never fewer than two.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';

const files = readdirSync('tests')
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => `tests/${name}`);
const concurrency = Math.max(2, availableParallelism() - 1);

const result = spawnSync(
  process.execPath,
  ['--test', `--test-concurrency=${concurrency}`, ...files],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
