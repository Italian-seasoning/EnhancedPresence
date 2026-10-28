import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { measure, limits } from '../presence-engine/perf.mjs';

// Opt-in (ENHANCED_PRESENCE_PERF=1): the idle engine should stay close to zero CPU.
test('idle engine stays within the CPU and memory limits', { skip: process.platform !== 'darwin' || process.env.ENHANCED_PRESENCE_PERF !== '1' }, async t => {
  const engine = spawn(process.execPath, [new URL('../presence-engine/main.mjs', import.meta.url).pathname], { stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => engine.kill());
  await new Promise(resolve => setTimeout(resolve, 2000));
  const use = await measure(4000);
  assert.ok(use.processes.some(p => p.pid === engine.pid), 'engine process was measured');
  assert.ok(use.cpuPercent < limits.cpuPercent, `CPU ${use.cpuPercent}%`);
  assert.ok(use.rssMB < limits.rssMB, `memory ${use.rssMB} MB`);
});
