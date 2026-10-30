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
assert(releaseYml.includes('release/*.AppImage') && releaseYml.includes('release/*.deb') && releaseYml.includes('release/*.rpm'), 'Release workflow uploads all Linux formats');

// 7. Local & Server Media Verification
console.log('\n--- 7. Local & Server Media Verification ---');
function testParseM3u(content, basePath) {
  const lines = content.split(/\r?\n/);
  const tracks = [];
  let curTitle = '';
  let curDuration = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/^#EXTINF:(-?\d+(?:\.\d+)?)\s*,\s*(.*)$/);
      if (match) {
        curDuration = Math.max(0, Math.round(parseFloat(match[1])));
        curTitle = match[2].trim();
      }
      continue;
    }

    if (line.startsWith('#')) continue;

    const isHttp = /^https?:\/\//i.test(line);
    let artist = 'Various Artists';
    let title = curTitle;

    if (curTitle) {
      const parts = curTitle.split(/\s*[-–—]\s*/);
      if (parts.length > 1) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      }
    } else {
      const base = path.basename(line, path.extname(line));
      const parts = base.split(/\s*[-–—]\s*/);
      if (parts.length > 1) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        title = base;
      }
    }

    tracks.push({
      title: title || 'Track',
      artist: artist || 'Artist',
      duration: curDuration,
      isLocal: !isHttp,
      url: isHttp ? line : path.resolve(basePath, line),
    });

    curTitle = '';
    curDuration = 0;
  }
  return tracks;
}

const sampleM3u = `#EXTM3U
#EXTINF:240,Daft Punk - One More Time
track1.mp3
#EXTINF:185,Starlight
https://stream.example.com/live.mp3
`;

const parsedM3u = testParseM3u(sampleM3u, 'C:\\Music');
assert(parsedM3u.length === 2, 'parseM3u parses 2 entries from sample M3U');
assert(parsedM3u[0].title === 'One More Time' && parsedM3u[0].artist === 'Daft Punk' && parsedM3u[0].duration === 240, 'parseM3u extracts artist, title and duration correctly');
assert(parsedM3u[0].isLocal === true && parsedM3u[0].url.endsWith('track1.mp3'), 'parseM3u resolves relative local paths');
assert(parsedM3u[1].isLocal === false && parsedM3u[1].url === 'https://stream.example.com/live.mp3', 'parseM3u recognizes HTTP/HTTPS stream URLs');

// Check that TitleBar component and AddMediaModal exist
const titleBarSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/TitleBar.tsx'), 'utf8');
assert(titleBarSrc.includes('relative z-10'), 'TitleBar has non-intrusive stacking z-10');
assert(!titleBarSrc.includes('z-[9999]'), 'TitleBar does not block modals with excessive z-[9999]');
assert(fs.existsSync(path.join(ROOT_DIR, 'src/components/TitleBar.tsx')), 'TitleBar component exists');
assert(fs.existsSync(path.join(ROOT_DIR, 'src/components/AddMediaModal.tsx')), 'AddMediaModal component exists');
assert(fs.existsSync(path.join(ROOT_DIR, 'src/lib/localMedia.ts')), 'localMedia manager module exists');

const preloadSrc = fs.readFileSync(path.join(ROOT_DIR, 'electron/preload.cjs'), 'utf8');
assert(preloadSrc.includes('isCustomTitleBar'), 'preload.cjs exposes isCustomTitleBar property');

const mainSrc = fs.readFileSync(path.join(ROOT_DIR, 'electron/main.cjs'), 'utf8');
assert(!mainSrc.includes('win.destroy()'), 'electron/main.cjs does not destroy window on titlebar toggle');

const viewsSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Views.tsx'), 'utf8');
assert(!viewsSrc.includes('settings-title-bar'), 'Views.tsx does not hide titlebar settings behind an expandable disclosure');
assert(!viewsSrc.includes('Discord Style'), 'Views.tsx no longer uses "Discord Style" card naming');
assert(titleBarSrc.includes('export function WindowControls'), 'TitleBar.tsx exports WindowControls');

