// Sidebar library: thumbnails, click one to view it; the ⋯ menu has View, Download, Edit and Delete
import { getFile, root, meta, save, fmt } from './shared.js';
const safe = s => s.replace(/[^\w -]+/g, '_');
const el = (tag, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
const DOTS = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const closeMenus = () => document.querySelectorAll('.menu').forEach(x => { x.hidden = true; });

async function thumb(m) {   // first frame of the recording, cached so it's only made once
  const key = 'thumb_' + m.id, got = (await chrome.storage.local.get(key))[key];
  if (got) return got;
  try {
    const url = URL.createObjectURL(await getFile(m.tracks.main));
    const v = Object.assign(document.createElement('video'), { muted: true, preload: 'auto', src: url });
    await Promise.race([new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; }), new Promise((_, no) => setTimeout(no, 5000))]);
    const c = Object.assign(document.createElement('canvas'), { width: 224, height: 128 }), g = c.getContext('2d');
    const k = Math.max(224 / v.videoWidth, 128 / v.videoHeight);
    g.drawImage(v, (224 - v.videoWidth * k) / 2, (128 - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k);
    URL.revokeObjectURL(url);
    const data = c.toDataURL('image/jpeg', .7); await chrome.storage.local.set({ [key]: data }); return data;
  } catch { return ''; }
}
async function remove(m) {
  const r = await root(); for (const f of Object.values(m.tracks)) await r.removeEntry(f).catch(() => {});
  await meta.del(m.id); await chrome.storage.local.remove('thumb_' + m.id);
}

export function initLibrary(box, activeId = () => null) {
  const dlg = document.querySelector('#view'), vv = dlg.querySelector('video');
  let n = 0;
  const view = async m => { vv.src = URL.createObjectURL(await getFile(m.tracks.main)); dlg.querySelector('h2').textContent = m.title; dlg.showModal(); vv.play().catch(() => {}); };

  async function render() {
    const tok = ++n, all = await meta.all(), act = activeId(), frag = document.createDocumentFragment();
    if (!all.length) frag.append(el('p', 'muted', 'Nothing recorded yet. Your recordings will show up here.'));
    for (const m of all) {
      const item = el('div', 'item'), info = el('div', 'info'), d = new Date(m.created), sub = el('span');
      const title = el('b', '', d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
      info.append(title, sub);
      if (m.id === act) { sub.textContent = 'Recording now…'; item.append(el('div', 'thumb'), info); frag.append(item); continue; }
      let size = 0; try { size = (await getFile(m.tracks.main)).size; } catch {}
      sub.textContent = `${(size / 1e6).toFixed(1)} MB · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` + (m.status === 'recording' ? ' · recovered' : '');
      const th = el('button', 'thumb'), img = el('img'), dur = el('span', 'dur', m.dur ? fmt(m.dur) : '–');
      img.alt = ''; th.title = 'View recording'; th.setAttribute('aria-label', 'View recording from ' + title.textContent);
      th.append(img, dur); th.onclick = () => view(m);
      thumb(m).then(src => { if (src) img.src = src; });
      const more = el('button', 'round'), menu = el('div', 'pop menu');
      more.innerHTML = DOTS; more.title = 'More'; more.setAttribute('aria-label', 'More options'); more.setAttribute('aria-haspopup', 'true'); menu.hidden = true;
      const add = (label, fn, cls = '') => { const b = el('button', cls, label); b.onclick = fn; menu.append(b); };
      add('View', () => view(m));
      add('Download', async () => save(await getFile(m.tracks.main), safe(m.title) + '.mp4'));
      add('Edit', () => window.open('editor.html?id=' + encodeURIComponent(m.id), '_blank'));
      add('Delete', async () => { if (confirm('Delete this recording from the browser? Download it first to keep it.')) await remove(m); }, 'danger');
      more.onclick = e => {
        e.stopPropagation(); const open = menu.hidden; closeMenus(); menu.hidden = !open;
        if (open) { const r = more.getBoundingClientRect(); menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px'; menu.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)) + 'px'; }
      };
      item.append(th, info, more, menu); frag.append(item);
    }
    if (tok === n) box.replaceChildren(frag);   // only the newest render wins, so quick changes never duplicate rows
  }

  const clear = document.querySelector('#clearAll');
  if (clear) clear.onclick = async () => {
    const act = activeId(), all = (await meta.all()).filter(m => m.id !== act);
    if (!all.length) return;
    if (!confirm(`Delete ${all.length} recording${all.length > 1 ? 's' : ''} from this browser? Download anything you want to keep first.`)) return;
    for (const m of all) await remove(m);
  };
  dlg.querySelector('#closeview').onclick = () => dlg.close();
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  dlg.onclose = () => { vv.pause(); URL.revokeObjectURL(vv.src); vv.removeAttribute('src'); vv.load(); };
  addEventListener('click', closeMenus);
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && Object.keys(c).some(k => k.startsWith('rec_'))) render(); });
  render();
  return render;
}
