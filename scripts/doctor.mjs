import { diagnose } from '../presence-engine/doctor.mjs';

const checks = await diagnose();
for (const check of checks) console.log(`${check.ok ? '✓' : '✗'} ${check.name}${check.ok ? '' : `\n    fix: ${check.fix}`}`);
process.exitCode = checks.every(check => check.ok) ? 0 : 1;
