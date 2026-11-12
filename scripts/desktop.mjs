import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
// The linker must target Ventura too; lowering Info.plist alone is insufficient.
env.MACOSX_DEPLOYMENT_TARGET = '13.0';
if (existsSync(path.join(root, '.tools/cargo'))) env.CARGO_HOME = path.join(root, '.tools/cargo');
if (existsSync(path.join(root, '.tools/rustup'))) env.RUSTUP_HOME = path.join(root, '.tools/rustup');
env.PATH = [path.dirname(process.execPath), path.join(env.CARGO_HOME || path.join(process.env.HOME, '.cargo'), 'bin'), env.PATH].join(path.delimiter);
const args = process.argv[2] === 'build' ? ['build', '--target', 'aarch64-apple-darwin', ...process.argv.slice(3)] : ['dev', ...process.argv.slice(3)];
const child = spawn(path.join(root, 'node_modules/.bin/tauri'), args, { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
