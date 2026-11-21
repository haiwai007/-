#!/usr/bin/env node
/**
 * 把抓取转换好的旺财模板批量上传到海神作图后台并发布。
 *
 * 用法:
 *   node bulk-upload.mjs --base https://xiaohai.uk --user admin --password '...' \
 *        --dir ../../haishen-scrape/out/templates --thumbs ../../haishen-scrape/out/deliver/thumbs \
 *        --manifest ../../haishen-scrape/out/deliver/manifest.json [--limit 20] [--dry-run]
 *
 * 也可以只上传单个文件(会从 manifest 里查名字和分类):
 *   node bulk-upload.mjs ... --only gongshang__page6
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes('--' + name);

const BASE = (arg('base', 'https://xiaohai.uk')).replace(/\/+$/, '');
const USER = arg('user', 'admin');
const PASSWORD = arg('password', process.env.HAISHEN_ADMIN_PASSWORD || '');
const DIR = arg('dir', 'out/templates');
const THUMBS = arg('thumbs', 'out/deliver/thumbs');
const MANIFEST = arg('manifest', 'out/deliver/manifest.json');
const ONLY = arg('only', '');
const LIMIT = Number(arg('limit', '0')) || Infinity;
const DRY = flag('dry-run');
const PUBLISH = !flag('no-publish');

if (!PASSWORD && !DRY) {
  console.error('缺少管理员密码: --password 或环境变量 HAISHEN_ADMIN_PASSWORD');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = '';
async function api(pathname, { method = 'GET', json, form, csrf } = {}) {
  const headers = { Origin: BASE, Referer: BASE + '/admin' };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(BASE + '/api/' + pathname, { method, headers, body, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const message = payload && typeof payload === 'object' ? payload.error || payload.message || JSON.stringify(payload) : String(payload).slice(0, 200);
    const error = new Error(`${method} /api/${pathname} -> ${res.status} ${message}`);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const wanted = manifest.filter((m) => !ONLY || m.key === ONLY).slice(0, LIMIT);
console.log(`准备上传 ${wanted.length} 套模板到 ${BASE}`);

let csrf = '';
if (!DRY) {
  const session = await api('admin/login', { method: 'POST', json: { username: USER, password: PASSWORD } });
  csrf = session.csrf;
  console.log('登录成功');
}

const catalog = DRY ? { categories: [] } : await api('admin/catalog');
const haveCats = new Set((catalog.categories || []).map((c) => c.id));
const needed = [...new Set(wanted.map((m) => m.category))];
let position = 1000;
for (const id of needed) {
  if (haveCats.has(id)) continue;
  const label = wanted.find((m) => m.category === id).categoryLabel;
  if (DRY) { console.log('  [dry] 新建分类', id, label); continue; }
  await api('admin/categories', { method: 'POST', csrf, json: { id, label, position: position++, visible: true, revision: 0 } });
  console.log('  新建分类', id, label);
}

const report = { uploaded: [], published: [], failed: [] };
let index = 0;
for (const item of wanted) {
  index++;
  const tag = `[${index}/${wanted.length}] ${item.key}`;
  const file = path.join(DIR, item.file);
  const thumb = path.join(THUMBS, item.thumb);
  if (!fs.existsSync(file) || !fs.existsSync(thumb)) { console.log(tag, '跳过:文件缺失'); report.failed.push({ key: item.key, error: 'missing file' }); continue; }
  if (DRY) { console.log(tag, '(dry)', item.name, item.parameters + ' 参数'); continue; }
  try {
    const form = new FormData();
    form.set('file', new Blob([fs.readFileSync(file)], { type: 'application/json' }), item.file);
    form.set('thumbnail', new Blob([fs.readFileSync(thumb)], { type: 'image/png' }), 'thumbnail.png');
    form.set('name', item.name);
    form.set('category', item.category);
    form.set('description', `来源分组：${item.group || '旺财作图'}`);
    form.set('tags', JSON.stringify(['旺财', item.categoryLabel]));
    form.set('position', '0');
    const created = await api('admin/templates', { method: 'POST', csrf, form });
    report.uploaded.push({ key: item.key, id: created.id });
    let published = false;
    if (PUBLISH) {
      await api(`admin/templates/${created.id}`, {
        method: 'PUT', csrf,
        json: { name: item.name, category: item.category, description: `来源分组：${item.group || '旺财作图'}`, tags: ['旺财', item.categoryLabel], position: 0, published: true, revision: created.revision ?? 1 },
      });
      report.published.push(item.key);
      published = true;
    }
    console.log(tag, published ? '已发布' : '已存草稿', item.parameters + ' 参数');
  } catch (error) {
    console.log(tag, '失败:', error.message);
    report.failed.push({ key: item.key, error: error.message });
    if (error.status === 401 || error.status === 403) break;
  }
  await sleep(150);
}

fs.writeFileSync('bulk-upload-report.json', JSON.stringify(report, null, 1));
console.log(`\n完成:上传 ${report.uploaded.length},发布 ${report.published.length},失败 ${report.failed.length}`);
if (report.failed.length) console.log('失败明细见 bulk-upload-report.json');
