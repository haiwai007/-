// Tiny CDP helper over the already-running Chrome (port 9222).
import fs from 'node:fs';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  let page = list.find(t => t.type === 'page');
  if (!page) {
    await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' });
    await sleep(500);
    const l2 = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    page = l2.find(t => t.type === 'page');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1; const pending = new Map();
  const events = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    events.push(m);
  };
  const send = (method, params) => new Promise((res, rej) => {
    const mid = id++;
    pending.set(mid, m => m.error ? rej(new Error(method + ' ' + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const close = () => { try { ws.close(); } catch {} };
  return { send, evaluate, events, close, ws };
}

export async function shot(cdp, file) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}

export async function fill(cdp, selector, value) {
  return cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
}

export async function clickText(cdp, text, tag = '*') {
  return cdp.evaluate(`(() => {
    const els = [...document.querySelectorAll('${tag}')].filter(e => (e.innerText||e.textContent||'').replace(/\\s+/g,'') === ${JSON.stringify(text.replace(/\s+/g, ''))});
    const el = els[els.length - 1] || [...document.querySelectorAll('${tag}')].find(e => (e.innerText||'').includes(${JSON.stringify(text)}));
    if (!el) return 'missing';
    el.click();
    return 'clicked:' + el.tagName + ':' + (el.innerText||'').slice(0,20);
  })()`);
}
