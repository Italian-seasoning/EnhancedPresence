import { execFile } from 'node:child_process';

// Battery and Low Power Mode, from two cheap pmset calls. Failures read as "plugged in, normal power".
const run = args => new Promise(resolve => execFile('/usr/bin/pmset', args, { timeout: 3000 }, (error, stdout) => resolve(error ? '' : stdout)));

export function parsePower(battery, settings) {
  const percent = battery.match(/(\d{1,3})%/);
  return {
    onBattery: /drawing from 'Battery Power'/i.test(battery),
    percent: percent ? Math.min(100, Number(percent[1])) : null,
    lowPower: /^\s*lowpowermode\s+1\s*$/m.test(settings)
  };
}

export async function readPower() { return parsePower(await run(['-g', 'batt']), await run(['-g'])); }

// 'auto' saves power in Low Power Mode, or on battery at 20% or below.
export function saverActive(mode, power) {
  if (mode === 'on') return true;
  if (mode === 'off' || !power) return false;
  return power.lowPower || (power.onBattery && power.percent !== null && power.percent <= 20);
}
