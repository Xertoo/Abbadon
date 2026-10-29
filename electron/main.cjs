const {
  app,
  BrowserWindow,
  shell,
  nativeTheme,
  globalShortcut,
  ipcMain,
  session,
  Menu,
  Tray,
  Notification,
  net,
  dialog,
  protocol,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const NodeID3 = require('node-id3');
const { proxyManager, PRESETS } = require('./proxyManager.cjs');
const { initAutoUpdater } = require('./autoUpdater.cjs');

// Register privileged schemes for local audio streaming (must run before app ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-audio',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

// Silence internal Chromium/WebRTC stderr spam (e.g. STUN binding timeouts on inactive interfaces)
app.commandLine.appendSwitch('log-level', '3');

// Hardware and GPU rendering optimizations
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

/* ------------------------------------------------------------------ *
 * Widevine (best effort)
 *
 * Full Spotify Premium playback runs through the Web Playback SDK, which
 * decrypts its AAC streams with Widevine (EME). Stock Electron ships no CDM,
 * so this only wires one up when it actually exists - either next to the app
 * or pointed at by WIDEVINE_CDM_PATH. On a castlabs/electron-releases build the
 * switches are already baked in, so these become harmless no-ops.
 * ------------------------------------------------------------------ */
(function initWidevine() {
  try {
    const candidates = [];
    if (process.env.WIDEVINE_CDM_PATH) candidates.push(process.env.WIDEVINE_CDM_PATH);
    const cdmFile =
      process.platform === 'win32'
        ? 'widevinecdm.dll'
        : process.platform === 'darwin'
        ? 'libwidevinecdm.dylib'
        : 'libwidevinecdm.so';

    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'widevine', cdmFile));
      candidates.push(path.join(process.resourcesPath, cdmFile));
    }
    if (process.platform === 'linux') {
      candidates.push(
        '/opt/google/chrome/WidevineCdm/_platform_specific/linux_x64/libwidevinecdm.so',
        '/usr/lib/chromium/WidevineCdm/_platform_specific/linux_x64/libwidevinecdm.so',
        '/usr/lib/chromium-browser/WidevineCdm/_platform_specific/linux_x64/libwidevinecdm.so'
      );
    }
    const cdm = candidates.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    if (cdm) {
      app.commandLine.appendSwitch('widevine-cdm-path', cdm);
      if (process.env.WIDEVINE_CDM_VERSION) {
        app.commandLine.appendSwitch('widevine-cdm-version', process.env.WIDEVINE_CDM_VERSION);
      }
    }
  } catch {
    /* best effort only */
  }
})();

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isDev = !app.isPackaged;
const isLocalBuild = /[\\/]win-unpacked[\\/]/.test(process.execPath);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let win = null;
let authWin = null;
let tray = null;
let trayWin = null;
let updateTrayFn = null;
let isQuitting = false;
let rpcClient = null;
let rpcConnected = false;
let lastNotifiedTrackId = null;
let lastPlaybackState = {
  track: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  friendCode: null,
  shareDiscordFriendCode: false,
  showDiscordButtons: true,
  volume: 1,
};

/**
 * Main-process request with no CORS enforcement and real cookie support.
 *
 * `session.fetch` runs Chromium's fetch, so a `credentials: 'include'` call
 * against a response whose Access-Control-Allow-Origin is `*` (or that has no
 * header at all) dies with net::ERR_FAILED before the server's status code is
 * ever seen. `net.request` bypasses CORS entirely, so the OAuth token and the
 * datadome/session cookies from the login partition are what decide the reply -
 * not the CORS headers some CDN happened to send.
 */
function netRequestJson(url, { partition = 'persist:soundcloud', headers = {} } = {}) {
  return new Promise((resolve) => {
    let req;
    try {
      req = net.request({
        url,
        session: session.fromPartition(partition),
        useSessionCookies: true,
      });
    } catch (err) {
      resolve({ ok: false, status: 0, json: null, text: '', error: err instanceof Error ? err.message : 'network error' });
      return;
    }
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, text });
      });
    });
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, json: null, text: '', error: err instanceof Error ? err.message : 'network error' });
    });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    req.end();
  });
}

/**
 * No application menu, ever.
 *
 * `autoHideMenuBar` alone only hides the bar until Alt is pressed, which popped
 * the File/Edit/View/Window strip over the app on every stray keypress. Clearing
 * the application menu removes the accelerator entirely: on Windows this is the
 * documented way to get a frameless-feeling window with no hidden menu, and
 * `removeMenu()` covers builds where the global menu is what binds the key.
 *
 * Done before any window exists, because the menu is installed app-wide.
 */
Menu.setApplicationMenu(null);

function killMenu(target) {
  if (!target || target.isDestroyed()) return;
  try {
    if (typeof target.removeMenu === 'function') target.removeMenu();
    target.setMenu(null);
    target.setMenuBarVisibility(false);
  } catch {
    /* window already tearing down */
  }
}

function getCustomTitleBarPref() {
  const file = path.join(app.getPath('userData'), 'settings.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.customTitleBar === 'boolean') {
      return parsed.customTitleBar;
    }
  } catch {}
  return true;
}

/** @returns {BrowserWindow} */
function createWindow() {
  const useCustomTitleBar = getCustomTitleBarPref();
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    title: 'Abbadon',
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [useCustomTitleBar ? '--custom-titlebar' : '--no-custom-titlebar'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      // EME/DRM (Widevine) is refused unless plugins are enabled. Spotify's Web
      // Playback SDK needs it for full-length decryption; without a CDM the
      // switch is inert and playback simply falls back to the SDK's own error.
      plugins: true,
    },
  });

  win.on('maximize', () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized-change', true);
  });
  win.on('unmaximize', () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized-change', false);
  });

  win.setMenu(null);
  killMenu(win);
  // Belt and braces: even if something reattaches a menu later, Alt stays inert.
  win.on('page-title-updated', () => killMenu(win));

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev && DEV_URL && url.startsWith(DEV_URL);
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (isDev && DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') {
      win.webContents.send('nav-command', 'back');
    } else if (cmd === 'browser-forward') {
      win.webContents.send('nav-command', 'forward');
    }
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

/* ------------------------------------------------------------------ *
 * Network bridge
 *
 * The renderer runs from file://, so any fetch to soundcloud.com or
 * api-v2.soundcloud.com is blocked by CORS. All requests are relayed
 * here instead, using the default session so login cookies are attached
 * automatically.
 * ------------------------------------------------------------------ */

function isAllowedHost(hostname) {
  const h = hostname.toLowerCase();
  return (
    h === 'soundcloud.com' ||
    h.endsWith('.soundcloud.com') ||
    h === 'sndcdn.com' ||
    h.endsWith('.sndcdn.com') ||
    h === 'soundcloud.cf' ||
    h.endsWith('.soundcloud.cf') ||
    h === 'spotify.com' ||
    h.endsWith('.spotify.com') ||
    h === 'spotify.link' ||
    h.endsWith('.spotify.link') ||
    h === 'scdn.co' ||
    h.endsWith('.scdn.co')
  );
}

async function copyCookiesBetweenSessions(fromSession, toSession) {
  try {
    const cookies = await fromSession.cookies.get({});
    for (const c of cookies) {
      try {
        const domain = (c.domain || '').replace(/^\./, '');
        if (!domain) continue;
        const protocol = c.secure ? 'https' : 'http';
        await toSession.cookies.set({
          url: `${protocol}://${domain}${c.path || '/'}`,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate,
          sameSite: c.sameSite,
        });
      } catch {
        /* skip individual failed cookies */
      }
    }
  } catch (err) {
    console.warn('[cookies] copy failed:', err.message);
  }
}

async function syncAllAuthCookies() {
  const loginSess = session.fromPartition('persist:soundcloud');
  await copyCookiesBetweenSessions(loginSess, session.defaultSession);
}

async function syncDefaultCookiesToPartition() {
  const loginSess = session.fromPartition('persist:soundcloud');
  await copyCookiesBetweenSessions(session.defaultSession, loginSess);
}

let dataDomeRefreshing = null;
async function refreshDataDomeSession() {
  if (dataDomeRefreshing) return dataDomeRefreshing;
  dataDomeRefreshing = (async () => {
    let probeWin = null;
    try {
      console.log('[datadome] refreshing DataDome challenge session in background...');
      probeWin = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          partition: 'persist:soundcloud',
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      killMenu(probeWin);
      await probeWin.loadURL('https://soundcloud.com/discover');
      // Give Chromium 3.5 seconds to run DataDome JavaScript challenge and receive validated cookies
      await new Promise((r) => setTimeout(r, 3500));
      await syncAllAuthCookies();
      console.log('[datadome] DataDome session successfully refreshed & synced');
    } catch (e) {
      console.warn('[datadome] refresh error:', e.message);
    } finally {
      if (probeWin && !probeWin.isDestroyed()) {
        try {
          probeWin.destroy();
        } catch {
          /* ignore */
        }
      }
      dataDomeRefreshing = null;
    }
  })();
  return dataDomeRefreshing;
}