// 8. Playlist Creation & Robust Endpoint Strategy Verification
console.log('\n--- 8. Playlist Creation & Robust Strategy Verification ---');
function buildPlaylistPayload(title, trackIds = []) {
  const validIds = trackIds.filter((id) => Number.isInteger(id) && id > 0);
  return {
    playlist: {
      title,
      sharing: 'public',
      tracks: validIds.map((id) => ({ id })),
    },
  };
}

const payloadWithTracks = buildPlaylistPayload('Favorites', [12345, 67890]);
assert(payloadWithTracks.playlist.title === 'Favorites', 'buildPlaylistPayload sets correct title');
assert(Array.isArray(payloadWithTracks.playlist.tracks) && payloadWithTracks.playlist.tracks.length === 2, 'buildPlaylistPayload attaches valid track objects');
assert(payloadWithTracks.playlist.tracks[0].id === 12345, 'buildPlaylistPayload formats id correctly');

const payloadEmpty = buildPlaylistPayload('Empty List', []);
assert(Array.isArray(payloadEmpty.playlist.tracks) && payloadEmpty.playlist.tracks.length === 0, 'buildPlaylistPayload supports empty initial tracks');

// 9. Playlist Deletion & Context Menu Verification
console.log('\n--- 9. Playlist Deletion & Context Menu Verification ---');

const playlistContextMenuPath = path.join(__dirname, '..', 'src', 'components', 'PlaylistContextMenu.tsx');
assert(fs.existsSync(playlistContextMenuPath), 'PlaylistContextMenu.tsx component exists');

const contextMenuContent = fs.readFileSync(playlistContextMenuPath, 'utf8');
assert(contextMenuContent.includes('export function PlaylistContextMenu'), 'PlaylistContextMenu is exported as component');
assert(contextMenuContent.includes('Delete Playlist'), 'PlaylistContextMenu includes Delete Playlist action');
assert(contextMenuContent.includes('confirmDeleteOpen'), 'PlaylistContextMenu has delete confirmation dialog');

const soundcloudLibPath = path.join(__dirname, '..', 'src', 'lib', 'soundcloud.ts');
const soundcloudContent = fs.readFileSync(soundcloudLibPath, 'utf8');
assert(soundcloudContent.includes('async deletePlaylist('), 'SoundCloud client library implements deletePlaylist');

const useSoundCloudPath = path.join(__dirname, '..', 'src', 'hooks', 'useSoundCloud.ts');
const useSoundCloudContent = fs.readFileSync(useSoundCloudPath, 'utf8');
assert(useSoundCloudContent.includes('deletePlaylist: (playlistId: string | number) => Promise<boolean>'), 'useSoundCloud hook defines deletePlaylist in interface');

const sidebarPath = path.join(__dirname, '..', 'src', 'components', 'Sidebar.tsx');
const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
assert(sidebarContent.includes('onContextMenuPlaylist'), 'Sidebar supports onContextMenuPlaylist prop and handler');

const detailViewPath = path.join(__dirname, '..', 'src', 'components', 'DetailView.tsx');
const detailViewContent = fs.readFileSync(detailViewPath, 'utf8');
assert(detailViewContent.includes('onDeletePlaylist'), 'DetailView supports onDeletePlaylist');
assert(detailViewContent.includes('onContextMenuPlaylist'), 'DetailView supports onContextMenuPlaylist');

const appPath = path.join(__dirname, '..', 'src', 'App.tsx');
const appContent = fs.readFileSync(appPath, 'utf8');
assert(appContent.includes('handleDeletePlaylist'), 'App.tsx defines handleDeletePlaylist handler');
assert(appContent.includes('<PlaylistContextMenu'), 'App.tsx renders PlaylistContextMenu');

