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
    if (this.missing) return;
    if (packageFile) self.postMessage({ cmd: 'package', name: url.pathname.split('/').pop() });
    this.request.open('GET', url.href, async);
  }
  send() { if (!this.missing) this.request.send(null); }
  get status() { return this.missing || this.request.status === 404 ? 301 : this.request.status; }
  get response() { return this.request.response; }
  get responseText() { return this.request.responseText; }
  set responseType(value) { this.request.responseType = value; }
  set timeout(value) { this.request.timeout = Math.min(value, 15000); }
  set onload(value) { this.request.onload = value; }
  set onerror(value) { this.request.onerror = value; }
  getResponseHeader(name) { return this.request.getResponseHeader(name); }
}
self.XMLHttpRequest = PackageRequest;
importScripts('./swiftlatexpdftex.js');
self.texlive_endpoint = `${packageOrigin}/`;
let boundedLog = self.memlog;
Object.defineProperty(self, 'memlog', { get: () => boundedLog, set: (value) => { boundedLog = String(value).slice(-150000); } });