ipcMain.handle('sc:fetch', async (_e, { url, method = 'GET', headers = {}, body = null }) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 0, text: '', error: 'invalid url' };
  }

  const isCdn = parsed.hostname.endsWith('sndcdn.com');
  const isSpotify =
    parsed.hostname === 'spotify.com' ||
    parsed.hostname.endsWith('.spotify.com') ||
    parsed.hostname === 'spotify.link' ||
    parsed.hostname.endsWith('.spotify.link') ||
    parsed.hostname === 'scdn.co' ||
    parsed.hostname.endsWith('.scdn.co');

  if (!isAllowedHost(parsed.hostname)) {
    return { ok: false, status: 0, text: '', error: `host not allowed: ${parsed.hostname}` };
  }

  // Ensure cookies are synced before any mutation or API call to api-v2
  if (method !== 'GET' || parsed.hostname === 'api-v2.soundcloud.com') {
    await syncAllAuthCookies();
  }

  const chromeVer = (process.versions.chrome || '124').split('.')[0];
  const requestHeaders = isSpotify
    ? {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      }
    : {
        'User-Agent': UA,
        Accept: isCdn ? '*/*' : 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(isCdn
          ? {}
          : {
              Origin: 'https://soundcloud.com',
              'Sec-Ch-Ua': `"Chromium";v="${chromeVer}", "Not-A.Brand";v="99"`,
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"Windows"',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-site',
            }),
        Referer: 'https://soundcloud.com/',
        ...headers,
      };

  const doFetch = async () => {
    const res = await session.defaultSession.fetch(url, {
      method,
      headers: requestHeaders,
      body: body ?? undefined,
      redirect: 'follow',
      credentials: isCdn || isSpotify ? 'omit' : 'include',
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text,
    };
  };

  try {
    let result = await doFetch();

    // If 403 Forbidden with DataDome challenge response, automatically refresh DataDome session and retry once
    if (
      result.status === 403 &&
      (result.text.includes('captcha-delivery.com') ||
        result.text.includes('initialCid') ||
        result.text.includes('datadome'))
    ) {
      console.log('[sc:fetch] DataDome challenge detected, solving in background...');
      await refreshDataDomeSession();
      result = await doFetch();
    }

    return result;
  } catch (err) {
    return { ok: false, status: 0, text: '', error: err instanceof Error ? err.message : 'network error' };
  }
});


/* ------------------------------------------------------------------ *
 * Spotify OAuth (PKCE)
 *
 * Public-client PKCE: no client secret is involved, so the user only pastes
 * their own app's Client ID. The loopback redirect is intercepted before the
 * window ever navigates to it (no local server is started), and the code is
 * exchanged here so the refresh token never passes through a web page.
 * ------------------------------------------------------------------ */

const SPOTIFY_REDIRECT = 'http://127.0.0.1:8888/callback';
const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function spotifyTokenRequest(params) {
  const body = new URLSearchParams(params).toString();
  const res = await session.defaultSession.fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { ok: res.ok, status: res.status, json, text };
}

ipcMain.handle('spotify:config', () => ({ redirectUri: SPOTIFY_REDIRECT, scopes: SPOTIFY_SCOPES }));

ipcMain.handle('spotify:login', async (_e, { clientId } = {}) => {
  if (!clientId || typeof clientId !== 'string') return { ok: false, error: 'Missing Client ID' };
  if (authWin && !authWin.isDestroyed()) {
    authWin.focus();
    return { ok: false, error: 'A sign-in window is already open' };
  }

  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const authUrl =
    'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      client_id: clientId.trim(),
      response_type: 'code',
      redirect_uri: SPOTIFY_REDIRECT,
      scope: SPOTIFY_SCOPES,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    }).toString();

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        if (authWin && !authWin.isDestroyed()) authWin.close();
      } catch {
        /* already gone */
      }
      authWin = null;
      resolve(result);
    };

    authWin = new BrowserWindow({
      width: 480,
      height: 720,
      title: 'Sign in to Spotify',
      autoHideMenuBar: true,
      parent: win ?? undefined,
      webPreferences: {
        partition: 'persist:spotify',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    killMenu(authWin);
    authWin.on('page-title-updated', () => killMenu(authWin));

    const handleUrl = async (rawUrl) => {
      if (!rawUrl.startsWith(SPOTIFY_REDIRECT)) return false;
      let code = null;
      let err = null;
      let returnedState = null;
      try {
        const u = new URL(rawUrl);
        code = u.searchParams.get('code');
        err = u.searchParams.get('error');
        returnedState = u.searchParams.get('state');
      } catch {
        /* unparseable */
      }
      if (err) {
        finish({ ok: false, error: `Spotify declined: ${err}` });
        return true;
      }
      if (!code) return false;
      if (returnedState !== state) {
        finish({ ok: false, error: 'State mismatch - sign-in was tampered with' });
        return true;
      }
      const tok = await spotifyTokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT,
        client_id: clientId.trim(),
        code_verifier: verifier,
      });
      if (!tok.ok || !tok.json) {
        finish({
          ok: false,
          error: tok.json?.error_description || tok.json?.error || `Token exchange failed (${tok.status})`,
        });
        return true;
      }
      finish({
        ok: true,
        accessToken: tok.json.access_token,
        refreshToken: tok.json.refresh_token,
        expiresIn: tok.json.expires_in,
      });
      return true;
    };

    authWin.webContents.on('will-redirect', (event, url) => {
      if (url.startsWith(SPOTIFY_REDIRECT)) {
        event.preventDefault();
        void handleUrl(url);
      }
    });
    authWin.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith(SPOTIFY_REDIRECT)) {
        event.preventDefault();
        void handleUrl(url);
      }
    });

    authWin.on('closed', () => {
      authWin = null;
      finish({ ok: false, error: 'Sign-in window closed' });
    });

    authWin.loadURL(authUrl);
  });
});

ipcMain.handle('spotify:refresh', async (_e, { clientId, refreshToken } = {}) => {
  if (!clientId || !refreshToken) return { ok: false, error: 'Missing refresh token' };
  const tok = await spotifyTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId.trim(),
  });
  if (!tok.ok || !tok.json) {
    return {
      ok: false,
      error: tok.json?.error_description || tok.json?.error || `Refresh failed (${tok.status})`,
    };
  }
  return {
    ok: true,
    accessToken: tok.json.access_token,
    refreshToken: tok.json.refresh_token || refreshToken,
    expiresIn: tok.json.expires_in,
  };
});


/* ------------------------------------------------------------------ *
 * Login flow
 *
 * Opens the real SoundCloud sign-in page in a child window that shares
 * the default session, polls for the access_token that SoundCloud writes
 * to web storage once authenticated, then closes itself.
 * ------------------------------------------------------------------ */

/**
 * Runs inside the sign-in window and reports whichever session token it can
 * find. SoundCloud has shipped the token under several names and has also moved
 * it into `sessionStorage` and a JSON blob, so all of them are read. A 401 from
 * every authenticated endpoint is what a half-read token produces, which is why
 * the probe looks here rather than only at `access_token`.
 */
const TOKEN_PROBE = `(() => {
  try {
    const read = (store) => {
      const out = {};
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        out[k] = store.getItem(k);
      }
      return out;
    };
    const local = read(localStorage);
    const session = read(sessionStorage);
    
    const cookies = document.cookie.split('; ').reduce((acc, curr) => {
      const [k, v] = curr.split('=');
      if (k) acc[k] = decodeURIComponent(v || '');
      return acc;
    }, {});

    const all = { ...local, ...session, ...cookies };

    // Long enough to be a real OAuth token. Anything shorter is a placeholder or
    // a stale placeholder value that would only produce a 401 later.
    const long = (v) => (typeof v === 'string' && v.length > 20 ? v : null);

    // A direct hit on any of the known key names wins.
    const direct =
      long(all.access_token) ||
      long(all.oauth_token) ||
      long(all.accessToken) ||
      long(all.token) ||
      null;

    // Otherwise dig through the JSON blobs, which is where the current web
    // player keeps it.
    let nested = null;
    for (const key of Object.keys(all)) {
      const raw = all[key];
      if (typeof raw !== 'string' || raw.length > 20000) continue;
      if (!raw.includes('token') && !raw.includes('Token')) continue;
      try {
        const parsed = JSON.parse(raw);
        const stack = [parsed];
        while (stack.length) {
          const node = stack.pop();
          if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) {
              if (/^(access_?token|oauth_?token)$/i.test(k) && typeof v === 'string' && v.length > 20) {
                nested = v;
                stack.length = 0;
                break;
              }
              if (v && typeof v === 'object') stack.push(v);
            }
          }
        }
      } catch { /* not json */ }
      if (nested) break;
    }

    return JSON.stringify({
      token: direct || nested,
      user: local.scUser || session.scUser || null,
    });
  } catch { return null; }
})()`;

