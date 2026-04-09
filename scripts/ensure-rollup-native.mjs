import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

function detectLinuxLibc() {
  try {
    const report = process.report?.getReport?.();
    if (report?.header?.glibcVersionRuntime) {
      return 'gnu';
    }
  } catch {
    // ignore and fall back to musl guess
  }
  return 'musl';
}

function resolveRollupNativePackage() {
  const { platform, arch } = process;

  if (platform === 'win32') {
    if (arch === 'x64') return '@rollup/rollup-win32-x64-msvc';
    if (arch === 'arm64') return '@rollup/rollup-win32-arm64-msvc';
    if (arch === 'ia32') return '@rollup/rollup-win32-ia32-msvc';
  }

  if (platform === 'darwin') {
    if (arch === 'x64') return '@rollup/rollup-darwin-x64';
    if (arch === 'arm64') return '@rollup/rollup-darwin-arm64';
  }

  if (platform === 'linux') {
    const libc = detectLinuxLibc();
    if (arch === 'x64') return libc === 'gnu' ? '@rollup/rollup-linux-x64-gnu' : '@rollup/rollup-linux-x64-musl';
    if (arch === 'arm64') return libc === 'gnu' ? '@rollup/rollup-linux-arm64-gnu' : '@rollup/rollup-linux-arm64-musl';
    if (arch === 'arm') return libc === 'gnu' ? '@rollup/rollup-linux-arm-gnueabihf' : '@rollup/rollup-linux-arm-musleabihf';
  }

  return null;
}

function getRollupVersion() {
  try {
    return require('rollup/package.json').version;
  } catch {
    return null;
  }
}

function hasPackage(pkgName) {
  try {
    require.resolve(`${pkgName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function installPackage(pkgName, version) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const target = version ? `${pkgName}@${version}` : pkgName;
  const result = spawnSync(npmCmd, ['install', '--no-save', target], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const nativePkg = resolveRollupNativePackage();
if (!nativePkg) {
  process.exit(0);
}

if (hasPackage(nativePkg)) {
  process.exit(0);
}

const version = getRollupVersion();
console.warn(`[ensure-rollup-native] 检测到缺少 ${nativePkg}，正在尝试自动补装...`);
installPackage(nativePkg, version);

if (!hasPackage(nativePkg)) {
  console.error(`[ensure-rollup-native] 自动补装后仍未找到 ${nativePkg}，请手动执行 npm install --no-save ${nativePkg}${version ? `@${version}` : ''}`);
  process.exit(1);
}

console.warn(`[ensure-rollup-native] 已补装 ${nativePkg}，继续构建。`);
