import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const source = fileURLToPath(new URL('./', import.meta.url));
const build = fileURLToPath(new URL('../../build/mediaremote', import.meta.url));
const output = fileURLToPath(new URL('../../build/MediaRemoteAdapter.framework', import.meta.url));
execFileSync('cmake', ['-S', source, '-B', build, '-G', 'Xcode'], { stdio: 'inherit' });
execFileSync('cmake', ['--build', build, '--config', 'Release', '--target', 'MediaRemoteAdapter'], { stdio: 'inherit' });
rmSync(output, { recursive: true, force: true }); // a rebuild must replace the old framework
cpSync(`${build}/Release/MediaRemoteAdapter.framework`, output, { recursive: true, force: true, verbatimSymlinks: true });
assert(existsSync(`${output}/MediaRemoteAdapter`), 'Music framework build output is missing');