ipcMain.handle('sc:login', async () => {
  if (authWin && !authWin.isDestroyed()) {
    authWin.focus();
    return { ok: false, reason: 'already-open' };
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = async (payload) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);

      // Stop watching requests now that the outcome is decided.
      try {
        session.fromPartition('persist:soundcloud').webRequest.onBeforeSendHeaders(null);
      } catch {
        /* listener already gone */
      }

      // On a successful login, copy ALL cookies from the login session
      // partition into the default session so that sc:fetch (which uses
      // defaultSession) automatically sends them with every API call.
      if (payload.ok) {
        await syncAllAuthCookies();
      }

      if (authWin && !authWin.isDestroyed()) authWin.destroy();
      authWin = null;
      resolve(payload);
    };

    authWin = new BrowserWindow({
      width: 520,
      height: 760,
      parent: win ?? undefined,
      modal: !!win,
      show: true,
      title: 'Sign in to SoundCloud',
      backgroundColor: '#121212',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:soundcloud',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    killMenu(authWin);

    authWin.webContents.setWindowOpenHandler(({ url }) => {
      if (/soundcloud\.com/.test(url)) authWin.loadURL(url);
      else void shell.openExternal(url);
      return { action: 'deny' };
    });

    authWin.on('closed', () => {
      authWin = null;
      finish({ ok: false, reason: 'closed' });
    });

    authWin.webContents.on('did-finish-load', () => {
      void authWin.webContents.executeJavaScript(TOKEN_PROBE).catch(() => null);
    });

    /**
     * Copy all soundcloud.com cookies from the login session to the default
     * session so sc:fetch can use them for authenticated API calls.
     */
    const syncCookiesToDefault = async () => {
      await syncAllAuthCookies();
    };

    const KNOWN_CLIENT_ID = 'dkevB9EsY4jIoSm8RfddPNUKyn6hurXF';

    /**
     * The OAuth token the signed-in web app uses for its own API calls.
     *
     * This is the reliable source. SoundCloud may keep the token in an httpOnly
     * cookie, in a storage key whose name changes, or only in memory - all of
     * which defeat storage scraping and left the app on a cookie-only session
     * that SoundCloud answers with 403 on every write (like, playlist edit).
     * Intercepting the requests the page makes captures it regardless.
     */
    let capturedToken = null;
    let capturedVerifying = false;
    let navigatedAwayAt = 0;


    /**
     * Verify a token by calling /me with it. Copies cookies first so the
     * defaultSession request includes session cookies from the login window.
     */
    const verifyToken = async (token) => {
      await syncCookiesToDefault();
      // net.request on purpose: see netRequestJson. A credentialed session.fetch
      // fails with ERR_FAILED when the /me response does not carry a matching
      // Access-Control-Allow-Origin, which is exactly the response SoundCloud
      // sends to a non-browser origin.
      const res = await netRequestJson(
        `https://api-v2.soundcloud.com/me?client_id=${KNOWN_CLIENT_ID}`,
        {
          headers: {
            'User-Agent': UA,
            Authorization: `OAuth ${token}`,
            Accept: 'application/json',
            Origin: 'https://soundcloud.com',
            Referer: 'https://soundcloud.com/',
          },
        }
      );
      console.log('[login] verify /me status:', res.status, res.error ? `(${res.error})` : '');
      return res.ok;
    };

    /**
     * Check if user is logged in by detecting navigation away from /signin
     * and looking for a token in cookies or localStorage.
     */
    const poll = setInterval(async () => {
      if (!authWin || authWin.isDestroyed() || settled) return;

      const currentUrl = authWin.webContents.getURL();
      
      // LOGGING: Track current URL to debug navigation
      console.log('[login] polling, currentUrl:', currentUrl);

      // Still on login/auth pages - wait
      if (currentUrl.includes('/signin') || currentUrl.includes('/login') || 
          currentUrl.includes('/auth') || currentUrl.includes('google.com') ||
          currentUrl.includes('facebook.com') || currentUrl.includes('apple.com')) {
        return;
      }
      
      console.log('[login] navigated to:', currentUrl, '- checking for token');
      if (!navigatedAwayAt) navigatedAwayAt = Date.now();

      // Get all cookies for diagnostics
      const allCookies = await session.fromPartition('persist:soundcloud').cookies.get({}).catch(() => []);
      console.log('[login] cookies:', allCookies.map(c => `${c.name}(${c.value?.length ?? 0})`).join(', '));

      // Check cookies for an OAuth token. The cookie has been named
      // `oauth_token` for years, but SoundCloud renames things from time to
      // time, so any token-shaped cookie is tried and verified against /me.
      // A missing token is what drops the app into cookie-only auth, and that
      // session can read but is refused (403) on every write.
      const tokenCookies = allCookies.filter(
        (c) => c.value && c.value.length > 20 && /token/i.test(c.name)
      );
      for (const c of tokenCookies) {
        console.log('[login] trying token cookie', c.name);
        const ok = await verifyToken(c.value);
        if (ok && !settled) { finish({ ok: true, token: c.value, user: null }); return; }
      }

      // Check localStorage/sessionStorage
      const raw = await authWin.webContents.executeJavaScript(TOKEN_PROBE).catch(() => null);
      if (raw) {
        const data = JSON.parse(raw);
        console.log('[login] localStorage token length:', data.token?.length ?? 0);
        if (data.token) {
          const ok = await verifyToken(data.token);
          if (ok && !settled) { finish({ ok: true, token: data.token, user: data.user }); return; }
        }
      }

      // If we've navigated away from signin and there's no token yet,
      // try syncing cookies and checking /me directly (session-cookie-based auth)
      await syncCookiesToDefault();
      const meRes = await netRequestJson(`https://api-v2.soundcloud.com/me?client_id=${KNOWN_CLIENT_ID}`, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          Origin: 'https://soundcloud.com',
          Referer: 'https://soundcloud.com/',
        },
      });
      console.log('[login] cookie-only /me status:', meRes.status, meRes.error ? `(${meRes.error})` : '');
      // Only fall back to a token-less (cookie-only) session once the page has
      // had a fair chance to make an authenticated request we can read the token
      // from. That session can read but is refused on every write, so it is a
      // last resort, not the first answer.
      if (meRes.ok && !settled && capturedToken === null && Date.now() - navigatedAwayAt > 7000) {
        // No explicit token - empty string signals cookie-based auth.
        finish({ ok: true, token: '', user: meRes.json });
      }
    }, 1500);

    const deadline = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 5 * 60 * 1000);

    /**
     * Watch the login window's own API traffic for the OAuth token.
     *
     * The web app attaches it either as `Authorization: OAuth <token>` or as an
     * `oauth_token` query parameter on its api-v2 calls. Reading it off a real
     * request is what makes the captured session write-capable, unlike scraping
     * storage that may not hold it at all.
     */
    const loginSession = session.fromPartition('persist:soundcloud');
    loginSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://api-v2.soundcloud.com/*'] },
      (details, callback) => {
        try {
          if (!capturedToken) {
            for (const [k, v] of Object.entries(details.requestHeaders || {})) {
              if (k.toLowerCase() === 'authorization' && /^oauth\s+/i.test(String(v))) {
                const t = String(v).replace(/^oauth\s+/i, '').trim();
                if (t.length > 20) capturedToken = t;
                break;
              }
            }
          }
          if (!capturedToken) {
            const m = /[?&]oauth_token=([^&]+)/.exec(details.url || '');
            if (m) {
              const t = decodeURIComponent(m[1]);
              if (t.length > 20) capturedToken = t;
            }
          }
          if (capturedToken && !settled && !capturedVerifying) {
            capturedVerifying = true;
            console.log('[login] captured OAuth token from page request');
            void verifyToken(capturedToken).then((ok) => {
              if (ok && !settled) finish({ ok: true, token: capturedToken, user: null });
              else capturedVerifying = false;
            });
          }
        } catch {
          /* never block the request over capture */
        }
        callback({ requestHeaders: details.requestHeaders });
      }
    );

    void authWin.loadURL('https://soundcloud.com/signin');
  });
});

/**
 * Signs the account out.
 *
 * Only cookies are cleared from the default session. Asking it to drop
 * `localstorage` as well wiped the renderer's own storage - every preference,
 * the equalizer curve and the saved token with it - so "Disconnect" used to
 * reset the whole app instead of just the account.
 */
