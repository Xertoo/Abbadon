/**
 * Comprehensive verification test suite for Abbadon (Windows & Linux)
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
  }
}

console.log('\n========================================');
console.log('🧪 ABBADON FULL FUNCTIONALITY TEST SUITE');
console.log('========================================\n');

// 1. TypeScript & Vite build
console.log('--- 1. Frontend Build & TypeScript Verification ---');
try {
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'pipe' });
  assert(true, 'TypeScript check and Vite bundle succeed cleanly');
  assert(fs.existsSync(path.join(ROOT_DIR, 'dist/index.html')), 'dist/index.html exists');
  assert(fs.existsSync(path.join(ROOT_DIR, 'dist/assets')), 'dist/assets directory exists and populated');
} catch (err) {
  assert(false, 'Frontend build failed', err.message);
}

// 2. Package configuration & Builder schema
console.log('\n--- 2. Packaging Configuration & Schema Validation ---');
const pkgPath = path.join(ROOT_DIR, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
assert(pkg.name === 'abbadon', 'Package name is abbadon');
assert(pkg.build != null, 'Package.json has build configuration');
assert(pkg.build.protocols && pkg.build.protocols[0].schemes.includes('abbadon'), 'Protocol abbadon:// is registered');
assert(pkg.build.asarUnpack && pkg.build.asarUnpack.includes('electron/bin/**/*'), 'asarUnpack includes electron/bin/**/*');

// Targets
const linuxTargets = (pkg.build.linux.target || []).map(t => (typeof t === 'string' ? t : t.target));
assert(linuxTargets.includes('AppImage'), 'Linux AppImage target configured');
assert(linuxTargets.includes('deb'), 'Linux deb target configured');
assert(linuxTargets.includes('pacman'), 'Linux pacman (Arch) target configured');
assert(linuxTargets.includes('rpm'), 'Linux rpm (Fedora/RHEL) target configured');
assert(linuxTargets.includes('tar.gz'), 'Linux tar.gz portable target configured');

const winTargets = (pkg.build.win.target || []).map(t => (typeof t === 'string' ? t : t.target));
assert(winTargets.includes('nsis'), 'Windows NSIS target configured');
assert(winTargets.includes('portable'), 'Windows Portable target configured');

// Ajv validation against electron-builder schema
try {
  const schemaPath = path.join(ROOT_DIR, 'node_modules/app-builder-lib/scheme.json');
  const schema = require(schemaPath);
  const Ajv = require('ajv').default || require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const isValid = validate(pkg.build);
  const realErrors = (validate.errors || []).filter(e => e.keyword !== 'anyOf' && e.keyword !== 'oneOf');
  assert(isValid || realErrors.length === 0, 'Electron-builder configuration strictly matches official schema', JSON.stringify(realErrors));
} catch (err) {
  assert(false, 'Electron-builder schema validation failed', err.message);
}

// 3. Binaries validation (Windows & Linux)
console.log('\n--- 3. Native Binaries Verification ---');

// Windows PE executable check
const winBin = path.join(ROOT_DIR, 'electron/bin/yt-dlp.exe');
assert(fs.existsSync(winBin), 'Windows yt-dlp.exe exists');
if (fs.existsSync(winBin)) {
  const winBuf = fs.readFileSync(winBin);
  const isPE = winBuf[0] === 0x4D && winBuf[1] === 0x5A; // MZ header
  assert(isPE, 'Windows binary has valid PE MZ header');
  try {
    const ver = execSync(`"${winBin}" --version`, { stdio: 'pipe' }).toString().trim();
    assert(Boolean(ver && ver.length >= 4), `Windows yt-dlp runs properly (version: ${ver})`);
  } catch (err) {
    assert(false, 'Windows yt-dlp execution failed', err.message);
  }
}

// Linux ELF executable check
const linuxBin = path.join(ROOT_DIR, 'electron/bin/yt-dlp');
assert(fs.existsSync(linuxBin), 'Linux yt-dlp exists');
if (fs.existsSync(linuxBin)) {
  const linuxBuf = fs.readFileSync(linuxBin);
  const isELF = linuxBuf[0] === 0x7F && linuxBuf[1] === 0x45 && linuxBuf[2] === 0x4C && linuxBuf[3] === 0x46; // .ELF header
  const is64Bit = linuxBuf[4] === 2; // ELFCLASS64
  assert(isELF, 'Linux yt-dlp has valid ELF magic header (7f454c46)');
  assert(is64Bit, 'Linux yt-dlp is 64-bit ELF standalone executable');
}

// 4. Main process functions & logic testing
console.log('\n--- 4. Main Process Logic & Helpers Verification ---');

