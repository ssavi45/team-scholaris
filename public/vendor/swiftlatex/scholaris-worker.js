// Scholaris worker adapter, 2026-09-14. Upstream engine files are unmodified.
// Restrict package lookups; this worker receives source only, never Supabase credentials.
const packageOrigin = 'https://texlive.texlyre.org';
const NativeXHR = self.XMLHttpRequest;
class PackageRequest {
  constructor() { this.request = new NativeXHR(); }
  open(method, value, async = true) {
    const url = new URL(value, self.location.href);
    const engine = url.origin === self.location.origin && url.pathname.endsWith('/swiftlatexpdftex.wasm');
    const packageFile = url.origin === packageOrigin && /^\/pdftex\/(?:\d+|pk\/\d+)\/[A-Za-z0-9_.+-]{1,200}$/.test(url.pathname) && !url.search && !url.hash;
    if (method !== 'GET' || (!engine && !packageFile)) throw new Error('Unsupported compiler resource.');
    // Generated document files are local-only, never package-server lookups.
    this.missing = packageFile && /\.(aux|bbl|blg|log|toc|out|synctex|bib)$/.test(url.pathname);
    this.resourceName = url.pathname.split('/').pop();
    if (this.missing) return;
    this.url = packageFile ? url.href : null;
    this.cached = this.url ? packageCache.get(this.url) : null;
    if (this.cached) return;
    if (packageFile) self.postMessage({ cmd: 'package', name: url.pathname.split('/').pop() });
    this.request.open('GET', url.href, async);
  }
  reportFailure() { self.postMessage({ cmd: 'resource-error', name: this.resourceName }); }
  send() {
    if (this.missing || this.cached) return;
    try {
      this.request.send(null);
      if (this.url) rememberPackage(this.url, this.request);
      if (this.request.readyState === 4 && (this.request.status === 0 || this.request.status >= 500)) this.reportFailure();
    } catch (error) { this.reportFailure(); throw error; }
  }
  get status() { if (this.cached) return this.cached.status ?? 200; return this.missing || this.request.status === 404 ? 301 : this.request.status; }
  get response() { return this.cached?.body ?? this.request.response; }
  get responseText() { return this.request.responseText; }
  set responseType(value) { this.request.responseType = value; }
  set timeout(value) { this.request.timeout = Math.min(value, 15000); }
  set onload(value) { this.request.onload = (event) => { if (this.request.status === 0 || this.request.status >= 500) this.reportFailure(); if (typeof value === 'function') value.call(this.request, event); }; }
  set onerror(value) { this.request.onerror = (event) => { this.reportFailure(); if (typeof value === 'function') value.call(this.request, event); }; }
  getResponseHeader(name) { return this.cached ? this.cached[name.toLowerCase()] ?? null : this.request.getResponseHeader(name); }
}
self.XMLHttpRequest = PackageRequest;
// Load only public package responses; document source/output never enters this cache.
const packageCache = new Map();
let packageDatabase;
const cacheLimit = 64 * 1024 * 1024;
let cacheBytes = 0;
function loadPackageCache() {
  if (!self.indexedDB) return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const finish = () => { if (!finished) { finished = true; resolve(); } };
    const timer = setTimeout(finish, 1500);
    const request = self.indexedDB.open('scholaris-public-tex-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('packages', { keyPath: 'url' });
    request.onerror = request.onblocked = () => { clearTimeout(timer); finish(); };
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      packageDatabase = request.result;
      packageDatabase.onversionchange = () => { packageDatabase.close(); packageDatabase = null; };
      const transaction = packageDatabase.transaction('packages', 'readwrite');
      const cursor = transaction.objectStore('packages').openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) { clearTimeout(timer); finish(); return; }
        const value = item.value;
        if (Date.now() - value.time > (value.status === 301 ? 1 : 7) * 86400000 || !(value.body instanceof ArrayBuffer) || cacheBytes + value.body.byteLength > cacheLimit || packageCache.size >= 2048) item.delete();
        else { packageCache.set(value.url, value); cacheBytes += value.body.byteLength; }
        item.continue();
      };
      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); finish(); };
    };
  });
}
function rememberPackage(url, request) {
  const status = request.status === 404 ? 301 : request.status;
  const body = status === 301 ? new ArrayBuffer(0) : request.response;
  const fileid = request.getResponseHeader('fileid'), pkid = request.getResponseHeader('pkid');
  if (![200, 301].includes(status) || !(body instanceof ArrayBuffer) || body.byteLength > 32 * 1024 * 1024 || cacheBytes + body.byteLength > cacheLimit || packageCache.size >= 2048 || (status === 200 && !fileid && !pkid)) return;
  if (packageCache.has(url)) return;
  const value = { url, body, fileid, pkid, status, time: Date.now() };
  packageCache.set(url, value); cacheBytes += body.byteLength;
  try { packageDatabase?.transaction('packages', 'readwrite').objectStore('packages').put(value); } catch { /* Cache failure must not fail compilation. */ }
}
async function initializeEngine() {
await loadPackageCache().catch(() => {});
importScripts('./swiftlatexpdftex.js');
self.texlive_endpoint = `${packageOrigin}/`;
// Upstream invokes BibTeX after every successful LaTeX pass, including papers
// with no bibliography or an inline thebibliography. Inspect generated aux files
// (including include-chapter aux files) rather than guessing from source text.
const originalBibtex = self._compileBibtex;
let bibtexMemo = null, bibtexRuns = 0;
// Memoize only within one clean build. BibTeX reads citation/database/style
// directives from aux, plus bib/bst contents; labels/page numbers are irrelevant.
function bibliographyInputs() {
  const files = []; let bytes = 0;
  function visit(path) {
    for (const name of self.FS.readdir(path).filter(name => name !== '.' && name !== '..').sort()) {
      const full = `${path}/${name}`, stat = self.FS.stat(full);
      if (self.FS.isDir(stat.mode)) visit(full);
      else if (/\.(aux|bib|bst)$/.test(name)) {
        bytes += stat.size;
        if (bytes > 4 * 1024 * 1024) throw new Error('Bibliography inputs too large.');
        const text = self.FS.readFile(full, { encoding: 'utf8' });
        files.push([full, name.endsWith('.aux') ? [...text.matchAll(/\\(?:citation|bibdata|bibstyle|@input)\s*\{[^}]*\}/g)].map(match => match[0]) : text]);
      }
    }
  }
  try { visit('/work'); return JSON.stringify([self.mainfile, files]); } catch { return null; }
}
function bibliographyRequested() {
  const visited = new Set();
  function inspect(path) {
    if (visited.has(path)) return false;
    visited.add(path);
    // Fail open to BibTeX so incomplete/unreadable configurations retain errors.
    if (!/^[A-Za-z0-9_.\/-]+$/.test(path) || path.split('/').includes('..')) return true;
    let aux;
    try { aux = self.FS.readFile(`/work/${path}`, { encoding: 'utf8' }); }
    catch { return true; }
    if (/\\bib(?:data|style)\s*\{/.test(aux)) return true;
    return [...aux.matchAll(/\\@input\s*\{([^}]+)\}/g)].some(match => inspect(match[1]));
  }
  return inspect(self.mainfile.replace(/\.tex$/, '.aux'));
}
function conditionalBibtex(...args) {
  if (!bibliographyRequested()) return 0;
  const key = bibliographyInputs(), output = `/work/${self.mainfile.replace(/\.tex$/, '.bbl')}`;
  if (key !== null && bibtexMemo?.key === key) {
    try {
      if (self.FS.readFile(output, { encoding: 'utf8' }) === bibtexMemo.output) {
        self.memlog += bibtexMemo.log;
        return 0;
      }
    } catch { /* A missing/changed bbl must be regenerated. */ }
  }
  bibtexMemo = null;
  const logBefore = self.memlog;
  // Emscripten's lazy export replaces the global on its first invocation.
  try {
    bibtexRuns++;
    const result = originalBibtex(...args);
    if (result === 0 && key !== null && self.memlog.startsWith(logBefore)) {
      try {
        const text = self.FS.readFile(output, { encoding: 'utf8' });
        if (text.length <= 4 * 1024 * 1024) bibtexMemo = { key, output: text, log: self.memlog.slice(logBefore.length) };
      } catch { /* Preserve normal retry/error behavior. */ }
    }
    return result;
  }
  finally { self._compileBibtex = conditionalBibtex; }
}
self._compileBibtex = conditionalBibtex;
let boundedLog = self.memlog;
Object.defineProperty(self, 'memlog', { get: () => boundedLog, set: (value) => { boundedLog = String(value).slice(-150000); } });