ipcMain.handle('sc:logout', async () => {
  try {
    await session.defaultSession.clearStorageData({ storages: ['cookies'] });
    await session.fromPartition('persist:soundcloud').clearStorageData({
      storages: ['cookies', 'localstorage'],
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('app-info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dev: isDev,
}));

/* ------------------------------------------------------------------ *
 * Downloads & yt-dlp backend
 * ------------------------------------------------------------------ */

const getYtDlpPath = () => {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';

  const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : __dirname;
  const asarUnpackedDir = __dirname.replace(/app\.asar$/, 'app.asar.unpacked');
  const appUnpackedDir = appPath.replace(/app\.asar$/, 'app.asar.unpacked');
  const resourcesPath = process.resourcesPath || '';
  const resourcesUnpackedDir = path.join(resourcesPath, 'app.asar.unpacked');

  const candidates = [
    path.join(asarUnpackedDir, 'bin', binaryName),
    path.join(asarUnpackedDir, '..', 'bin', binaryName),
    path.join(appUnpackedDir, 'electron', 'bin', binaryName),
    path.join(appUnpackedDir, 'bin', binaryName),
    path.join(resourcesUnpackedDir, 'electron', 'bin', binaryName),
    path.join(resourcesUnpackedDir, 'bin', binaryName),
    path.join(__dirname, 'bin', binaryName),
    path.join(__dirname, '..', 'bin', binaryName),
    path.join(resourcesPath, 'electron', 'bin', binaryName),
    path.join(resourcesPath, 'bin', binaryName),
    path.join(appPath, 'electron', 'bin', binaryName),
    path.join(appPath, 'bin', binaryName),
  ];

  try {
    const userDataBin = path.join(app.getPath('userData'), 'bin', binaryName);
    candidates.push(userDataBin);
  } catch {}

  if (!isWin) {
    try {
      const home = app.getPath('home');
      candidates.push(
        path.join(home, '.local', 'bin', 'yt-dlp'),
        path.join(home, 'bin', 'yt-dlp'),
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        '/bin/yt-dlp'
      );
    } catch {}
  }

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        if (!isWin) {
          try {
            fs.chmodSync(p, 0o755);
          } catch {}
        }
        return p;
      }
    } catch {}
  }

  // System PATH lookup via which/where
  try {
    const cmd = isWin ? 'where.exe yt-dlp' : 'which yt-dlp';
    const found = require('node:child_process')
      .execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) {
      if (!isWin) {
        try { fs.chmodSync(found, 0o755); } catch {}
      }
      return found;
    }
  } catch {}

  return null;
};

function downloadBinaryFile(url, dest) {
  const https = require('node:https');
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBinaryFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download binary: HTTP ${res.statusCode}`));
      }
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${dest}.download`;
      const fileStream = fs.createWriteStream(tmp);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => {
          try {
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            fs.renameSync(tmp, dest);
            resolve(dest);
          } catch (e) {
            reject(e);
          }
        });
      });
      fileStream.on('error', (err) => {
        try { fs.unlinkSync(tmp); } catch {}
        reject(err);
      });
    }).on('error', reject);
  });
}

let ytDlpDownloadingPromise = null;
async function ensureYtDlp() {
  const existing = getYtDlpPath();
  if (existing) return existing;

  if (ytDlpDownloadingPromise) return ytDlpDownloadingPromise;

  ytDlpDownloadingPromise = (async () => {
    try {
      const isWin = process.platform === 'win32';
      const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
      const targetDir = path.join(app.getPath('userData'), 'bin');
      const targetPath = path.join(targetDir, binaryName);

      const downloadUrl = isWin
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

      console.log(`[yt-dlp] Downloading standalone binary for ${process.platform}...`);
      await downloadBinaryFile(downloadUrl, targetPath);
      if (!isWin) {
        try { fs.chmodSync(targetPath, 0o755); } catch {}
      }
      console.log(`[yt-dlp] Ready at ${targetPath}`);
      return targetPath;
    } catch (err) {
      console.warn('[yt-dlp] Automatic download failed:', err.message);
      return null;
    } finally {
      ytDlpDownloadingPromise = null;
    }
  })();

  return ytDlpDownloadingPromise;
}

const ILLEGAL_FILENAME = /[\\/:*?"<>|]/g;

function getDefaultDownloadDir() {
  try {
    const musicDir = app.getPath('music');
    if (musicDir && fs.existsSync(musicDir)) return musicDir;
  } catch {}
  try {
    return app.getPath('downloads');
  } catch {
    return app.getPath('userData');
  }
}

/** Keeps a track title from turning into a path or an invalid Windows name. */
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
  const clean = safeFileName(combined, 'track');
  return `${clean}.mp3`;
}

function getUniqueFilePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let target = path.join(dir, fileName);
  let counter = 1;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base} (${counter})${ext}`);
    counter++;
  }
  return target;
}

/** Only http(s) to permitted audio sources. */
function isDownloadableUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const h = parsed.hostname.toLowerCase();
    return (
      isAllowedHost(h) ||
      h.endsWith('sndcdn.com') ||
      h.endsWith('googlevideo.com') ||
      h.endsWith('audius.co') ||
      h.endsWith('youtube.com') ||
      h.endsWith('youtu.be')
    );
  } catch {
    return false;
  }
}

async function fetchArtworkBuffer(artworkUrl) {
  if (!artworkUrl || typeof artworkUrl !== 'string') return null;
  const highResUrl = artworkUrl.replace(/-(?:large|t\d+x\d+|crop|badge|small)\.([a-zA-Z0-9]+)$/, '-t500x500.$1');
  const urlsToTry = [highResUrl, artworkUrl];
  for (const u of urlsToTry) {
    try {
      const resp = await net.fetch(u);
      if (resp.ok) {
        const ab = await resp.arrayBuffer();
        const buf = Buffer.from(ab);
        const mime = resp.headers.get('content-type') || (u.endsWith('.png') ? 'image/png' : 'image/jpeg');
        return { buf, mime };
      }
    } catch {
      // try next
    }
  }
  return null;
}

/** Fallback listener for any default session downloads */
function watchDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const suggested = item.getFilename();
    const ext = (() => {
      try {
        const fromUrl = path.extname(new URL(item.getURL()).pathname);
        return fromUrl || '.mp3';
      } catch {
        return '.mp3';
      }
    })();

    const base = safeFileName(suggested.replace(/\.[^.]+$/, ''), 'download');
    const target = getUniqueFilePath(getDefaultDownloadDir(), `${base}${ext}`);

    item.setSavePath(target);
    item.on('updated', (_e, state) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('download:progress', { state, file: target });
      }
    });
    item.once('done', (_e, state) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('download:progress', { state, file: target });
      }
    });
  });
}

ipcMain.handle('app:getDefaultDownloadDir', () => {
  return getDefaultDownloadDir();
});

ipcMain.handle('dialog:chooseFolder', async (_e, currentPath) => {
  const defaultPath =
    currentPath && typeof currentPath === 'string' && fs.existsSync(currentPath)
      ? currentPath
      : getDefaultDownloadDir();
  const res = await dialog.showOpenDialog(win || BrowserWindow.getFocusedWindow(), {
    title: 'Select Download Folder',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle('sc:download', async (_e, payload) => {
  const {
    url,
    title,
    artist,
    album,
    artwork,
    genre,
    year,
    downloadPath: customDownloadPath,
  } = (typeof payload === 'string' ? { url: payload } : payload) || {};

  if (!url || !isDownloadableUrl(url)) {
    return { ok: false, error: 'refused: not a downloadable audio link' };
  }
  const dir =
    customDownloadPath && typeof customDownloadPath === 'string' && fs.existsSync(customDownloadPath)
      ? customDownloadPath
      : getDefaultDownloadDir();

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (dirErr) {
    return { ok: false, error: `Could not access or create directory: ${dir}` };
  }

  const fileName = makeTrackFileName(artist, title);
  const targetFile = getUniqueFilePath(dir, fileName);
  const tempFile = `${targetFile}.part`;

  try {
    if (url.includes('.m3u8')) {
      let binPath = getYtDlpPath();
      if (!binPath) {
        binPath = await ensureYtDlp();
      }
      if (!binPath) {
        return { ok: false, error: 'Cannot download HLS stream without yt-dlp binary' };
      }
      await new Promise((resolve, reject) => {
        execFile(binPath, ['-o', tempFile, url], { timeout: 120000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      const resp = await net.fetch(url);
      if (!resp.ok) {
        return { ok: false, error: `Download failed with HTTP ${resp.status}` };
      }

      const totalBytes = Number(resp.headers.get('content-length')) || 0;
      let receivedBytes = 0;

      const fileStream = fs.createWriteStream(tempFile);
      const reader = resp.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fileStream.write(Buffer.from(value));
          receivedBytes += value.length;
          if (win && !win.isDestroyed() && totalBytes > 0) {
            win.webContents.send('download:progress', {
              state: 'progressing',
              receivedBytes,
              totalBytes,
              file: targetFile,
            });
          }
        }
      } finally {
        await new Promise((resolve) => fileStream.end(resolve));
      }
    }

    if (fs.existsSync(tempFile)) {
      fs.renameSync(tempFile, targetFile);
    }

    // Embed ID3 tags
    try {
      let artworkData = null;
      if (artwork) {
        artworkData = await fetchArtworkBuffer(artwork);
      }

      const tags = {
        title: title || '',
        artist: artist || '',
        album: album || title || '',
      };
      if (year) tags.year = String(year);
      if (genre) tags.genre = String(genre);
      if (artworkData?.buf) {
        tags.image = {
          mime: artworkData.mime,
          type: { id: 3, name: 'front cover' },
          description: 'Front Cover',
          imageBuffer: artworkData.buf,
        };
      }
      NodeID3.write(tags, targetFile);
    } catch (tagErr) {
      console.warn('Failed to embed ID3 tags:', tagErr);
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send('download:progress', {
        state: 'completed',
        file: targetFile,
      });
    }

    return { ok: true, file: targetFile };
  } catch (err) {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
    return { ok: false, error: err instanceof Error ? err.message : 'download failed' };
  }
});

/* ------------------------------------------------------------------ *
 * settings.json
 *
 * A plain file in the userData folder that seeds the UI state on launch:
 *
 *   %APPDATA%\Abbadon\settings.json
 *
 * Recognised keys:
 *   eqBands       4 | 8 | 16 (default 8)
 *   eq            array of eqBands numbers, -12..12, resampled onto that
 *                 layout. A 5- or 16-number array from an older install is
 *                 migrated onto the count in eqBands.
 *   visualizer    bars | wave | mirror | radial | pulse | off
 *   theme         dark | light | red | blue | green | purple | orange | pink
 *                 (midnight | oled | dusk | daylight are still mapped), or
 *                 { accent: "#rrggbb", mode: "dark" | "light" }
 *   autodiscovery "on" | "off" (compatibility only; discovery is always on
 *                 and yields to Repeat or Shuffle)
 *
 * Anything set here wins over the stored localStorage value, which makes it
 * possible to ship a preset by dropping a file next to the app. A malformed
 * file is ignored rather than blocking startup.
 * ------------------------------------------------------------------ */

ipcMain.handle('sc:settings', () => {
  const file = path.join(app.getPath('userData'), 'settings.json');
  try {
    const raw = require('node:fs').readFileSync(file, 'utf8');
    return { ok: true, path: file, data: JSON.parse(raw) };
  } catch (err) {
    const missing = err && err.code === 'ENOENT';
    return {
      ok: false,
      missing,
      path: file,
      error: missing ? null : err instanceof Error ? err.message : 'unreadable',
    };
  }
});

ipcMain.handle('sc:settings-path', () => path.join(app.getPath('userData'), 'settings.json'));

/* ------------------------------------------------------------------ *
 * Window controls & Titlebar IPC
 * ------------------------------------------------------------------ */
ipcMain.handle('window:minimize', () => {
  if (win && !win.isDestroyed()) win.minimize();
  return true;
});

ipcMain.handle('window:toggle-maximize', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    } else {
      win.maximize();
      return true;
    }
  }
  return false;
});

ipcMain.handle('window:close', () => {
  if (win && !win.isDestroyed()) win.close();
  return true;
});

ipcMain.handle('window:is-maximized', () => {
  return win && !win.isDestroyed() ? win.isMaximized() : false;
});

ipcMain.handle('window:set-custom-titlebar', (_e, enabled) => {
  const file = path.join(app.getPath('userData'), 'settings.json');
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  data.customTitleBar = Boolean(enabled);
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings.json customTitleBar:', err);
  }

  return { ok: true };
});

/* ------------------------------------------------------------------ *
 * Local & Server Media Import IPC
 * ------------------------------------------------------------------ */

const AUDIO_EXTS = new Set([
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.weba', '.wma'
]);
const PLAYLIST_EXTS = new Set(['.m3u', '.m3u8', '.pls']);

function formatDurationSec(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseAudioFileMetadata(filePath) {
  let title = '';
  let artist = '';
  let album = '';
  let artwork = '';
  let duration = 0;

  try {
    const tags = NodeID3.read(filePath);
    if (tags) {
      title = (tags.title || '').trim();
      artist = (tags.artist || '').trim();
      album = (tags.album || '').trim();
      if (tags.length) {
        duration = Math.round(Number(tags.length) / 1000) || 0;
      }
      if (tags.image && tags.image.imageBuffer) {
        artwork = `data:${tags.image.mime || 'image/jpeg'};base64,${tags.image.imageBuffer.toString('base64')}`;
      }
    }
  } catch (err) {
    console.warn('[parseAudioFileMetadata] ID3 tag read error:', err.message);
  }

  if (!title || !artist) {
    const base = path.basename(filePath, path.extname(filePath));
    const parts = base.split(/\s*[-–—]\s*/);
    if (!artist) {
      artist = parts.length > 1 ? parts[0].trim() : 'Local Artist';
    }
    if (!title) {
      title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : base.trim();
    }
  }

  const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 12);
  const streamUrl = `local-audio://file/${encodeURIComponent(filePath)}`;

  return {
    id: `local:${hash}`,
    title,
    artist,
    album,
    artwork,
    duration,
    durationFormatted: formatDurationSec(duration),
    genre: 'Local',
    permalinkUrl: filePath,
    streamUrl,
    source: 'local',
  };
}

