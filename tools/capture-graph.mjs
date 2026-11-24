/**
 * Headless capture of the Code Explorer UI.
 * Waits for #root [data-graph-ready="true"] / window.__codeVizReady, then
 * writes a PNG. Compare errors, an empty graph, and timeouts exit non-zero
 * and do not write an image.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const READY_EXPR = `(() => {
  const root = document.getElementById('root');
  const status = window.__codeVizStatus || null;
  return {
    ready: root?.getAttribute('data-graph-ready') === 'true' && window.__codeVizReady === true,
    state: root?.getAttribute('data-graph-state') || status?.state || null,
    reason: root?.getAttribute('data-graph-reason') || status?.reason || null,
  };
})()`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

export function findChrome(explicit) {
  const list = explicit ? [explicit] : CHROME_CANDIDATES;
  for (const bin of list) {
    if (bin.includes(path.sep) && fs.existsSync(bin)) return bin;
    const found = which(bin);
    if (found) return found;
  }
  return null;
}

function which(cmd) {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, cmd);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch { /* next */ }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpJson(method, url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode || 0, body: text ? JSON.parse(text) : null });
        } catch {
          reject(new Error(`Chrome DevTools returned non-JSON (${res.statusCode}): ${text.slice(0, 180)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Minimal WebSocket client (Node 18 has no global WebSocket).
 * CDP payloads are JSON text frames; screenshots can exceed 64KiB.
 */
function connectWebSocket(wsUrl) {
  const url = new URL(wsUrl);
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(Number(url.port) || 80, url.hostname);
    const pending = new Map();
    let nextId = 1;
    let buf = Buffer.alloc(0);
    let handshake = false;
    let settled = false;

    const fail = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
      socket.destroy();
    };

    socket.on('error', fail);
    socket.on('connect', () => {
      const reqPath = `${url.pathname}${url.search}`;
      socket.write(
        `GET ${reqPath} HTTP/1.1\r\n` +
        `Host: ${url.host}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Origin: http://${url.host}\r\n\r\n`,
      );
    });

    function sendFrame(opcode, payload) {
      const mask = crypto.randomBytes(4);
      const len = payload.length;
      const head = [0x80 | opcode];
      if (len < 126) head.push(0x80 | len);
      else if (len < 65536) head.push(0x80 | 126, (len >> 8) & 0xff, len & 0xff);
      else {
        const big = Buffer.alloc(8);
        big.writeBigUInt64BE(BigInt(len));
        head.push(0x80 | 127, ...big);
      }
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
      socket.write(Buffer.concat([Buffer.from(head), mask, masked]));
    }

    function send(obj) {
      sendFrame(0x1, Buffer.from(JSON.stringify(obj)));
    }

    function call(method, params) {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        send({ id, method, params: params || {} });
      });
    }

    let fragments = [];
    let fragOp = 0;

    function onMessage(text) {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const waiter = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) waiter.rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else waiter.res(msg.result);
      }
    }

    function consumeFrames() {
      while (buf.length >= 2) {
        const b0 = buf[0];
        const b1 = buf[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < offset + 2) return;
          len = buf.readUInt16BE(offset);
          offset += 2;
        } else if (len === 127) {
          if (buf.length < offset + 8) return;
          const big = buf.readBigUInt64BE(offset);
          if (big > BigInt(64 * 1024 * 1024)) throw new Error('DevTools frame too large');
          len = Number(big);
          offset += 8;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + len) return;
        let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
        if (masked) {
          const mask = buf.subarray(offset, offset + 4);
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        buf = buf.subarray(offset + maskLen + len);
        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          sendFrame(0xA, payload);
          continue;
        }
        if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
          const op = opcode === 0x0 ? fragOp : opcode;
          if (opcode !== 0x0) {
            fragments = [payload];
            fragOp = opcode;
          } else fragments.push(payload);
          if (fin) {
            const full = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
            fragments = [];
            if (op === 0x1) onMessage(full.toString('utf8'));
          }
        }
      }
    }

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        if (!handshake) {
          const end = buf.indexOf('\r\n\r\n');
          if (end < 0) return;
          const head = buf.subarray(0, end).toString('utf8');
          if (!/ 101 /.test(head.split('\r\n')[0] || '')) {
            fail(new Error(`WebSocket upgrade failed: ${head.split('\r\n')[0]}`));
            return;
          }
          handshake = true;
          buf = buf.subarray(end + 4);
          if (!settled) {
            settled = true;
            resolve({
              call,
              close: () => socket.end(),
            });
          }
        }
        consumeFrames();
      } catch (err) {
        fail(err);
      }
    });
  });
}

