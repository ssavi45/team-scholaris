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
    if (packageFile) self.postMessage({ cmd: 'package', name: url.pathname.split('/').pop() });
    this.request.open('GET', url.href, async);
  }
  reportFailure() { self.postMessage({ cmd: 'resource-error', name: this.resourceName }); }
  send() {
    if (this.missing) return;
    try {
      this.request.send(null);
      if (this.request.readyState === 4 && (this.request.status === 0 || this.request.status >= 500)) this.reportFailure();
    } catch (error) { this.reportFailure(); throw error; }
  }
  get status() { return this.missing || this.request.status === 404 ? 301 : this.request.status; }
  get response() { return this.request.response; }
  get responseText() { return this.request.responseText; }
  set responseType(value) { this.request.responseType = value; }
  set timeout(value) { this.request.timeout = Math.min(value, 15000); }
  set onload(value) { this.request.onload = (event) => { if (this.request.status === 0 || this.request.status >= 500) this.reportFailure(); if (typeof value === 'function') value.call(this.request, event); }; }
  set onerror(value) { this.request.onerror = (event) => { this.reportFailure(); if (typeof value === 'function') value.call(this.request, event); }; }
  getResponseHeader(name) { return this.request.getResponseHeader(name); }
}
self.XMLHttpRequest = PackageRequest;
importScripts('./swiftlatexpdftex.js');
self.texlive_endpoint = `${packageOrigin}/`;
// Upstream invokes BibTeX after every successful LaTeX pass, including papers
// with no bibliography or an inline thebibliography. Inspect generated aux files
// (including include-chapter aux files) rather than guessing from source text.
const originalBibtex = self._compileBibtex;
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
  // Emscripten's lazy export replaces the global on its first invocation.
  try { return originalBibtex(...args); }
  finally { self._compileBibtex = conditionalBibtex; }
}
self._compileBibtex = conditionalBibtex;
let boundedLog = self.memlog;
Object.defineProperty(self, 'memlog', { get: () => boundedLog, set: (value) => { boundedLog = String(value).slice(-150000); } });
