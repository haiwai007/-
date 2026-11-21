import { connect, sleep } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

// 重新抓取指定页面(用于修正被裁切或尺寸异常的模板)。
const OUT = process.argv[2] || 'out/templates';
const routes = process.argv.slice(3);
const SCALE = 3;

const cdp = await connect();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
const allw = fs.readFileSync('wc/allw.clean.json', 'utf8');
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
  localStorage.setItem('c9008d17682b448aaefbcb518c293a49', 'FAKETOKEN');
  localStorage.setItem('ad71074198ed4c319d00a6fdc4eef50e', String(Date.now()));
  localStorage.setItem('96eec3e6ed344143bec7a5c13ee76a37', ${JSON.stringify(allw)});
} catch (e) {} })();` });
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*wcztonline.com/tu/*', requestStage: 'Request' }] });
const CORS = [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: 'https://web.wcztonline.com' }, { name: 'access-control-allow-headers', value: 'authorization,content-type' }, { name: 'access-control-allow-methods', value: 'GET,POST,OPTIONS' }];
cdp.ws.addEventListener('message', async ev => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params; const u = request.url;
  if (/classMenu/.test(u)) { cdp.send('Fetch.continueRequest', { requestId }); return; }
  if (request.method === 'OPTIONS') { try { await cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS, body: '' }); } catch {} return; }
  let data = null;
  if (/7e1543c/.test(u)) data = { data: JSON.stringify({ expirationTime: '2099-01-01T00:00:00.000Z', userTypes: 1, type: 1, username: 'fake' }) };
  else if (/93cf4ce/.test(u)) data = { versionData: 'v1' };
  else if (/allw/.test(u)) data = JSON.parse(allw);
  else if (/pcMenuVersion/.test(u)) data = { menuVersion: 'preloaded', menuVersionText: 'fake' };
  const body = Buffer.from(JSON.stringify({ success: true, code: 200, msg: 'ok', data })).toString('base64');
  try { await cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: CORS, body }); } catch {}
});
await cdp.send('Page.navigate', { url: 'https://web.wcztonline.com/4dfe11ca03234c15accd895ab0d1b318.html' });
await sleep(12000);
const clickGroup = async (label) => cdp.evaluate(`(() => {
  const els=[...document.querySelectorAll('.itme')].filter(e=>(e.innerText||'').trim().startsWith(${JSON.stringify(label)}));
  if(!els.length) return 'nf';
  const r=els[0].getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
})()`);
let box = await clickGroup('回单');
if (box === 'nf') {
  await cdp.evaluate(`(()=>{const a=document.querySelector('#app'); if(a&&a.__vue_app__) a.__vue_app__.config.globalProperties.$router.push('/home'); return 1;})()`);
  await sleep(6000);
  box = await clickGroup('回单');
}
if (box !== 'nf') {
  const { x, y } = JSON.parse(box);
  for (const t of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 });
  await sleep(2500);
} else {
  console.log('warning: group list not found, continuing');
}
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }).catch(() => {});
await sleep(1200);

const EXTRACT = (route) => `(async () => {
  const app = document.querySelector('#app').__vue_app__;
  await app.config.globalProperties.$router.push(${JSON.stringify(route)});
  await new Promise(r => setTimeout(r, 2600));
  const pinia = app.config.globalProperties.$pinia.state.value;
  const ds = pinia.dataStores || {};
  let res = document.querySelector('.resizable-div');
  if (!res) return { err: 'no-preview' };
  // 灞曞紑琚鍒囩殑棰勮瀹瑰櫒,淇濊瘉鏁撮〉閮借鎴埌
  const expand = (el) => { for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) { if (n.scrollHeight > n.clientHeight + 4) { n.style.height = n.scrollHeight + 'px'; n.style.maxHeight = 'none'; n.style.overflow = 'visible'; } } };
  let rr = res.getBoundingClientRect();
  const clipped = [...res.querySelectorAll('*')].some(e => e.scrollHeight > e.clientHeight + 4);
  if (clipped) { expand(res); await new Promise(r => setTimeout(r, 900)); rr = res.getBoundingClientRect(); }
  const imgs = [...res.querySelectorAll('img')];
  await Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
  await new Promise(r => setTimeout(r, 400));
  const inPreview = (el) => { const r = el.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5 && r.x >= rr.x - 4 && r.right <= rr.right + 4 && r.y >= rr.y - 4 && r.bottom <= rr.bottom + 4; };
  const leaves = [...res.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() && inPreview(e));
  const fields = [];
  const seen = new Set();
  const norm = (s) => String(s).replace(/[\\s]+/g, '');
  for (const cfg of (ds.dataConfig || [])) {
    const val = (ds.data && ds.data[cfg.field] != null) ? String(ds.data[cfg.field]) : (cfg.value != null ? String(cfg.value) : '');
    if (!val || ['file', 'checkbox', 'radio', 'slider'].includes(cfg.type)) continue;
    const nv = norm(val);
    const score = (e) => {
      const t = (e.textContent || '').trim(); const nt = norm(t);
      if (t === val) return 100;
      if (nt === nv) return 95;
      if (nv.length >= 10 && /^\\d+$/.test(nv)) { for (const [p, s] of [[6,4],[4,3],[6,5],[4,4],[3,3]]) if (nv.length > p + s && nt.length > p + s && nt.startsWith(nv.slice(0,p)) && nt.endsWith(nv.slice(-s))) return 90; }
      if (/^\\d+(\\.\\d+)?$/.test(nv) && (nt.startsWith(nv + '.') || nt === Number(nv).toFixed(2))) return 88;
      if (nv.length >= 4 && nt.includes(nv) && nt.length - nv.length <= 6) return 70;
      return 0;
    };
    const cands = leaves.filter(e => !seen.has(e)).map(e => ({ e, s: score(e) })).filter(x => x.s > 0);
    if (!cands.length) continue;
    cands.sort((a, b) => b.s - a.s || (a.e.getBoundingClientRect().width * a.e.getBoundingClientRect().height) - (b.e.getBoundingClientRect().width * b.e.getBoundingClientRect().height));
    const el = cands[0].e; seen.add(el);
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    let bg = 'rgba(0, 0, 0, 0)';
    for (let p = el.parentElement; p && p !== res.parentElement; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; } }
    const hex = (c) => { const m = /rgba?\\((\\d+), ?(\\d+), ?(\\d+)/.exec(c); if (!m) return '#ffffff'; return '#' + [1,2,3].map(i => (+m[i]).toString(16).padStart(2,'0')).join(''); };
    fields.push({ field: cfg.field, title: cfg.title || cfg.placeholder || cfg.field, type: cfg.type || 'text', value: val, bgColor: hex(bg),
      x: +(r.x - rr.x).toFixed(2), y: +(r.y - rr.y).toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      fontSize: parseFloat(cs.fontSize), fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, color: cs.color, textAlign: cs.textAlign, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing });
  }
  return { w: +rr.width.toFixed(2), h: +rr.height.toFixed(2), x: +rr.x.toFixed(2), y: +rr.y.toFixed(2), fields, fieldCount: (ds.dataConfig || []).length, clipped };
})()`;

const catalog = JSON.parse(fs.readFileSync('wc/allw.clean.json', 'utf8'));
const jobs = [];
for (const g of catalog) for (const it of (g.itme || [])) if (it.url && it.url.startsWith('/images/pages/')) jobs.push({ route: it.url, group: g.title, title: it.title });

for (const route of routes) {
  const job = jobs.find((j) => j.route === route) || { route, group: '', title: route };
  const key = route.replace(/^\/images\/pages\//, '').replace(/\//g, '__');
  const info = await cdp.evaluate(EXTRACT(route), true);
  if (!info || info.err) { console.log('SKIP', route, info && info.err); continue; }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: info.x, y: info.y, width: info.w, height: info.h, scale: SCALE } });
  const png = Buffer.from(shot.data, 'base64');
  const assetId = 'asset_bg';
  const canvasW = Math.round(info.w * SCALE), canvasH = Math.round(info.h * SCALE);
  const layers = [{ id: 'bg', name: '鑳屾櫙', type: 'image', x: 0, y: 0, width: canvasW, height: canvasH, rotation: 0, opacity: 1, visible: true, locked: true, editable: true, groupId: null, layout: 'fixed',
    src: { kind: 'asset', assetId }, fit: 'cover', focusX: 0.5, focusY: 0.5, cropZoom: 1, radius: 0, lockAspect: false, autoFocus: false }];
  const params = [];
  let n = 0;
  for (const f of info.fields) {
    n++;
    const x = +(f.x * SCALE).toFixed(1), y = +(f.y * SCALE).toFixed(1), w = +(Math.max(f.w, 8) * SCALE).toFixed(1), h = +(Math.max(f.h, f.fontSize) * SCALE).toFixed(1);
    const pad = 2 * SCALE, textId = 'text_' + n;
    layers.push({ id: textId, name: f.title, type: 'text', x, y, width: w, height: h, rotation: 0, opacity: 1, visible: true, locked: false, editable: true, groupId: null, layout: 'relative',
      text: f.value, fontFamily: 'Noto Sans SC', fontSize: +(f.fontSize * SCALE).toFixed(1), fontWeight: /bold|[6-9]00/.test(String(f.fontWeight)) ? 'bold' : 'normal', fontStyle: 'normal',
      fill: f.color, textAlign: ['left', 'center', 'right'].includes(f.textAlign) ? f.textAlign : 'left', verticalAlign: 'middle', lineHeight: 1.2, letterSpacing: 0, wrap: false, autoShrink: true, autoGrow: false, minFontSize: 8, maxLines: 1, shadow: null });
    params.push({ id: 'param_' + n, name: f.title, type: f.type === 'date' ? 'date' : 'text', layerId: textId, property: 'text', defaultValue: f.value, required: false, editable: true, allowEmpty: true,
      rules: f.type === 'date' ? { datePrecision: 'minute' } : {}, group: '鍐呭', description: '', placeholder: '',
      cleanup: { mode: 'solid', color: f.bgColor || '#ffffff', src: null, follow: false, rect: { x: +(x - pad).toFixed(1), y: +(y - pad * 0.6).toFixed(1), width: +(w + pad * 2).toFixed(1), height: +(h + pad * 1.2).toFixed(1) } } });
  }
  const pkg = { format: 'caishen-template', formatVersion: 1, exportedAt: new Date().toISOString(),
    doc: { schemaVersion: 1, templateId: 'wc_' + key, name: (job.group ? job.group + ' - ' : '') + job.title, canvas: { width: canvasW, height: canvasH, backgroundColor: '#ffffff', backgroundImage: null }, layers, parameters: params, source: null },
    assets: [{ id: assetId, name: '鑳屾櫙', mime: 'image/png', width: canvasW, height: canvasH, data: png.toString('base64') }] };
  fs.writeFileSync(path.join(OUT, key + '.haishen.json'), JSON.stringify(pkg));
  console.log('閲嶆姄', key, `${canvasW}x${canvasH}`, 'fields=' + params.length + '/' + info.fieldCount, 'clipped=' + info.clipped);
}
cdp.close(); process.exit(0);


