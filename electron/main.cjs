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
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { proxyManager, PRESETS } = require('./proxyManager.cjs');
const { initAutoUpdater } = require('./autoUpdater.cjs');

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
    if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'widevine', 'widevinecdm.dll'));
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

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let win = null;
let authWin = null;
let tray = null;
let updateTrayFn = null;
let isQuitting = false;
let rpcClient = null;
let rpcConnected = false;
let lastNotifiedTrackId = null;

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

/** @returns {BrowserWindow} */
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    title: 'Abbadon',
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // EME/DRM (Widevine) is refused unless plugins are enabled. Spotify's Web
      // Playback SDK needs it for full-length decryption; without a CDM the
      // switch is inert and playback simply falls back to the SDK's own error.
      plugins: true,
    },
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
    h === 'scdn.co' ||
    h.endsWith('.scdn.co')
  );
}

ipcMain.handle('sc:fetch', async (_e, { url, method = 'GET', headers = {}, body = null }) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 0, text: '', error: 'invalid url' };
  }

  const isCdn = parsed.hostname.endsWith('sndcdn.com');
  if (!isAllowedHost(parsed.hostname)) {
    return { ok: false, status: 0, text: '', error: `host not allowed: ${parsed.hostname}` };
  }

  try {
    const requestHeaders = {
      'User-Agent': UA,
      Accept: isCdn ? '*/*' : 'application/json, text/javascript, */*; q=0.01',
      ...(isCdn ? {} : { Origin: 'https://soundcloud.com' }),
      Referer: 'https://soundcloud.com/',
      ...headers,
    };

    // Use defaultSession for all API/scraping requests.
    // After login, finish() copies auth cookies from persist:soundcloud into
    // defaultSession so that authenticated endpoints work automatically.
    // For CDN assets, credentials must be omitted to prevent Chromium CORS net::ERR_FAILED.
    const res = await session.defaultSession.fetch(url, {
      method,
      headers: requestHeaders,
      body: body ?? undefined,
      redirect: 'follow',
      credentials: isCdn ? 'omit' : 'include',
    });

    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text: await res.text(),
    };
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
        try {
          const loginSession = session.fromPartition('persist:soundcloud');
          // Get ALL cookies, not just soundcloud.com — the auth may span
          // multiple subdomains (api-v2.soundcloud.com, sndcdn.com, etc.)
          const allLoginCookies = await loginSession.cookies.get({});
          console.log('[login] copying', allLoginCookies.length, 'cookies to defaultSession');
          for (const c of allLoginCookies) {
            try {
              const domain = c.domain.replace(/^\./, '');
              const protocol = c.secure ? 'https' : 'http';
              await session.defaultSession.cookies.set({
                url: `${protocol}://${domain}`,
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path || '/',
                secure: c.secure,
                httpOnly: c.httpOnly,
                expirationDate: c.expirationDate,
              });
            } catch (e) {
              console.log('[login] failed to copy cookie', c.name, e.message);
            }
          }
        } catch (e) {
          console.log('[login] cookie copy error', e.message);
        }
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
      try {
        const loginSess = session.fromPartition('persist:soundcloud');
        const scCookies = await loginSess.cookies.get({});
        for (const c of scCookies) {
          try {
            await session.defaultSession.cookies.set({
              url: c.secure ? `https://${c.domain.replace(/^\./, '')}` : `http://${c.domain.replace(/^\./, '')}`,
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path || '/',
              secure: c.secure,
              httpOnly: c.httpOnly,
              expirationDate: c.expirationDate,
            });
          } catch { /* skip individual failures */ }
        }
        console.log('[login] synced', scCookies.length, 'cookies to defaultSession');
      } catch (e) {
        console.log('[login] syncCookies error:', e.message);
      }
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
 * Downloads
 *
 * The signed CDN link is single-use and short-lived, so it has to be handed to
 * the session as-is. `will-download` is where the filename is decided, because
 * by the time downloadURL() returns there is nothing left to rename.
 * ------------------------------------------------------------------ */