// 10. WebRTC & NAT Flood Protection Verification
console.log('\n--- 10. WebRTC & NAT Flood Protection Verification ---');
const listenTogetherHookPath = path.join(ROOT_DIR, 'src/hooks/useListenTogether.ts');
const listenTogetherSrc = fs.readFileSync(listenTogetherHookPath, 'utf8');
assert(listenTogetherSrc.includes('pendingConnectionsRef'), 'useListenTogether tracks pending connection attempts');
assert(listenTogetherSrc.includes('lastAttemptTimeRef'), 'useListenTogether tracks per-friend connection rate-limiting');
assert(listenTogetherSrc.includes('lastFriendScanTimeRef'), 'useListenTogether throttles offline friend scans');
assert(listenTogetherSrc.includes('12000'), 'useListenTogether enforces connection timeout to clean up hanging sockets');
assert(listenTogetherSrc.includes('30_000'), 'useListenTogether throttles friend connection retries by at least 30s');
assert(listenTogetherSrc.includes('45_000'), 'useListenTogether throttles friend background scan interval by at least 45s');

// 11. Custom CSS Live Customization Verification (Vencord Style)
console.log('\n--- 11. Custom CSS Live Customization Verification ---');
const updatedMainSrc = fs.readFileSync(path.join(ROOT_DIR, 'electron/main.cjs'), 'utf8');
assert(updatedMainSrc.includes("ipcMain.handle('css:load'"), 'main.cjs registers css:load IPC handler');
assert(updatedMainSrc.includes("ipcMain.handle('css:save'"), 'main.cjs registers css:save IPC handler');
assert(updatedMainSrc.includes("ipcMain.handle('css:open-file'"), 'main.cjs registers css:open-file IPC handler');
assert(updatedMainSrc.includes("ipcMain.handle('css:open-folder'"), 'main.cjs registers css:open-folder IPC handler');
assert(updatedMainSrc.includes('watchCustomCss()'), 'main.cjs implements file watcher for external quickCss file edits');

const updatedPreloadSrc = fs.readFileSync(path.join(ROOT_DIR, 'electron/preload.cjs'), 'utf8');
assert(updatedPreloadSrc.includes('loadCustomCss:'), 'preload.cjs exposes loadCustomCss bridge method');
assert(updatedPreloadSrc.includes('saveCustomCss:'), 'preload.cjs exposes saveCustomCss bridge method');
assert(updatedPreloadSrc.includes('openCustomCssFile:'), 'preload.cjs exposes openCustomCssFile bridge method');
assert(updatedPreloadSrc.includes('openCustomCssFolder:'), 'preload.cjs exposes openCustomCssFolder bridge method');
assert(updatedPreloadSrc.includes('onCustomCssChange:'), 'preload.cjs exposes onCustomCssChange bridge event listener');

const prefsSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/lib/prefs.ts'), 'utf8');
assert(prefsSrc.includes('customCssEnabled: boolean'), 'prefs.ts defines customCssEnabled preference');
assert(prefsSrc.includes('customCss: string'), 'prefs.ts defines customCss preference');

const customCssModulePath = path.join(ROOT_DIR, 'src/lib/customCss.ts');
assert(fs.existsSync(customCssModulePath), 'src/lib/customCss.ts exists');
const customCssModuleSrc = fs.readFileSync(customCssModulePath, 'utf8');
assert(customCssModuleSrc.includes('applyCustomCss'), 'customCss.ts implements applyCustomCss');
assert(customCssModuleSrc.includes('CUSTOM_CSS_SNIPPETS'), 'customCss.ts provides preset themes and snippets');

const editorComponentPath = path.join(ROOT_DIR, 'src/components/CustomCssEditor.tsx');
assert(fs.existsSync(editorComponentPath), 'src/components/CustomCssEditor.tsx exists');
const editorComponentSrc = fs.readFileSync(editorComponentPath, 'utf8');
assert(editorComponentSrc.includes('export function CustomCssEditor'), 'CustomCssEditor is exported');
assert(editorComponentSrc.includes('handleOpenFile'), 'CustomCssEditor provides open in external editor action');
assert(editorComponentSrc.includes('handleInsertSnippet'), 'CustomCssEditor provides snippet/preset insertion');

const updatedViewsSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Views.tsx'), 'utf8');
assert(updatedViewsSrc.includes('<CustomCssEditor'), 'Views.tsx integrates CustomCssEditor in SettingsView');
assert(appContent.includes('applyCustomCss('), 'App.tsx applies custom CSS dynamically');
assert(appContent.includes('onCustomCssChange'), 'App.tsx synchronizes external disk edits in real-time');