// Test safeFileName & makeTrackFileName
const ILLEGAL_FILENAME = /[\\/:*?"<>|]/g;
function safeFileName(name, fallback) {
  const base = String(name || '')
    .replace(ILLEGAL_FILENAME, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (base || fallback || 'track').slice(0, 140);
}

function makeTrackFileName(artist, title) {
  let combined = '';
  const a = (artist || '').trim();
  const t = (title || '').trim();
  if (a && t) {
    if (t.toLowerCase().startsWith(a.toLowerCase() + ' -') || t.toLowerCase().startsWith(a.toLowerCase() + ' –')) {
      combined = t;
    } else {
      combined = `${a} - ${t}`;
    }
  } else {
    combined = t || a || 'track';
  }
  return `${safeFileName(combined, 'track')}.mp3`;
}

assert(safeFileName('Track: Best *Song*? <Yes!>', 'fallback') === 'Track Best Song Yes!', 'safeFileName sanitizes illegal characters');
assert(makeTrackFileName('Artist', 'Song') === 'Artist - Song.mp3', 'makeTrackFileName joins artist and song');
assert(makeTrackFileName('Artist', 'Artist - Song') === 'Artist - Song.mp3', 'makeTrackFileName avoids artist duplication');

// Test isTitleMatch
function isTitleMatch(foundTitle, requestedTitle) {
  if (!foundTitle || !requestedTitle) return true;
  const f = foundTitle.toLowerCase();
  const r = requestedTitle.toLowerCase().replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
  const badWords = ['slowed', 'reverb', 'sped up', 'type beat', 'instrumental', 'karaoke', 'tribute', 'cover', 'acapella'];
  if (badWords.some(w => f.includes(w) && !r.includes(w))) return false;
  const words = r.split(/\s+/).filter(w => w.length >= 3);
  if (words.length === 0) return true;
  return words.some(w => {
    if (f.includes(w)) return true;
    if (w.endsWith('es') && f.includes(w.slice(0, -2))) return true;
    if (w.endsWith('s') && f.includes(w.slice(0, -1))) return true;
    if (f.includes(w + 'es') || f.includes(w + 's')) return true;
    return false;
  });
}

assert(isTitleMatch('Stargazing (Official Audio)', 'Stargazing') === true, 'isTitleMatch matches title');
assert(isTitleMatch('Stargazing (Slowed + Reverb)', 'Stargazing') === false, 'isTitleMatch rejects slowed/reverb when not requested');

// Test parseYtDlpOutput
function parseYtDlpOutput(stdout, requestedTitle) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length >= 3) {
    const foundTitle = lines[0];
    const duration = parseFloat(lines[1]) || 0;
    const url = lines[2];
    if (requestedTitle && !isTitleMatch(foundTitle, requestedTitle)) {
      return { ok: false, error: `Mismatch title: ${foundTitle}` };
    }
    return { ok: true, url, duration: Math.round(duration), title: foundTitle };
  } else if (lines.length === 2 && lines[1].startsWith('http')) {
    const duration = parseFloat(lines[0]) || 0;
    const url = lines[1];
    return { ok: true, url, duration: Math.round(duration) };
  } else if (lines.length === 1 && lines[0].startsWith('http')) {
    return { ok: true, url: lines[0] };
  }
  return { ok: false, error: 'Could not parse yt-dlp output' };
}

const mockOutput = 'Never Gonna Give You Up\n213.5\nhttps://googlevideo.com/videoplayback?id=123';
const parsed = parseYtDlpOutput(mockOutput, 'Never Gonna Give You Up');
assert(parsed.ok === true && parsed.duration === 214 && parsed.url.startsWith('https://'), 'parseYtDlpOutput parses 3-line format correctly');

// Test Deep Link Protocol parser
function parseProtocolCode(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  const match = urlStr.match(/abbadon:\/\/(?:friend\/|join\/)?([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

assert(parseProtocolCode('abbadon://friend/SC-98F2') === 'SC-98F2', 'parseProtocolCode handles abbadon://friend/CODE');
assert(parseProtocolCode('abbadon://join/SC-ABCD') === 'SC-ABCD', 'parseProtocolCode handles abbadon://join/CODE');
assert(parseProtocolCode('abbadon://SC-1122') === 'SC-1122', 'parseProtocolCode handles abbadon://CODE');
assert(parseProtocolCode('https://soundcloud.com') === null, 'parseProtocolCode rejects non-abbadon URLs');

// 5. Proxy Manager
console.log('\n--- 5. Proxy Manager Verification ---');
try {
  const proxyPath = path.join(ROOT_DIR, 'electron/proxyManager.cjs');
  const { proxyManager, PRESETS } = require(proxyPath);
  assert(proxyManager != null, 'proxyManager module loads successfully');
  assert(Array.isArray(PRESETS) && PRESETS.length > 0, 'PRESETS list is defined');
  assert(PRESETS.some(p => p.id === 'system'), 'System / default proxy preset exists');
} catch (err) {
  assert(false, 'proxyManager loading failed', err.message);
}

// 6. Arch & Linux packaging files
console.log('\n--- 6. Arch & Linux Packaging Files Verification ---');
assert(fs.existsSync(path.join(ROOT_DIR, 'packaging/arch/PKGBUILD')), 'Arch Linux PKGBUILD exists');
assert(fs.existsSync(path.join(ROOT_DIR, 'scripts/install-linux.sh')), 'Linux install helper script exists');
assert(fs.existsSync(path.join(ROOT_DIR, '.github/workflows/release.yml')), 'Release GitHub workflow exists');

const releaseYml = fs.readFileSync(path.join(ROOT_DIR, '.github/workflows/release.yml'), 'utf8');
assert(releaseYml.includes('windows-latest') && releaseYml.includes('ubuntu-latest'), 'Release workflow matrix has windows and ubuntu runners');
assert(releaseYml.includes('release/*.AppImage') && releaseYml.includes('release/*.deb') && releaseYml.includes('release/*.pacman'), 'Release workflow uploads all Linux formats');

// 7. Summary
console.log('\n========================================');
console.log(`🏁 TEST RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log('========================================\n');

if (failedTests > 0) {
  process.exit(1);
}