const ILLEGAL_FILENAME = /[\\/:*?"<>|]/g;

/** Keeps a track title from turning into a path or an invalid Windows name. */
function safeFileName(name, fallback) {
  const base = String(name || '')
    .replace(ILLEGAL_FILENAME, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (base || fallback || 'soundcloud').slice(0, 120);
}

/** Only http(s) to a SoundCloud CDN or domain; anything else is refused outright. */
function isDownloadableUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      isAllowedHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** Registers the save-path hook. Called once the app is ready. */
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

    const base = safeFileName(suggested.replace(/\.[^.]+$/, ''), 'soundcloud');
    const target = path.join(app.getPath('downloads'), `${base}${ext}`);

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

ipcMain.handle('sc:download', async (_e, { url, title }) => {
  if (!url || !isDownloadableUrl(url)) {
    return { ok: false, error: 'refused: not a SoundCloud CDN link' };
  }
  try {
    // The session only exists once the app is ready, and this handler is
    // registered at module load, so the ready state is checked rather than
    // assumed.
    if (!app.isReady()) return { ok: false, error: 'app is not ready yet' };
    session.defaultSession.downloadURL(url);
    return { ok: true, file: path.join(app.getPath('downloads'), `${safeFileName(title, 'soundcloud')}`) };
  } catch (err) {
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

const { execFile } = require('node:child_process');

const getYtDlpPath = () => {
  const candidates = [
    path.join(__dirname, 'bin', 'yt-dlp.exe'),
    path.join(__dirname, '..', 'bin', 'yt-dlp.exe'),
    path.join(process.resourcesPath || '', 'electron', 'bin', 'yt-dlp.exe'),
    path.join(process.resourcesPath || '', 'bin', 'yt-dlp.exe'),
    path.join(app.getAppPath(), 'electron', 'bin', 'yt-dlp.exe'),
    path.join(app.getAppPath(), 'bin', 'yt-dlp.exe'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
};

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

  const promise = new Promise((resolve) => {
    const binPath = getYtDlpPath();
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
      '--socket-timeout', '6',
      '--extractor-retries', '1',
      '-f', 'ba/b',
      '-g',
      '--print', '%(title)s',
      '--print', '%(duration)s',
      searchTerm,
    ];

    execFile(binPath, args, { timeout: 12000 }, (err, stdout) => {
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
        '--socket-timeout', '6',
        '--extractor-retries', '1',
        '-f', 'ba/b',
        '-g',
        '--print', '%(title)s',
        '--print', '%(duration)s',
        altSearch,
      ];
      execFile(binPath, altArgs, { timeout: 12000 }, (err2, stdout2) => {
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
let lastPlaybackState = {
  track: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  friendCode: null,
  shareDiscordFriendCode: false,
};
let rpcReconnectTimer = null;

function getDiscordClientId() {
  const file = path.join(app.getPath('userData'), 'settings.json');
  try {
    const raw = require('node:fs').readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.discordClientId && typeof parsed.discordClientId === 'string' && parsed.discordClientId.trim()) {
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
          lastPlaybackState.shareDiscordFriendCode
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
  }, 10000);
}

function initDiscordRPC() {
  connectDiscordRPC();
}

function updateDiscordRPC(track, isPlaying, currentTime = 0, duration = 0, friendCode = null, shareDiscordFriendCode = false) {
  lastPlaybackState = { track, isPlaying, currentTime, duration, friendCode, shareDiscordFriendCode };
  if (!rpcClient || !rpcConnected) return;

  try {
    if (!track) {
      rpcClient.clearActivity().catch(() => {});
      return;
    }

    const now = Date.now();
    const rawActivity = {
      type: 2, // 2 = LISTENING (displays music / headphones icon instead of game controller)
      name: 'Abbadon',
      details: String(track.title).slice(0, 128),
      state: `by ${track.artist}`.slice(0, 128),
      assets: {
        large_image: track.artwork || 'icon',
        large_text: String(track.title).slice(0, 128),
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

    // Discord Rich Presence:
    // Discord strictly forbids sending BOTH 'secrets' AND 'buttons' in the same activity (error 5005).
    // If party/secrets are sent, Discord renders its native Join button for mutual friends.
    // If not sharing friend code, Discord displays custom URL buttons.
    if (shareDiscordFriendCode && friendCode) {
      const partyId = String(friendCode).replace(/[^a-zA-Z0-9_-]/g, '');
      rawActivity.party = {
        id: `abbadon_party_${partyId}`,
        size: [1, 8],
      };
      rawActivity.secrets = {
        join: `join_${friendCode}`,
      };
    } else {
      const buttons = [];
      if (track.permalinkUrl && typeof track.permalinkUrl === 'string' && track.permalinkUrl.startsWith('http')) {
        buttons.push({ label: 'SoundCloud Track', url: track.permalinkUrl });
      }
      buttons.push({ label: 'Get Abbadon App', url: 'https://github.com/Xertoo/abbadon' });
      rawActivity.buttons = buttons.slice(0, 2);
    }

    rpcClient.request('SET_ACTIVITY', {
      pid: process.pid,
      activity: rawActivity,
    }).catch(() => {});
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

  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) {
      if (win.isFocused()) {
        win.hide();
      } else {
        win.focus();
      }
    } else {
      win.show();
      win.focus();
    }
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

ipcMain.on('sc:player-state', (_e, { track, isPlaying, currentTime = 0, duration = 0, friendCode, shareDiscordFriendCode }) => {
  if (updateTrayFn) {
    updateTrayFn(track, isPlaying);
  }
  updateDiscordRPC(track, isPlaying, currentTime, duration, friendCode, shareDiscordFriendCode);

  if (track && track.id !== lastNotifiedTrackId && isPlaying) {
    lastNotifiedTrackId = track.id;
    notifyTrack(track);
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

app.whenReady().then(async () => {
  // quit() above is asynchronous; bail out before creating a second window.
  if (!gotLock) return;

  // Initialize Proxy Manager & Regional Bypass routing
  try {
    await proxyManager.init(app, session);
  } catch (err) {
    console.log('[ProxyManager] Init error:', err.message);
  }

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
    initAutoUpdater(win, isDev);
  } catch (err) {
    console.log('[AutoUpdater] Initialization failed:', err.message);
  }

  // Initialize Desktop features
  updateTrayFn = initTray();
  initDiscordRPC();

  // Hardware media keys routed to the renderer.
  const keys = {
    MediaPlayPause: 'toggle',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
    MediaStop: 'stop',
  };
  for (const [accel, action] of Object.entries(keys)) {
    try {
      globalShortcut.register(accel, () => {
        if (win) win.webContents.send('media-command', action);
      });
    } catch {
      /* accelerator unavailable on this keyboard */
    }
  }

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