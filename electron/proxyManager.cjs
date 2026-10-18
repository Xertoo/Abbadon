/**
 * Proxy Manager for Abbadon SoundCloud Client.
 *
 * Configures Chromium's native proxy engine directly via Electron session:
 * - Direct: Bypass proxy completely (default, fast, 100% reliable)
 * - System: Routes through Windows system proxy / active VPN (Cloudflare WARP, Proton, etc.)
 * - Local / Presets: Connects to local clients (Clash, v2rayN, Tor)
 * - Custom: User-defined HTTP, HTTPS, SOCKS5, or SOCKS4 proxy with authentication
 *
 * Uses Chromium's native networking stack - NO buggy local forwarders or SSL handshake corruption.
 */

const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const path = require('path');
const fs = require('fs');

/** Known SoundCloud client ID for testing API connectivity */
const KNOWN_CLIENT_ID = 'dkevB9EsY4jIoSm8RfddPNUKyn6hurXF';

const PRESETS = [
  {
    id: 'system',
    name: 'System / Active VPN',
    flag: '🛡️',
    description: 'Uses Windows system proxy or active VPN (Cloudflare WARP, Proton, etc.)',
    mode: 'system',
  },
  {
    id: 'clash',
    name: 'Clash / Mihomo',
    flag: '⚡',
    description: 'Local proxy on 127.0.0.1:7890 (HTTP/SOCKS5)',
    protocol: 'http',
    host: '127.0.0.1',
    port: 7890,
  },
  {
    id: 'v2ray',
    name: 'v2rayN / Xray',
    flag: '🚀',
    description: 'Local SOCKS5 on 127.0.0.1:10808',
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 10808,
  },
  {
    id: 'tor',
    name: 'Tor SOCKS5',
    flag: '🧅',
    description: 'Local Tor browser / service on 127.0.0.1:9050',
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 9050,
  },
];

class ProxyManager {
  constructor() {
    this.app = null;
    this.session = null;
    this.userDataPath = '';

    this.config = {
      enabled: false,
      mode: 'builtin', // 'builtin' | 'custom'
      preset: 'system', // 'system' | 'clash' | 'v2ray' | 'tor'
      customProtocol: 'http', // 'http' | 'https' | 'socks5' | 'socks4'
      customHost: '',
      customPort: '',
      customAuth: false,
      customUser: '',
      customPass: '',
      customUrl: '',
    };

    this.lastTestResult = null;
    this.status = 'disconnected'; // 'connected' | 'disconnected' | 'testing' | 'error'
  }

  async init(app, session) {
    this.app = app;
    this.session = session;
    this.userDataPath = app.getPath('userData');

    // Register Chromium proxy authentication handler
    app.on('login', (event, _webContents, _request, authInfo, callback) => {
      if (authInfo.isProxy) {
        event.preventDefault();
        if (
          this.config.enabled &&
          this.config.mode === 'custom' &&
          this.config.customAuth &&
          this.config.customUser
        ) {
          callback(this.config.customUser, this.config.customPass || '');
        } else {
          callback('', '');
        }
      }
    });

    // Read stored settings
    this.loadFromSettingsFile();

    // Apply or disable proxy
    if (this.config.enabled) {
      await this.applyCurrentProxy();
    } else {
      await this.disableProxy();
    }
  }

