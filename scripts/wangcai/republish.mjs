import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// 用修正后的模板覆盖已发布的对象,并更新数据库行(不新增记录)。
// 依赖 publish.mjs 首次发布时生成的 out/publish-ids.json。
const arg = (n, d = '') => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);
const IDS = arg('ids', 'out/publish-ids.json');
const MANIFEST = arg('manifest', 'out/deliver/manifest.json');
const DIR = arg('dir', 'out/templates');
const THUMBS = arg('thumbs', 'out/deliver/thumbs');
const DB = arg('db', 'haishen-catalog');
const BUCKET = arg('bucket', 'haishen-template-files');
const WRANGLER = arg('wrangler', fs.existsSync('node_modules/wrangler/bin/wrangler.js') ? 'node_modules/wrangler/bin/wrangler.js' : '');
const CONCURRENCY = Number(arg('concurrency', '8')) || 8;
const DRY = flag('dry-run');

function run(args) {
  return new Promise((resolve, reject) => {
    const command = WRANGLER ? process.execPath : 'npx';
    const argv = WRANGLER ? [WRANGLER, ...args] : ['--yes', 'wrangler@4', ...args];
    const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], shell: !WRANGLER });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${args.join(' ')} 退出码 ${code}: ${(err || out).slice(-200)}`))));
  });
}

const ids = JSON.parse(fs.readFileSync(IDS, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const byKey = new Map(manifest.map((m) => [m.key, m]));
const rows = ids.map((r) => ({ ...r, m: byKey.get(r.key) })).filter((r) => r.m);
console.log(`覆盖发布 ${rows.length} 套模板(对象 key 与数据库 id 不变)`);

const jobs = [];
for (const r of rows) {
  jobs.push({ file: path.join(DIR, r.m.file), key: r.package_key, type: 'application/json' });
  jobs.push({ file: path.join(THUMBS, r.m.thumb), key: r.thumbnail_key, type: 'image/png' });
}
console.log('待覆盖对象:', jobs.length);

if (!DRY) {
  let index = 0; const failed = [];
  const worker = async () => {
    while (index < jobs.length) {
      const job = jobs[index++]; const n = index;
      if (!fs.existsSync(job.file)) { failed.push(job.key + ' 文件缺失'); continue; }
      try {
        await run(['r2', 'object', 'put', `${BUCKET}/${job.key}`, `--file=${job.file}`, `--content-type=${job.type}`, '--remote']);
        if (n % 40 === 0 || n === jobs.length) console.log(`  对象 ${n}/${jobs.length}`);
      } catch (error) { failed.push(job.key + ' ' + error.message); console.log('  失败', job.key, error.message.slice(0, 120)); }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('对象覆盖完成,失败', failed.length);
  if (failed.length) fs.writeFileSync('out/republish-failures.txt', failed.join('\n'));
}

const now = Date.now();
const lines = ['PRAGMA foreign_keys=ON;'];
for (const r of rows) {
  lines.push(`UPDATE cms_templates SET width=${r.m.width},height=${r.m.height},parameter_count=${r.m.parameters},name='${String(r.m.name).replace(/'/g, "''")}',updated_at=${now},revision=revision+1 WHERE id='${r.id}';`);
}
fs.writeFileSync('out/republish.sql', lines.join('\n'));
if (!DRY) {
  console.log('更新数据库行...');
  const out = await run(['d1', 'execute', DB, '--remote', '--file=out/republish.sql']);
  console.log(out.split('\n').filter((l) => /rows_written|executed|changes|error/i.test(l)).slice(0, 6).join('\n') || 'SQL 执行完成');
}
console.log('完成');
