// Use the runner's Chrome and Node's CDP/WebSocket support; no npm dependencies.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('site');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png'};
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, '.' + (new URL(request.url, 'http://local').pathname === '/' ? '/index.html' : new URL(request.url, 'http://local').pathname));
    if (!path.startsWith(root + '/')) throw Error('Invalid path');
    response.setHeader('Content-Type', types[extname(path)] || 'text/plain');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
server.listen(8767, '127.0.0.1');
await once(server, 'listening');
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9222', '--user-data-dir=/tmp/sailfish-gnome-site-chrome', 'about:blank'], {stdio: 'ignore'});
let socket;
try {
  let tabs;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { tabs = await (await fetch('http://127.0.0.1:9222/json')).json(); break; }
    catch { await new Promise(done => setTimeout(done, 100)); }
  }
  assert(tabs?.length, 'Chrome did not start');
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0, loaded, fixture = {status: 404, body: {}};
  const pending = new Map();
  const call = (method, params = {}) => new Promise((ok, fail) => {
    pending.set(++id, {ok, fail}); socket.send(JSON.stringify({id, method, params}));
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id); pending.delete(message.id);
      if (message.error) entry.fail(Error(JSON.stringify(message.error))); else entry.ok(message.result);
    } else if (message.method === 'Page.loadEventFired') loaded?.();
    else if (message.method === 'Fetch.requestPaused') {
      call('Fetch.fulfillRequest', {requestId: message.params.requestId, responseCode: fixture.status,
        responseHeaders: [{name: 'Content-Type', value: 'application/json'}, {name: 'Access-Control-Allow-Origin', value: '*'}],
        body: Buffer.from(JSON.stringify(fixture.body)).toString('base64')}).catch(error => { throw error; });
    }
  });
  await call('Page.enable');
  await call('Fetch.enable', {patterns: [{urlPattern: 'https://api.github.com/*'}]});
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const navigate = async () => {
    const ready = new Promise(done => { loaded = done; });
    await call('Page.navigate', {url: 'http://127.0.0.1:8767/'});
    await Promise.race([ready, new Promise((_, fail) => setTimeout(() => fail(Error('Page load timed out')), 15000))]);
    await evaluate('new Promise(done => setTimeout(done, 300))');
  };
  await mkdir('site-preview', {recursive: true});
  for (const [name, width, height] of [['desktop', 1440, 1020], ['mobile', 390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await navigate();
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, `${name}: horizontal overflow`);
    await evaluate('Promise.all([...document.images].map(image => { image.loading = "eager"; return image.complete ? Promise.resolve() : new Promise(done => { image.onload = done; image.onerror = done; }); }))');
    assert.equal(await evaluate('[...document.images].every(image => image.complete && image.naturalWidth > 0)'), true, `${name}: broken image`);
    assert.equal(await evaluate('[...document.links].filter(link => link.getAttribute("href").startsWith("#")).every(link => document.getElementById(link.hash.slice(1)))'), true, 'Broken section link');
    const {cssContentSize} = await call('Page.getLayoutMetrics');
    const shot = await call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true,
      clip: {x: 0, y: 0, width, height: cssContentSize.height, scale: 1}});
    await writeFile(`site-preview/${name}.png`, Buffer.from(shot.data, 'base64'));
  }
  const names = ['sailfish-gnome-0.1.0-1.sfos5.1.0.11.aarch64.rpm', 'sailfish-gnome-devel-0.1.0-1.sfos5.1.0.11.aarch64.rpm', 'sailfish-gnome-0.1.0-sfos5.1.0.11-aarch64.tar.gz', 'sailfish-gnome-0.1.0-sfos5.1.0.11-aarch64-sources.tar.xz', 'SHA256SUMS', 'sailfish-gnome.lock'];
  fixture = {status: 200, body: {tag_name: 'v0.1.0', assets: names.map(name => ({name, browser_download_url: `https://github.com/trufae/sailfishos-gnome/releases/download/v0.1.0/${name}`}))}};
  await navigate();
  assert.equal(await evaluate('document.querySelectorAll("#release-assets a").length'), 6, 'Missing release links');
  fixture = {status: 403, body: {}};
  await navigate();
  assert.match(await evaluate('document.getElementById("release-status").textContent'), /could not be loaded/);
  console.log('Desktop/mobile layout, local assets, section links, downloads and API failure handling passed.');
} finally {
  socket?.close(); chrome.kill(); server.close();
}
