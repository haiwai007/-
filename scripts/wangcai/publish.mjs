import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// 把抓取好的旺财模板直接发布到生产 D1 + R2(绕过后台登录,使用 Wrangler 凭据)。
const arg = (n, d = '') => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);
const MANIFEST = arg('manifest', 'out/deliver/manifest.json');
const DIR = arg('dir', 'out/templates');
const THUMBS = arg('thumbs', 'out/deliver/thumbs');
const DB = arg('db', 'haishen-catalog');
const BUCKET = arg('bucket', 'haishen-template-files');
const WRANGLER = arg('wrangler', 'node_modules/wrangler/bin/wrangler.js');
const CONCURRENCY = Number(arg('concurrency', '8')) || 8;
const DRY = flag('dry-run');
const SKIP_OBJECTS = flag('skip-objects');
const SKIP_DB = flag('skip-db');
const ONLY = arg('only', '');

const CATEGORY_ORDER = ['yinhang', 'wangluoqianbao', 'jiamihuobi', 'haiwaiyinhang', 'liaotian', 'gubiao', 'jipiao', 'zhengjian', 'zhongguo'];
const CATEGORY_POSITION_BASE = 100;

function run(args, { silent = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${args[0]} ${args[1] || ''} 退出码 ${code}: ${(err || out).slice(-300)}`));
    });
  });
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).filter((m) => !ONLY || m.key === ONLY);
console.log(`发布 ${manifest.length} 套模板到 ${DB} / ${BUCKET}`);

// 稳定排序:先按分类顺序,再按分组、标题
const catIndex = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
const sorted = [...manifest].sort((a, b) =>
  (catIndex.has(a.category) ? catIndex.get(a.category) : 99) - (catIndex.has(b.category) ? catIndex.get(b.category) : 99)
  || String(a.group).localeCompare(String(b.group), 'zh')
  || String(a.name).localeCompare(String(b.name), 'zh'));

const rows = sorted.map((item, i) => ({
  ...item,
  id: crypto.randomUUID(),
  position: (catIndex.has(item.category) ? catIndex.get(item.category) : 99) * 10000 + i,
}));

const sqlDate = (d) => `'${d}'`;
const esc = (s) => String(s).replace(/'/g, "''");

const usedCats = [...new Set(rows.map((r) => r.category))].sort((a, b) => catIndex.get(a) - catIndex.get(b));
const lines = ['PRAGMA foreign_keys=ON;'];
const now = Date.now();
for (const id of usedCats) {
  const label = rows.find((r) => r.category === id).categoryLabel;
  const pos = CATEGORY_POSITION_BASE + catIndex.get(id);
  lines.push(`INSERT OR IGNORE INTO cms_categories(id,label,position,visible,revision,created_at,updated_at) VALUES('${esc(id)}','${esc(label)}',${pos},1,1,${now},${now});`);
}
for (const r of rows) {
  lines.push(
    `INSERT INTO cms_templates(id,name,category,description,tags,position,published,revision,width,height,parameter_count,package_key,thumbnail_key,created_at,updated_at) VALUES(` +
    `'${r.id}','${esc(r.name)}','${esc(r.category)}','${esc('来源分组：' + (r.group || '旺财作图'))}','${esc(JSON.stringify(['旺财', r.categoryLabel]))}',${r.position},1,1,` +
    `${r.width},${r.height},${r.parameters},'templates/${r.id}/package.json','templates/${r.id}/thumbnail.png',${now},${now});`);
}
const sql = lines.join('\n');
fs.writeFileSync('out/publish.sql', sql);
console.log('SQL 语句:', lines.length - 1, '→ out/publish.sql');
fs.writeFileSync('out/publish-ids.json', JSON.stringify(rows.map((r) => ({ key: r.key, id: r.id, name: r.name, category: r.category, position: r.position, package_key: `templates/${r.id}/package.json`, thumbnail_key: `templates/${r.id}/thumbnail.png` })), null, 1));

if (DRY) { console.log('[dry-run] 未上传对象、未执行 SQL'); process.exit(0); }

if (!SKIP_OBJECTS) {
  const jobs = [];
  for (const r of rows) {
    jobs.push({ file: path.join(DIR, r.file), key: `templates/${r.id}/package.json`, type: 'application/json' });
    jobs.push({ file: path.join(THUMBS, r.thumb), key: `templates/${r.id}/thumbnail.png`, type: 'image/png' });
  }
  console.log('待上传对象:', jobs.length);
  let index = 0, failed = [];
  const worker = async () => {
    while (index < jobs.length) {
      const job = jobs[index++];
      const n = index;
      if (!fs.existsSync(job.file)) { failed.push(job.key + ' 文件缺失'); continue; }
      try {
        await run(['r2', 'object', 'put', `${BUCKET}/${job.key}`, `--file=${job.file}`, `--content-type=${job.type}`, '--remote']);
        if (n % 20 === 0 || n === jobs.length) console.log(`  对象 ${n}/${jobs.length}`);
      } catch (error) {
        failed.push(job.key + ' ' + error.message);
        console.log('  上传失败', job.key, error.message.slice(0, 120));
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('对象上传完成,失败', failed.length);
  if (failed.length) fs.writeFileSync('out/publish-object-failures.txt', failed.join('\n'));
}

if (!SKIP_DB) {
  console.log('执行 SQL...');
  const out = await run(['d1', 'execute', DB, '--remote', '--file=out/publish.sql']);
  console.log(out.split('\n').filter((l) => /rows_written|executed|changes|error/i.test(l)).slice(0, 8).join('\n') || 'SQL 执行完成');
}
console.log('完成');