// Snapshot only generated reference files. A changed aux/bbl/toc requires another pass.
function referenceState() {
  const files = [];
  let bytes = 0;
  function visit(path) {
    for (const name of self.FS.readdir(path).filter(name => name !== '.' && name !== '..').sort()) {
      const full = `${path}/${name}`, stat = self.FS.stat(full);
      if (self.FS.isDir(stat.mode)) visit(full);
      else if (/\.(aux|bbl|toc|out|lof|lot|nav|snm|vrb)$/.test(name)) {
        bytes += stat.size;
        if (bytes > 4 * 1024 * 1024) throw new Error('Reference state too large.');
        files.push([full, self.FS.readFile(full, { encoding: 'utf8' })]);
      }
    }
  }
  try { visit('/work'); return JSON.stringify(files); } catch { return null; }
}
const post = self.postMessage.bind(self), receive = self.onmessage;
let beforePass = null;
self.postMessage = (data, ...rest) => {
  if (data.cmd === 'compile' && data.result === 'ok') {
    data.bibtexRuns = bibtexRuns;
    const after = referenceState();
    data.needsRerun = beforePass === null || after === null || beforePass !== after || /Rerun to get|Label\(s\) may have changed|Please rerun|rerun LaTeX/i.test(data.log || '');
  }
  post(data, ...rest);
};
self.onmessage = event => {
  if (event.data.cmd === 'reset-workspace') {
    try {
      self.closeFSStreams();
      function remove(path) {
        for (const name of self.FS.readdir(path).filter(name => name !== '.' && name !== '..')) {
          const full = `${path}/${name}`;
          if (self.FS.isDir(self.FS.stat(full).mode)) { remove(full); self.FS.rmdir(full); }
          else self.FS.unlink(full);
        }
      }
      remove('/work');
      if (self.FS.readdir('/work').some(name => name !== '.' && name !== '..')) throw new Error('Workspace reset incomplete.');
      beforePass = null;
      bibtexMemo = null; bibtexRuns = 0;
      post({ cmd: 'reset-workspace', result: 'ok' });
    } catch { post({ cmd: 'reset-workspace', result: 'failed' }); }
    return;
  }
  if (event.data.cmd === 'compilelatex') beforePass = referenceState();
  receive(event);
};
}
void initializeEngine();