function parseM3uText(content, basePathOrUrl) {
  const lines = content.split(/\r?\n/);
  const tracks = [];
  let curTitle = '';
  let curDuration = 0;

  const isRemote = typeof basePathOrUrl === 'string' && /^https?:\/\//i.test(basePathOrUrl);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#EXTINF:')) {
      const match = trimmed.match(/#EXTINF:(-?\d+),(.*)/);
      if (match) {
        curDuration = Math.max(0, parseInt(match[1], 10) || 0);
        curTitle = match[2].trim();
      }
    } else if (!trimmed.startsWith('#')) {
      let trackStreamUrl = '';
      let trackPermalink = trimmed;
      let isLocal = false;

      if (/^https?:\/\//i.test(trimmed)) {
        trackStreamUrl = trimmed;
      } else if (isRemote) {
        try {
          trackStreamUrl = new URL(trimmed, basePathOrUrl).toString();
          trackPermalink = trackStreamUrl;
        } catch {
          trackStreamUrl = trimmed;
        }
      } else {
        const resolved = path.isAbsolute(trimmed)
          ? trimmed
          : path.resolve(basePathOrUrl || '.', trimmed);
        trackStreamUrl = `local-audio://file/${encodeURIComponent(resolved)}`;
        trackPermalink = resolved;
        isLocal = true;
      }

      let artist = 'Various Artists';
      let title = curTitle;

      if (curTitle) {
        const parts = curTitle.split(/\s*[-–—]\s*/);
        if (parts.length > 1) {
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        }
      } else {
        const base = path.basename(trimmed, path.extname(trimmed));
        const parts = base.split(/\s*[-–—]\s*/);
        if (parts.length > 1) {
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        } else {
          title = base;
        }
      }

      const hash = crypto.createHash('md5').update(trackStreamUrl).digest('hex').slice(0, 12);
      tracks.push({
        id: `${isLocal ? 'local' : 'server'}:${hash}`,
        title: title || 'Track',
        artist: artist || 'Artist',
        duration: curDuration,
        durationFormatted: formatDurationSec(curDuration),
        artwork: '',
        genre: isLocal ? 'Local' : 'Server',
        permalinkUrl: trackPermalink,
        streamUrl: trackStreamUrl,
        source: isLocal ? 'local' : 'server',
      });

      curTitle = '';
      curDuration = 0;
    }
  }

  return tracks;
}

function scanAudioFolder(folderPath, maxFiles = 1000) {
  const results = [];
  function walk(current) {
    if (results.length >= maxFiles) return;
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (AUDIO_EXTS.has(ext) || PLAYLIST_EXTS.has(ext)) {
            results.push(full);
          }
        }
      }
    } catch (err) {
      console.warn('[scanAudioFolder] error reading dir:', err.message);
    }
  }
  walk(folderPath);
  return results;
}

async function parseMediaPaths(filePaths) {
  const songs = [];
  const playlists = [];

  for (const fp of filePaths) {
    try {
      const ext = path.extname(fp).toLowerCase();
      if (PLAYLIST_EXTS.has(ext)) {
        const content = fs.readFileSync(fp, 'utf8');
        const playlistTracks = parseM3uText(content, path.dirname(fp));
        const plTitle = path.basename(fp, ext);
        const plHash = crypto.createHash('md5').update(fp).digest('hex').slice(0, 10);
        playlists.push({
          id: `local:pl:${plHash}`,
          title: plTitle,
          description: `Imported from ${fp}`,
          artwork: playlistTracks[0]?.artwork || '',
          trackCount: playlistTracks.length,
          tracks: playlistTracks,
          isLocal: true,
          source: 'local',
        });
      } else if (AUDIO_EXTS.has(ext)) {
        const meta = parseAudioFileMetadata(fp);
        songs.push(meta);
      }
    } catch (err) {
      console.warn('[parseMediaPaths] Failed to parse:', fp, err.message);
    }
  }

  return { songs, playlists };
}

ipcMain.handle('media:pick-files', async () => {
  if (!win || win.isDestroyed()) return { ok: false, canceled: true, items: { songs: [], playlists: [] } };
  const res = await dialog.showOpenDialog(win, {
    title: 'Add Songs or Playlists from PC',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'All Supported Media',
        extensions: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'weba', 'm3u', 'm3u8', 'pls'],
      },
      {
        name: 'Audio Files (*.mp3, *.flac, *.wav, etc.)',
        extensions: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'weba'],
      },
      {
        name: 'Playlist Files (*.m3u, *.m3u8, *.pls)',
        extensions: ['m3u', 'm3u8', 'pls'],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true, items: { songs: [], playlists: [] } };
  const items = await parseMediaPaths(res.filePaths);
  return { ok: true, items };
});