async function waitForDevtoolsPort(userDataDir, timeoutMs) {
  const file = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').trim().split('\n');
      const port = Number(text[0]);
      if (port > 0) return port;
    }
    await sleep(50);
  }
  throw new Error('Chrome did not open a DevTools port');
}

async function openPage(port, url) {
  const endpoint = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`;
  let lastErr = null;
  for (const method of ['PUT', 'GET']) {
    try {
      const res = await httpJson(method, endpoint);
      if (res.body?.webSocketDebuggerUrl) return res.body;
      lastErr = new Error(`DevTools ${method} /json/new returned no page socket`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not open a page target');
}

function terminalFailure(status) {
  if (!status) return null;
  if (status.state === 'compare-error') {
    const why = status.reason || 'branch diff failed';
    return why.startsWith('Compare not loaded:') ? why : `Compare not loaded: ${why}`;
  }
  if (status.state === 'empty') {
    if (!status.reason || status.reason === 'No files in graph') return 'No files in graph';
    return status.reason.startsWith('Compare not loaded:')
      ? status.reason
      : `Compare not loaded: ${status.reason}`;
  }
  return null;
}

/**
 * @param {{ url: string, outPath: string, timeoutMs?: number, chromePath?: string }} opts
 * @returns {Promise<{ ok: true, out: string, state: string } | { ok: false, error: string, state: string|null, reason: string|null }>}
 */
export async function captureGraph(opts) {
  const url = opts.url;
  const outPath = opts.outPath;
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 45_000;
  if (!url) return { ok: false, error: 'Missing --url', state: null, reason: null };
  if (!outPath) return { ok: false, error: 'Missing --out', state: null, reason: null };

  const chrome = findChrome(opts.chromePath);
  if (!chrome) {
    return {
      ok: false,
      error: 'No Chrome/Chromium binary found. Set CHROME_PATH or install google-chrome.',
      state: null,
      reason: null,
    };
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-explorer-shot-'));
  const chromeProc = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore', detached: true });

  let page = null;
  let result;
  try {
    const port = await waitForDevtoolsPort(userDataDir, Math.min(timeoutMs, 15_000));
    const target = await openPage(port, url);
    page = await connectWebSocket(target.webSocketDebuggerUrl);
    await page.call('Page.enable');
    await page.call('Runtime.enable');
    try {
      await page.call('Page.navigate', { url });
    } catch { /* /json/new already navigated */ }

    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const evaluated = await page.call('Runtime.evaluate', {
        expression: READY_EXPR,
        returnByValue: true,
      });
      last = evaluated?.result?.value || null;
      if (last?.ready) {
        const shot = await page.call('Page.captureScreenshot', { format: 'png' });
        const buf = Buffer.from(shot.data || '', 'base64');
        if (!buf.length) {
          return { ok: false, error: 'Screenshot payload was empty', state: last.state || null, reason: last.reason || null };
        }
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, buf);
        result = { ok: true, out: path.resolve(outPath), state: 'ready' };
        break;
      }
      const terminal = terminalFailure(last);
      if (terminal) {
        result = { ok: false, error: terminal, state: last.state, reason: last.reason || terminal };
        break;
      }
      await sleep(200);
    }
    result = result || {
      ok: false,
      error: `Timed out after ${timeoutMs}ms waiting for data-graph-ready="true"`,
      state: last?.state || null,
      reason: last?.reason || null,
    };
  } catch (err) {
    result = { ok: false, error: err.message || String(err), state: null, reason: null };
  } finally {
    try { page?.close(); } catch { /* ignore */ }
    try {
      if (chromeProc.pid) process.kill(-chromeProc.pid, 'SIGKILL');
    } catch {
      try { chromeProc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    for (let i = 0; i < 8; i++) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(50);
      }
    }
  }
  return result;
}