  loadFromSettingsFile() {
    try {
      const file = path.join(this.userDataPath, 'settings.json');
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(raw);
        if (data.proxy && typeof data.proxy === 'object') {
          this.config = { ...this.config, ...data.proxy };
        }
      }
    } catch (e) {
      console.log('[ProxyManager] Could not load settings:', e.message);
    }
  }

  saveToSettingsFile() {
    try {
      const file = path.join(this.userDataPath, 'settings.json');
      let data = {};
      try {
        if (fs.existsSync(file)) {
          data = JSON.parse(fs.readFileSync(file, 'utf8'));
        }
      } catch {}

      data.proxy = this.config;
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.log('[ProxyManager] Could not save settings:', e.message);
    }
  }

  getConfig() {
    return {
      config: { ...this.config },
      status: this.status,
      lastTestResult: this.lastTestResult,
      presets: PRESETS,
    };
  }

  async setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.saveToSettingsFile();
    if (this.config.enabled) {
      return await this.applyCurrentProxy();
    } else {
      return await this.disableProxy();
    }
  }

  async disableProxy() {
    this.status = 'disconnected';
    if (this.session) {
      try {
        await this.session.defaultSession.setProxy({ mode: 'direct' });
        await this.session.fromPartition('persist:soundcloud').setProxy({ mode: 'direct' });
      } catch (err) {
        console.log('[ProxyManager] Failed to set direct proxy:', err.message);
      }
    }
    return { ok: true, mode: 'direct', status: this.status };
  }

  async applyCurrentProxy() {
    if (!this.session) return { ok: false, error: 'Session not ready' };

    if (!this.config.enabled) {
      return await this.disableProxy();
    }

    try {
      if (this.config.mode === 'builtin') {
        const preset = PRESETS.find((p) => p.id === this.config.preset) || PRESETS[0];

        if (preset.mode === 'system') {
          // Native system / OS proxy mode (WARP, VPN, Windows system proxy)
          await this.session.defaultSession.setProxy({ mode: 'system' });
          await this.session.fromPartition('persist:soundcloud').setProxy({ mode: 'system' });
          this.status = 'connected';
          return { ok: true, status: this.status, mode: 'system' };
        }

        // Local preset (Clash, v2ray, Tor)
        const rule = `${preset.protocol}://${preset.host}:${preset.port}`;
        await this.session.defaultSession.setProxy({
          mode: 'fixed_servers',
          proxyRules: rule,
          proxyBypassRules: '<local>',
        });
        await this.session.fromPartition('persist:soundcloud').setProxy({
          mode: 'fixed_servers',
          proxyRules: rule,
          proxyBypassRules: '<local>',
        });
        this.status = 'connected';
        return { ok: true, status: this.status, rule };
      }

      // Custom Proxy mode
      let host = this.config.customHost?.trim();
      let port = this.config.customPort?.toString().trim();
      let protocol = (this.config.customProtocol || 'http').toLowerCase();

      if (this.config.customUrl && this.config.customUrl.trim()) {
        try {
          const raw = this.config.customUrl.trim();
          const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
          host = parsed.hostname;
          port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
          protocol = parsed.protocol.replace(':', '');
          if (parsed.username) {
            this.config.customAuth = true;
            this.config.customUser = decodeURIComponent(parsed.username);
            this.config.customPass = decodeURIComponent(parsed.password || '');
          }
        } catch {}
      }

      if (!host || !port) {
        this.status = 'error';
        return { ok: false, error: 'Please enter a valid proxy host and port' };
      }

      const rule = `${protocol}://${host}:${port}`;
      await this.session.defaultSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: rule,
        proxyBypassRules: '<local>',
      });
      await this.session.fromPartition('persist:soundcloud').setProxy({
        mode: 'fixed_servers',
        proxyRules: rule,
        proxyBypassRules: '<local>',
      });

      this.status = 'connected';
      return { ok: true, status: this.status, rule };
    } catch (err) {
      this.status = 'error';
      return { ok: false, error: err.message };
    }
  }

  /**
   * Diagnostic test for proxy connectivity to SoundCloud API
   */
  async testProxy(targetConfig) {
    const cfg = targetConfig || this.config;
    const mode = cfg.mode || 'builtin';

    if (mode === 'builtin') {
      const preset = PRESETS.find((p) => p.id === cfg.preset) || PRESETS[0];
      if (preset.mode === 'system') {
        return await this.testDirectOrSystem();
      }
      return await this.testProxyEndpoint(
        preset.protocol,
        preset.host,
        preset.port,
        false,
        '',
        ''
      );
    }

    // Custom proxy test
    const protocol = (cfg.customProtocol || 'http').toLowerCase();
    const host = (cfg.customHost || '').trim();
    const port = Number(cfg.customPort) || 0;

    if (!host || !port) {
      return { ok: false, message: 'Please enter a valid host and port.' };
    }

    return await this.testProxyEndpoint(
      protocol,
      host,
      port,
      cfg.customAuth,
      cfg.customUser,
      cfg.customPass
    );
  }

  async testDirectOrSystem() {
    const start = Date.now();
    try {
      const url = `https://api-v2.soundcloud.com/tracks/31419999?client_id=${KNOWN_CLIENT_ID}`;
      const res = await new Promise((resolve) => {
        const req = https.get(
          url,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Origin: 'https://soundcloud.com',
              Referer: 'https://soundcloud.com/',
            },
            timeout: 5000,
          },
          (r) => {
            let d = '';
            r.on('data', (c) => (d += c));
            r.on('end', () => resolve({ ok: r.statusCode === 200, status: r.statusCode, data: d }));
          }
        );
        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, error: 'Connection timed out' });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
      });

      const latency = Date.now() - start;
      if (res.ok) {
        // Look up public exit IP
        const ipInfo = await this.fetchIpInfo();
        const result = {
          ok: true,
          latency,
          ip: ipInfo.ip || 'Direct',
          country: ipInfo.country || 'Default',
          soundcloudOk: true,
          message: 'Connected to SoundCloud API successfully',
        };
        this.lastTestResult = result;
        return result;
      }

      return {
        ok: false,
        latency,
        message: res.error || `SoundCloud API returned status ${res.status}`,
      };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async testProxyEndpoint(protocol, host, port, auth, user, pass) {
    if (protocol === 'socks5' || protocol === 'socks4') {
      return await this.testSocks5(host, port, auth ? user : null, auth ? pass : null);
    }
    return await this.testHttpConnect(host, port, auth ? user : null, auth ? pass : null);
  }

  testHttpConnect(host, port, authUser, authPass) {
    return new Promise((resolve) => {
      const start = Date.now();
      const headers = { Host: 'api-v2.soundcloud.com:443' };
      if (authUser) {
        headers['Proxy-Authorization'] =
          'Basic ' + Buffer.from(authUser + ':' + (authPass || '')).toString('base64');
      }

      const req = http.request({
        host,
        port: Number(port),
        method: 'CONNECT',
        path: 'api-v2.soundcloud.com:443',
        headers,
        timeout: 4500,
      });

      req.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          resolve({
            ok: false,
            latency: Date.now() - start,
            message:
              res.statusCode === 407
                ? 'Proxy authentication required (407). Check your username & password.'
                : `Proxy refused connection with status ${res.statusCode}.`,
          });
          return;
        }

        const tlsSocket = tls.connect(
          {
            socket,
            servername: 'api-v2.soundcloud.com',
            timeout: 4500,
          },
          () => {
            const lat = Date.now() - start;
            tlsSocket.destroy();
            const result = {
              ok: true,
              latency: lat,
              soundcloudOk: true,
              ip: host,
              country: 'Proxy',
              message: 'TLS connection established to SoundCloud API',
            };
            resolve(result);
          }
        );

        tlsSocket.on('error', (err) => {
          resolve({ ok: false, latency: Date.now() - start, message: `TLS error: ${err.message}` });
        });
      });

      req.on('response', (res) => {
        resolve({
          ok: false,
          latency: Date.now() - start,
          message:
            res.statusCode === 407
              ? 'Proxy authentication required (407)'
              : `Proxy returned HTTP ${res.statusCode} instead of opening a tunnel.`,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, latency: 4500, message: 'Connection timed out (server unreachable)' });
      });

      req.on('error', (err) => {
        resolve({ ok: false, message: `Proxy error: ${err.message}` });
      });

      req.end();
    });
  }

  testSocks5(host, port, authUser, authPass) {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = net.connect(Number(port), host);
      socket.setTimeout(4500);

      socket.on('connect', () => {
        if (authUser) {
          socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
        } else {
          socket.write(Buffer.from([0x05, 0x01, 0x00]));
        }
      });

      let stage = 0;

      socket.on('data', (data) => {
        try {
          if (stage === 0) {
            if (data[0] !== 0x05) {
              socket.destroy();
              resolve({ ok: false, message: 'Invalid SOCKS5 response from proxy' });
              return;
            }
            const method = data[1];
            if (method === 0x02 && authUser) {
              const uLen = Buffer.byteLength(authUser);
              const pLen = Buffer.byteLength(authPass || '');
              const buf = Buffer.alloc(3 + uLen + pLen);
              buf[0] = 0x01;
              buf[1] = uLen;
              buf.write(authUser, 2, uLen);
              buf[2 + uLen] = pLen;
              buf.write(authPass || '', 3 + uLen, pLen);
              stage = 1;
              socket.write(buf);
              return;
            } else if (method === 0x00) {
              sendConnect();
            } else {
              socket.destroy();
              resolve({ ok: false, message: 'SOCKS5 authentication method rejected' });
              return;
            }
          } else if (stage === 1) {
            if (data[1] !== 0x00) {
              socket.destroy();
              resolve({ ok: false, message: 'SOCKS5 authentication failed (invalid credentials)' });
              return;
            }
            sendConnect();
          } else if (stage === 2) {
            if (data[1] !== 0x00) {
              socket.destroy();
              resolve({ ok: false, message: `SOCKS5 connect error code: ${data[1]}` });
              return;
            }

            const tlsSocket = tls.connect(
              {
                socket,
                servername: 'api-v2.soundcloud.com',
                timeout: 4500,
              },
              () => {
                const lat = Date.now() - start;
                tlsSocket.destroy();
                resolve({
                  ok: true,
                  latency: lat,
                  soundcloudOk: true,
                  ip: host,
                  country: 'SOCKS5',
                  message: 'SOCKS5 tunnel & TLS handshake to SoundCloud succeeded',
                });
              }
            );

            tlsSocket.on('error', (err) => {
              resolve({ ok: false, latency: Date.now() - start, message: `TLS error: ${err.message}` });
            });
          }
        } catch (e) {
          socket.destroy();
          resolve({ ok: false, message: e.message });
        }
      });

      function sendConnect() {
        stage = 2;
        const targetDomain = 'api-v2.soundcloud.com';
        const dLen = Buffer.byteLength(targetDomain);
        const reqBuf = Buffer.alloc(7 + dLen);
        reqBuf[0] = 0x05;
        reqBuf[1] = 0x01;
        reqBuf[2] = 0x00;
        reqBuf[3] = 0x03;
        reqBuf[4] = dLen;
        reqBuf.write(targetDomain, 5, dLen);
        reqBuf.writeUInt16BE(443, 5 + dLen);
        socket.write(reqBuf);
      }

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ ok: false, latency: 4500, message: 'SOCKS5 connection timed out' });
      });

      socket.on('error', (err) => {
        resolve({ ok: false, message: `SOCKS5 connection error: ${err.message}` });
      });
    });
  }

  fetchIpInfo() {
    return new Promise((resolve) => {
      https
        .get('https://api.ipify.org?format=json', { timeout: 3000 }, (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => {
            try {
              const j = JSON.parse(d);
              resolve({ ip: j.ip, country: 'Online' });
            } catch {
              resolve({});
            }
          });
        })
        .on('error', () => resolve({}));
    });
  }
}

const proxyManager = new ProxyManager();

module.exports = {
  proxyManager,
  PRESETS,
};