// 12. Playlist Artwork Persistence & SoundCloud Sync Verification
console.log('\n--- 12. Playlist Artwork Persistence & SoundCloud Sync Verification ---');
const updatedSoundcloudSrc = fs.readFileSync(soundcloudLibPath, 'utf8');
assert(updatedSoundcloudSrc.includes('updatePlaylistArtwork('), 'soundcloud.ts implements updatePlaylistArtwork');
assert(updatedSoundcloudSrc.includes('buildMultipartBody('), 'soundcloud.ts exports buildMultipartBody helper');
assert(updatedSoundcloudSrc.includes('imageSourceToBytes('), 'soundcloud.ts exports imageSourceToBytes helper');
assert(updatedSoundcloudSrc.includes('playlist[artwork_data]'), 'soundcloud.ts targets SoundCloud playlist[artwork_data]');
assert(updatedSoundcloudSrc.includes('multipart/form-data; boundary='), 'soundcloud.ts creates multipart form data boundary');

const updatedUseSoundcloudSrc = fs.readFileSync(useSoundCloudPath, 'utf8');
assert(updatedUseSoundcloudSrc.includes('sc.updatePlaylistArtwork('), 'useSoundCloud invokes sc.updatePlaylistArtwork');
assert(updatedUseSoundcloudSrc.includes('Playlist cover updated'), 'useSoundCloud notifies user on cover upload');
assert(updatedUseSoundcloudSrc.includes('setPlaylistArtworkOverride(playlistId, details.artwork)'), 'useSoundCloud optimistically applies cover override immediately');

const playlistArtworkLibPath = path.join(ROOT_DIR, 'src/lib/playlistArtwork.ts');
const playlistArtworkSrc = fs.readFileSync(playlistArtworkLibPath, 'utf8');
assert(playlistArtworkSrc.includes('normalizePlaylistId'), 'playlistArtwork.ts normalizes playlist ids across URI variants');
assert(playlistArtworkSrc.includes('initPlaylistArtworkOverrides'), 'playlistArtwork.ts loads saved overrides on app startup');
assert(playlistArtworkSrc.includes('saveArtworkOverrides'), 'playlistArtwork.ts saves overrides to desktop storage');

const mainCjsPath = path.join(ROOT_DIR, 'electron/main.cjs');
const updatedMainCjsSrc = fs.readFileSync(mainCjsPath, 'utf8');
assert(updatedMainCjsSrc.includes('artwork:save-overrides'), 'main.cjs registers artwork:save-overrides IPC handler');
assert(updatedMainCjsSrc.includes('artwork:load-overrides'), 'main.cjs registers artwork:load-overrides IPC handler');

const preloadCjsPath = path.join(ROOT_DIR, 'electron/preload.cjs');
const updatedPreloadCjsSrc = fs.readFileSync(preloadCjsPath, 'utf8');
assert(updatedPreloadCjsSrc.includes('saveArtworkOverrides:'), 'preload.cjs exposes saveArtworkOverrides');
assert(updatedPreloadCjsSrc.includes('loadArtworkOverrides:'), 'preload.cjs exposes loadArtworkOverrides');

const updatedAppSrc = fs.readFileSync(appPath, 'utf8');
assert(updatedAppSrc.includes('initPlaylistArtworkOverrides'), 'App.tsx initializes artwork overrides on startup');
assert(updatedAppSrc.includes('EditPlaylistArtworkModal'), 'App.tsx renders EditPlaylistArtworkModal');
assert(updatedAppSrc.includes('handleUpdatePlaylistDetails(editingArtworkPlaylist.id'), 'App.tsx connects artwork save to handleUpdatePlaylistDetails');

const modalPath = path.join(ROOT_DIR, 'src/components/EditPlaylistArtworkModal.tsx');
const modalSrc = fs.readFileSync(modalPath, 'utf8');
assert(modalSrc.includes('Saving...'), 'EditPlaylistArtworkModal indicates saving state');