ipcMain.handle('media:pick-folder', async () => {
  if (!win || win.isDestroyed()) return { ok: false, canceled: true, items: { songs: [], playlists: [] } };
  const res = await dialog.showOpenDialog(win, {
    title: 'Add Music Folder from PC',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true, items: { songs: [], playlists: [] } };
  const folder = res.filePaths[0];
  const folderName = path.basename(folder);
  const filePaths = scanAudioFolder(folder);
  const items = await parseMediaPaths(filePaths);
  return { ok: true, folderName, items };
});

ipcMain.handle('media:parse-paths', async (_e, filePaths) => {
  if (!Array.isArray(filePaths) || !filePaths.length) {
    return { ok: false, items: { songs: [], playlists: [] } };
  }
  const items = await parseMediaPaths(filePaths);
  return { ok: true, items };
});

ipcMain.handle('media:fetch-server-playlist', async (_e, url) => {
  try {
    const res = await net.fetch(url);
    if (!res.ok) {
      return { ok: false, error: `Server returned HTTP ${res.status}` };
    }
    const text = await res.text();
    const tracks = parseM3uText(text, url);
    let title = '';
    try {
      const parsedUrl = new URL(url);
      title = path.basename(parsedUrl.pathname, path.extname(parsedUrl.pathname)) || parsedUrl.hostname;
    } catch {
      title = 'Server Playlist';
    }
    const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 10);
    return {
      ok: true,
      playlist: {
        id: `server:pl:${hash}`,
        title: title || 'Server Playlist',
        description: `Streamed from ${url}`,
        artwork: tracks[0]?.artwork || '',
        trackCount: tracks.length,
        tracks,
        isLocal: false,
        source: 'server',
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('media:save-local-library', (_e, data) => {
  const file = path.join(app.getPath('userData'), 'local_library.json');
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('media:load-local-library', () => {
  const file = path.join(app.getPath('userData'), 'local_library.json');
  try {
    if (!fs.existsSync(file)) return { ok: true, data: null };
    const raw = fs.readFileSync(file, 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('media:save-picture', async (_e, payload) => {
  const { url, filename, title } = payload || {};
  if (!url) return { ok: false, error: 'No image URL provided' };

  try {
    const picturesDir = app.getPath('pictures');
    if (!fs.existsSync(picturesDir)) {
      fs.mkdirSync(picturesDir, { recursive: true });
    }

    // High resolution upgrade for SoundCloud artwork/avatars if available
    let fetchUrl = String(url).trim();
    if (fetchUrl.includes('sndcdn.com')) {
      fetchUrl = fetchUrl.replace('-large.jpg', '-t500x500.jpg');
    }

    const cleanBase = safeFileName(title || filename || 'picture', 'picture');
    let ext = '.jpg';
    let buffer;

    if (fetchUrl.startsWith('data:')) {
      const match = fetchUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        ext = `.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
        buffer = Buffer.from(match[2], 'base64');
      } else {
        const parts = fetchUrl.split(',');
        buffer = Buffer.from(parts[1] || '', 'base64');
      }
    } else {
      const resp = await net.fetch(fetchUrl);
      if (!resp.ok) {
        throw new Error(`Failed to download image (HTTP ${resp.status})`);
      }
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('png')) ext = '.png';
      else if (contentType.includes('webp')) ext = '.webp';
      else if (contentType.includes('gif')) ext = '.gif';
      else if (contentType.includes('svg')) ext = '.svg';
      else ext = '.jpg';

      const arrayBuffer = await resp.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    const finalName = `${cleanBase}${ext}`;
    const targetPath = getUniqueFilePath(picturesDir, finalName);
    fs.writeFileSync(targetPath, buffer);

    return { ok: true, path: targetPath, filename: path.basename(targetPath) };
  } catch (err) {
    console.warn('[main:save-picture] Failed to save picture:', err);
    return { ok: false, error: err.message };
  }
});

/* ------------------------------------------------------------------ *
 * Proxy & Regional Bypass IPC
 * ------------------------------------------------------------------ */

ipcMain.handle('sc:get-proxy-config', () => {
  return proxyManager.getConfig();
});

ipcMain.handle('sc:set-proxy-config', async (_e, config) => {
  return await proxyManager.setConfig(config);
});

ipcMain.handle('sc:test-proxy', async (_e, config) => {
  return await proxyManager.testProxy(config);
});

ipcMain.handle('sc:get-builtin-proxies', () => {
  return PRESETS;
});

ipcMain.handle('sc:refresh-proxies', () => {
  return { ok: true, presets: PRESETS };
});

/* ------------------------------------------------------------------ *
 * Official Stream Resolver (Native yt-dlp backend for Go+/blocked songs)
 * ------------------------------------------------------------------ */

const officialStreamCache = new Map();
const inFlightResolutions = new Map();

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

function resolveOfficialStream({ artist, title }) {
  const cleanTitle = (title || '').replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
  const cleanArtist = (artist || '').trim();
  const cacheKey = `${cleanArtist.toLowerCase()}:${cleanTitle.toLowerCase()}`;

  const hit = officialStreamCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    return Promise.resolve({ ok: true, url: hit.url, duration: hit.duration, title: hit.title });
  }

  if (inFlightResolutions.has(cacheKey)) {
    return inFlightResolutions.get(cacheKey);
  }

  const promise = new Promise(async (resolve) => {
    let binPath = getYtDlpPath();
    if (!binPath) {
      binPath = await ensureYtDlp();
    }
    if (!binPath) {
      resolve({ ok: false, error: 'yt-dlp binary not found' });
      return;
    }

    const query = cleanArtist
      ? (cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase()) ? cleanTitle : `${cleanArtist} - ${cleanTitle}`)
      : cleanTitle;

    const searchTerm = `ytsearch1:${query}`;
    const args = [
      '--no-warnings',
      '--no-playlist',
      '--no-check-certificates',
      '--socket-timeout', '5',
      '--extractor-retries', '1',
      '-f', 'ba/b',
      '-g',
      '--print', '%(title)s',
      '--print', '%(duration)s',
      searchTerm,
    ];

    execFile(binPath, args, { timeout: 7000 }, (err, stdout) => {
      const parsed = stdout ? parseYtDlpOutput(stdout, cleanTitle) : { ok: false, error: 'No output' };
      if (!err && parsed.ok && parsed.url) {
        officialStreamCache.set(cacheKey, {
          url: parsed.url,
          duration: parsed.duration,
          title: parsed.title,
          expires: Date.now() + 2 * 60 * 60 * 1000,
        });
        resolve(parsed);
        return;
      }

      // Try alternate query if title didn't match or failed
      const altSearch = `ytsearch1:${cleanTitle} ${cleanArtist}`;
      const altArgs = [
        '--no-warnings',
        '--no-playlist',
        '--no-check-certificates',
        '--socket-timeout', '5',
        '--extractor-retries', '1',
        '-f', 'ba/b',
        '-g',
        '--print', '%(title)s',
        '--print', '%(duration)s',
        altSearch,
      ];
      execFile(binPath, altArgs, { timeout: 7000 }, (err2, stdout2) => {
        const parsed2 = stdout2 ? parseYtDlpOutput(stdout2, cleanTitle) : { ok: false, error: 'Alternate query failed' };
        if (!err2 && parsed2.ok && parsed2.url) {
          officialStreamCache.set(cacheKey, {
            url: parsed2.url,
            duration: parsed2.duration,
            title: parsed2.title,
            expires: Date.now() + 2 * 60 * 60 * 1000,
          });
          resolve(parsed2);
        } else {
          resolve({ ok: false, error: parsed2.error || err2?.message || 'Resolution failed' });
        }
      });
    });
  }).finally(() => {
    inFlightResolutions.delete(cacheKey);
  });

  inFlightResolutions.set(cacheKey, promise);
  return promise;
}

ipcMain.handle('sc:resolve-official-stream', async (_e, params) => {
  return await resolveOfficialStream(params || {});
});

/* ------------------------------------------------------------------ *
 * Desktop Integrations: Tray, Discord RPC, Notifications
 * ------------------------------------------------------------------ */

const DEFAULT_DISCORD_CLIENT_ID = '1556387651999899668';
let rpcReconnectTimer = null;

function getDiscordClientId() {
  const file = path.join(app.getPath('userData'), 'settings.json');
  try {
    const raw = require('node:fs').readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed.discordClientId &&
      typeof parsed.discordClientId === 'string' &&
      parsed.discordClientId.trim() &&
      parsed.discordClientId.trim() !== '1177081335727267940'
    ) {
      return parsed.discordClientId.trim();
    }
  } catch {}
  return DEFAULT_DISCORD_CLIENT_ID;
}

function connectDiscordRPC() {
  if (rpcConnected) return;
  try {
    const DiscordRPC = require('discord-rpc');
    if (rpcClient) {
      try { rpcClient.destroy(); } catch {}
    }
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' });

    rpcClient.on('ready', () => {
      rpcConnected = true;
      try {
        rpcClient.subscribe('ACTIVITY_JOIN').catch(() => {});
        rpcClient.subscribe('ACTIVITY_JOIN_REQUEST').catch(() => {});
      } catch {}

      if (lastPlaybackState.track || lastPlaybackState.friendCode) {
        updateDiscordRPC(
          lastPlaybackState.track,
          lastPlaybackState.isPlaying,
          lastPlaybackState.currentTime,
          lastPlaybackState.duration,
          lastPlaybackState.friendCode,
          lastPlaybackState.shareDiscordFriendCode,
          lastPlaybackState.showDiscordButtons
        );
      }
    });

    rpcClient.on('ACTIVITY_JOIN', (data) => {
      const secret = data && data.secret ? String(data.secret) : '';
      const code = secret.replace(/^join_/, '').trim();
      if (code && win && !win.isDestroyed()) {
        win.webContents.send('sc:discord-join-friend', code);
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });

    rpcClient.on('ACTIVITY_JOIN_REQUEST', (user) => {
      if (lastPlaybackState.shareDiscordFriendCode && rpcClient) {
        try {
          rpcClient.sendJoinInvite(user).catch(() => {});
        } catch {}
      }
    });

    rpcClient.transport.on('close', () => {
      rpcConnected = false;
      scheduleRpcReconnect();
    });

    const activeClientId = getDiscordClientId();
    rpcClient.login({ clientId: activeClientId }).catch(() => {
      rpcConnected = false;
      scheduleRpcReconnect();
    });
  } catch {
    rpcConnected = false;
    scheduleRpcReconnect();
  }
}

function scheduleRpcReconnect() {
  if (rpcReconnectTimer) return;
  rpcReconnectTimer = setTimeout(() => {
    rpcReconnectTimer = null;
    if (!rpcConnected) {
      connectDiscordRPC();
    }
  }, 6000);
}

function initDiscordRPC() {
  connectDiscordRPC();
}

function updateDiscordRPC(track, isPlaying, currentTime = 0, duration = 0, friendCode = null, shareDiscordFriendCode = false, showDiscordButtons = true) {
  lastPlaybackState = { track, isPlaying, currentTime, duration, friendCode, shareDiscordFriendCode, showDiscordButtons };
  if (!rpcClient || !rpcConnected) return;

  try {
    if (!track) {
      rpcClient.clearActivity().catch(() => {});
      return;
    }

    const now = Date.now();
    const rawTitle = String(track.title || 'SoundCloud').trim();
    const details = (rawTitle.length >= 2 ? rawTitle : rawTitle + '  ').slice(0, 128);
    const rawArtist = String(track.artist || 'Unknown Artist').trim();
    const state = `by ${rawArtist}`.slice(0, 128);

    let artwork = track.artwork;
    if (typeof artwork === 'string' && artwork.startsWith('http://')) {
      artwork = artwork.replace('http://', 'https://');
    }

    const rawActivity = {
      type: 2, // 2 = LISTENING
      name: 'Abbadon',
      details,
      state,
      assets: {
        large_image: artwork || 'icon',
        large_text: details,
        small_image: isPlaying ? 'play' : 'pause',
        small_text: isPlaying ? 'Playing on Abbadon' : 'Paused',
      },
      instance: false,
    };

    if (isPlaying && duration > 0) {
      rawActivity.timestamps = {
        start: Math.floor(now - currentTime * 1000),
        end: Math.floor(now + (duration - currentTime) * 1000),
      };
    }

    // Configurable Discord Presence Profile Buttons (Visible to others viewing profile)
    if (showDiscordButtons !== false) {
      const buttons = [];
      const permalink = track.permalinkUrl || (track.permalink ? `https://soundcloud.com/${track.permalink}` : null);
      if (permalink && typeof permalink === 'string' && permalink.startsWith('http')) {
        buttons.push({ label: 'Otworz utwor', url: permalink.slice(0, 512) });
      } else {
        buttons.push({ label: 'Abbadon Player', url: 'https://github.com/Xertoo/abbadon' });
      }

      if (friendCode && shareDiscordFriendCode) {
        buttons.push({ label: 'Dolacz do sesji', url: 'https://github.com/Xertoo/abbadon' });
      } else {
        buttons.push({ label: 'Pobierz Abbadon', url: 'https://github.com/Xertoo/abbadon' });
      }
      rawActivity.buttons = buttons;
    }

    const send = (act) => rpcClient.request('SET_ACTIVITY', { pid: process.pid, activity: act });

    send(rawActivity).catch((err) => {
      // Fallback for older Discord clients that reject type: 2 (Listening) or buttons
      const fallback = { ...rawActivity };
      delete fallback.type;
      send(fallback).catch(() => {});
    });
  } catch {
    // Ignore RPC set errors
  }
}

ipcMain.handle('sc:set-discord-client-id', (_e, newId) => {
  const file = path.join(app.getPath('userData'), 'settings.json');
  try {
    let data = {};
    try {
      data = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
    } catch {}
    data.discordClientId = (newId || '').trim();
    require('node:fs').writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    if (rpcClient) {
      try { rpcClient.destroy(); } catch {}
    }
    rpcConnected = false;
    connectDiscordRPC();
    return { ok: true, clientId: data.discordClientId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

let isMiniPinned = true;
let miniCustomPos = null;
let lastMiniPrefs = null;

function createTrayWindow() {
  if (trayWin && !trayWin.isDestroyed()) return trayWin;

  trayWin = new BrowserWindow({
    width: 360,
    height: 205,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: isMiniPinned,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: 'Abbadon Mini',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  trayWin.setMenu(null);
  killMenu(trayWin);

  const url = isDev && DEV_URL ? `${DEV_URL}?mode=tray` : `file://${path.join(__dirname, '..', 'dist', 'index.html')}?mode=tray`;
  trayWin.loadURL(url);

  trayWin.on('blur', () => {
    if (!isMiniPinned && trayWin && !trayWin.isDestroyed() && trayWin.isVisible()) {
      trayWin.hide();
    }
  });

  trayWin.on('moved', () => {
    if (trayWin && !trayWin.isDestroyed()) {
      miniCustomPos = trayWin.getPosition();
    }
  });

  return trayWin;
}

function toggleTrayWindow() {
  if (!trayWin || trayWin.isDestroyed()) {
    createTrayWindow();
  }
  if (trayWin.isVisible()) {
    trayWin.hide();
    return;
  }
  if (miniCustomPos && Array.isArray(miniCustomPos)) {
    trayWin.setPosition(miniCustomPos[0], miniCustomPos[1], false);
  } else if (tray) {
    const { screen } = require('electron');
    const trayBounds = tray.getBounds();
    const winBounds = trayWin.getBounds();

    if (!trayBounds || !trayBounds.width || !trayBounds.height) {
      const primary = screen.getPrimaryDisplay();
      const workArea = primary.workArea;
      const x = Math.round(workArea.x + workArea.width - winBounds.width - 16);
      const y = Math.round(workArea.y + workArea.height - winBounds.height - 16);
      trayWin.setPosition(x, y, false);
    } else {
      const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
      let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
      let y = Math.round(trayBounds.y - winBounds.height - 12);
      if (trayBounds.y < display.bounds.y + 200) {
        y = Math.round(trayBounds.y + trayBounds.height + 12);
      }

      if (x + winBounds.width > display.bounds.x + display.bounds.width) {
        x = display.bounds.x + display.bounds.width - winBounds.width - 12;
      }
      if (x < display.bounds.x) {
        x = display.bounds.x + 12;
      }
      trayWin.setPosition(x, y, false);
    }
  }
  trayWin.setAlwaysOnTop(isMiniPinned, 'screen-saver');
  if (lastMiniPrefs) {
    trayWin.webContents.send('sc:sync-mini-prefs', lastMiniPrefs);
  }
  trayWin.show();
  trayWin.focus();
  trayWin.webContents.send('sc:sync-tray-player', lastPlaybackState);
  trayWin.webContents.send('sc:sync-mini-pinned', isMiniPinned);
}

ipcMain.on('mini:prefs', (_e, prefs) => {
  lastMiniPrefs = prefs;
  if (trayWin && !trayWin.isDestroyed()) {
    trayWin.webContents.send('sc:sync-mini-prefs', prefs);
  }
});

function initTray() {
  if (tray) return updateTrayMenu;
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, iconFile);

  try {
    tray = new Tray(iconPath);
  } catch {
    try {
      tray = new Tray(path.join(__dirname, 'icon.png'));
    } catch {
      return () => {};
    }
  }

  tray.setToolTip('Abbadon');

  function updateTrayMenu(track, isPlaying) {
    const template = [
      {
        label: track ? `${track.title} - ${track.artist}` : 'Abbadon (Not playing)',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: isPlaying ? 'Pause' : 'Play',
        click: () => win?.webContents.send('media-command', 'toggle'),
      },
      {
        label: 'Next Track',
        click: () => win?.webContents.send('media-command', 'next'),
      },
      {
        label: 'Previous Track',
        click: () => win?.webContents.send('media-command', 'prev'),
      },
      { type: 'separator' },
      {
        label: 'Mini Player',
        click: () => toggleTrayWindow(),
      },
      {
        label: win && win.isVisible() ? 'Hide to Tray' : 'Show Abbadon',
        click: () => {
          if (!win) return;
          if (win.isVisible()) win.hide();
          else {
            win.show();
            win.focus();
          }
        },
      },
      {
        label: 'Quit Abbadon',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ];

    tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  // Left click opens mini-player flyout
  tray.on('click', () => {
    toggleTrayWindow();
  });

  // Double click restores the main window
  tray.on('double-click', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  updateTrayMenu(null, false);
  return updateTrayMenu;
}

function notifyTrack(track) {
  if (!track || !Notification.isSupported()) return;
  // Don't show toast if user is actively focused on the window
  if (win && win.isVisible() && win.isFocused()) return;

  try {
    const iconPath = path.join(__dirname, 'icon.png');
    const notif = new Notification({
      title: track.title,
      body: track.artist,
      icon: iconPath,
      silent: true,
    });

    notif.on('click', () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });

    notif.show();
  } catch {
    // notification not permitted or error
  }
}

ipcMain.on('sc:player-state', (_e, payload) => {
  const { track, isPlaying, currentTime = 0, duration = 0, friendCode, shareDiscordFriendCode, showDiscordButtons, volume } = payload;
  lastPlaybackState = { track, isPlaying, currentTime, duration, friendCode, shareDiscordFriendCode, showDiscordButtons, volume };

  if (updateTrayFn) {
    updateTrayFn(track, isPlaying);
  }
  updateDiscordRPC(track, isPlaying, currentTime, duration, friendCode, shareDiscordFriendCode, showDiscordButtons);

  if (trayWin && !trayWin.isDestroyed() && trayWin.isVisible()) {
    trayWin.webContents.send('sc:sync-tray-player', lastPlaybackState);
  }

  if (track && track.id !== lastNotifiedTrackId && isPlaying) {
    lastNotifiedTrackId = track.id;
    notifyTrack(track);
  }
});

ipcMain.on('mini:command', (_e, { action, value }) => {
  if (action === 'restore') {
    if (trayWin && !trayWin.isDestroyed()) trayWin.hide();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  } else if (action === 'hide') {
    if (trayWin && !trayWin.isDestroyed()) trayWin.hide();
  } else if (action === 'pin') {
    isMiniPinned = Boolean(value);
    if (trayWin && !trayWin.isDestroyed()) {
      trayWin.setAlwaysOnTop(isMiniPinned, 'screen-saver');
      trayWin.webContents.send('sc:sync-mini-pinned', isMiniPinned);
    }
  } else if (action === 'seek') {
    if (win && !win.isDestroyed()) {
      win.webContents.send('seek-command', value);
    }
  } else if (action === 'volume') {
    if (win && !win.isDestroyed()) {
      win.webContents.send('volume-command', value);
    }
  } else {
    if (win && !win.isDestroyed()) {
      win.webContents.send('media-command', action);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Deep Linking Protocol & Single Instance Lifecycle
 * ------------------------------------------------------------------ */

function handleProtocolUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return;
  const match = urlStr.match(/abbadon:\/\/(?:friend\/|join\/)?([A-Za-z0-9_-]+)/i);
  if (match && match[1]) {
    const friendCode = match[1];
    if (win && !win.isDestroyed()) {
      win.webContents.send('sc:discord-join-friend', friendCode);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }
}

// Register default protocol client for abbadon:// (e.g. abbadon://friend/SC-XXXX)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('abbadon', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('abbadon');
}

/**
 * One instance per profile.
 *
 * A dev `electron .` next to a packaged Abbadon.exe both resolve to the same
 * %APPDATA% profile, so they fight over the Chromium cache and the
 * persist:soundcloud partition: "Unable to move the cache: Access is denied",
 * a GPU cache that never gets created, and cookies rewritten from both sides.
 * The second launch now focuses the window that is already running instead.
 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[app] another instance is running - focusing it instead');
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();

  if (Array.isArray(argv)) {
    const deepLink = argv.find((arg) => typeof arg === 'string' && arg.startsWith('abbadon://'));
    if (deepLink) {
      handleProtocolUrl(deepLink);
    }
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

let userShortcuts = {
  enabled: true,
  toggle: 'Ctrl+Alt+Space',
  next: 'Ctrl+Alt+Right',
  prev: 'Ctrl+Alt+Left',
  volumeUp: 'Ctrl+Alt+Up',
  volumeDown: 'Ctrl+Alt+Down',
  miniPlayer: 'Ctrl+Alt+M',
};

function registerAllGlobalShortcuts() {
  globalShortcut.unregisterAll();

  // Always register hardware media keys
  const hardwareKeys = {
    MediaPlayPause: 'toggle',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
    MediaStop: 'stop',
  };
  for (const [accel, action] of Object.entries(hardwareKeys)) {
    try {
      globalShortcut.register(accel, () => {
        if (win && !win.isDestroyed()) win.webContents.send('media-command', action);
      });
    } catch {}
  }

  if (!userShortcuts.enabled) return;

  const mapping = [
    { key: userShortcuts.toggle, action: 'toggle' },
    { key: userShortcuts.next, action: 'next' },
    { key: userShortcuts.prev, action: 'prev' },
    { key: userShortcuts.volumeUp, action: 'volume-up' },
    { key: userShortcuts.volumeDown, action: 'volume-down' },
    { key: userShortcuts.miniPlayer, action: 'mini-toggle' },
  ];

  for (const item of mapping) {
    if (item.key && typeof item.key === 'string' && item.key.trim()) {
      try {
        globalShortcut.register(item.key.trim(), () => {
          if (item.action === 'mini-toggle') {
            toggleTrayWindow();
          } else if (win && !win.isDestroyed()) {
            win.webContents.send('media-command', item.action);
          }
        });
      } catch (err) {
        console.warn(`[shortcuts] Failed to register: ${item.key}`, err?.message);
      }
    }
  }
}

ipcMain.handle('shortcuts:update', (_e, shortcuts) => {
  if (shortcuts && typeof shortcuts === 'object') {
    userShortcuts = { ...userShortcuts, ...shortcuts };
    registerAllGlobalShortcuts();
    return { ok: true };
  }
  return { ok: false, error: 'Invalid shortcut payload' };
});

ipcMain.handle('shortcuts:get', () => {
  return { ok: true, shortcuts: userShortcuts };
});

app.whenReady().then(async () => {
  // quit() above is asynchronous; bail out before creating a second window.
  if (!gotLock) return;

  // Handle local audio file streaming with full byte range & seeking support
  protocol.handle('local-audio', (request) => {
    try {
      let filePath = request.url.replace(/^local-audio:\/\/(?:file\/)?/, '');
      filePath = decodeURIComponent(filePath);
      if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) {
        filePath = filePath.slice(1);
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      console.error('[local-audio] protocol error:', err);
      return new Response('File not found', { status: 404 });
    }
  });

  // Initialize Proxy Manager & Regional Bypass routing
  try {
    await proxyManager.init(app, session);
  } catch (err) {
    console.log('[ProxyManager] Init error:', err.message);
  }

  // Restore authenticated session & DataDome cookies on startup
  try {
    await syncAllAuthCookies();
  } catch (err) {
    console.log('[cookies] Init sync error:', err.message);
  }

  app.setName('Abbadon');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.abbadon.player');
  }
  nativeTheme.themeSource = 'dark';
  // Relax CORS for the whole renderer, not just the SoundCloud CDN.
  //
  // Three consumers need it: canvas colour extraction and the <audio> element
  // (Web Audio silences a MediaElementSource fed by non-CORS media), plus the
  // open APIs this app grew onto - Audius' discovery provider has no
  // Access-Control-Allow-Origin of its own and its streams land on a rotation
  // of creator mirrors after a 302. A blanket header keeps every one of those
  // sources working without per-host exceptions.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };

      // Additive-only on purpose: SoundCloud responds to credentialed fetches
      // with a specific Access-Control-Allow-Origin of its own, and overwriting
      // it with `*` makes Chromium kill those requests with net::ERR_FAILED.
      // Only add headers for hosts that send none.
      if (!responseHeaders['access-control-allow-origin']) {
        responseHeaders['access-control-allow-origin'] = ['*'];
      }
      if (!responseHeaders['access-control-allow-methods']) {
        responseHeaders['access-control-allow-methods'] = ['GET, OPTIONS'];
      }
      if (!responseHeaders['access-control-allow-headers']) {
        responseHeaders['access-control-allow-headers'] = ['*'];
      }
      // Some CDNs ship cross-origin-resource-policy: same-origin, which would
      // block the renderer's fetch even with the headers above.
      if (!responseHeaders['cross-origin-resource-policy']) {
        responseHeaders['cross-origin-resource-policy'] = ['cross-origin'];
      }
      callback({ responseHeaders });
    }
  );
  // The default session only exists after ready, so this cannot be registered
  // at module load like the ipcMain handlers above.
  watchDownloads();
  createWindow();

  const startupDeepLink = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('abbadon://'));
  if (startupDeepLink && win) {
    win.webContents.once('did-finish-load', () => {
      handleProtocolUrl(startupDeepLink);
    });
  }

  // Initialize Auto-Updater
  try {
    initAutoUpdater(win, isDev || isLocalBuild, () => {
      isQuitting = true;
    });
  } catch (err) {
    console.log('[AutoUpdater] Initialization failed:', err.message);
  }

  // Initialize Desktop features
  updateTrayFn = initTray();
  initDiscordRPC();

  registerAllGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});