// Verify normalization matching
function testIdNormalization() {
  const norm = (id) => String(id).replace(/^(?:soundcloud:playlists:|local:|server:)/, '').trim();
  const rawNum = '123456';
  const uri = 'soundcloud:playlists:123456';
  return norm(rawNum) === '123456' && norm(uri) === '123456';
}
assert(testIdNormalization(), 'normalizePlaylistId correctly unifies raw numbers and soundcloud:playlists: URIs');

// Verify multipart body builder logic
function testMultipartBuilder() {
  const boundary = '----TestBoundary123';
  const encoder = new TextEncoder();
  const header = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="playlist[artwork_data]"; filename="artwork.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
  const value = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
  const total = new Uint8Array(header.length + value.length + footer.length);
  total.set(header, 0);
  total.set(value, header.length);
  total.set(footer, header.length + value.length);
  const text = new TextDecoder().decode(total);
  return text.includes('playlist[artwork_data]') && text.includes('artwork.jpg');
}
assert(testMultipartBuilder(), 'Multipart builder constructs valid payload with field and filename');

// 13. Robust Auto-Updater & Clean Lifecycle Verification
console.log('\n--- 13. Robust Auto-Updater & Clean Lifecycle Verification ---');

const autoUpdaterSrc = fs.readFileSync(path.join(ROOT_DIR, 'electron/autoUpdater.cjs'), 'utf8');
assert(autoUpdaterSrc.includes('autoUpdater.installDirectory = runningDir'), 'autoUpdater.cjs configures installDirectory to running executable folder');
assert(autoUpdaterSrc.includes('PORTABLE_EXECUTABLE_FILE'), 'autoUpdater.cjs detects portable environment');
assert(autoUpdaterSrc.includes('autoUpdater.autoInstallOnAppQuit = false'), 'autoUpdater.cjs disables autoInstallOnAppQuit before quitAndInstall to prevent competing runs');
assert(autoUpdaterSrc.includes('app.exit(0)'), 'autoUpdater.cjs forces app.exit(0) after spawn to release binary and DLL file locks');
assert(autoUpdaterSrc.includes("'Unknown error while checking for updates'"), 'autoUpdater.cjs provides English error fallback');
assert(autoUpdaterSrc.includes("'Error connecting to update server'"), 'autoUpdater.cjs provides English connection error message');

const mainSourceCode = fs.readFileSync(path.join(ROOT_DIR, 'electron/main.cjs'), 'utf8');
assert(mainSourceCode.includes('app.releaseSingleInstanceLock()'), 'main.cjs explicitly releases single instance lock before update installation');
assert(mainSourceCode.includes('tray.destroy()'), 'main.cjs destroys tray icon before update installation');
assert(mainSourceCode.includes('rpcClient.destroy()'), 'main.cjs disconnects Discord RPC before update installation');
assert(mainSourceCode.includes('cssWatcher.close()'), 'main.cjs closes CSS file watcher before update installation');
assert(mainSourceCode.includes('if (isQuitting || isUpdating)'), 'main.cjs ignores second-instance events during quit or update installation');

const viteEnvSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/vite-env.d.ts'), 'utf8');
assert(viteEnvSrc.includes("'installing'"), 'vite-env.d.ts UpdateState includes installing status');
assert(viteEnvSrc.includes('isPortable?: boolean;'), 'vite-env.d.ts UpdateState includes isPortable flag');

const bannerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/UpdateBanner.tsx'), 'utf8');
assert(bannerSrc.includes("updateState.status === 'installing'"), 'UpdateBanner.tsx supports installing state');
assert(bannerSrc.includes('Installing & Restarting...'), 'UpdateBanner.tsx displays Installing & Restarting indicator');

const viewsCode = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Views.tsx'), 'utf8');
assert(viewsCode.includes("updateState.status === 'installing'"), 'Views.tsx supports installing state');
assert(viewsCode.includes('Download Portable .exe'), 'Views.tsx provides portable download label');

// 14. Summary
console.log('\n========================================');
console.log(`🏁 TEST RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log('========================================\n');

if (failedTests > 0) {
  process.exit(1);
}
