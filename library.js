// Library sidebar: view, download, edit (opens the editor in a new tab) and delete
import { getFile, root, meta, save, fmt } from './shared.js';
const safe = s => s.replace(/[^\w -]+/g, '_');
const CLS = { View: 'b-blue', Download: 'b-green', Edit: 'b-purple', Delete: 'b-pink' };
const btn = (t, f) => Object.assign(document.createElement('button'), { textContent: t, onclick: f, className: CLS[t] || '' });

export function initLibrary(box, activeId = () => null) {
  const dlg = document.querySelector('#view'), vv = dlg.querySelector('video');
  let n = 0;
  async function render() {
    const tok = ++n, all = await meta.all(), act = activeId(), frag = document.createDocumentFragment();
    if (!all.length) frag.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nothing recorded yet. Your recordings will show up here.' }));
    for (const m of all) {
      const item = document.createElement('div'), title = document.createElement('b'), sub = document.createElement('div');
      item.className = 'item'; sub.className = 'muted'; title.textContent = m.title; item.append(title, sub);
      if (m.id === act) { sub.textContent = 'Recording now…'; frag.append(item); continue; }
      let size = 0; try { size = (await getFile(m.tracks.main)).size; } catch {}
      sub.textContent = `${new Date(m.created).toLocaleString()} · ${m.dur ? fmt(m.dur) : 'length unknown'} · ${(size / 1e6).toFixed(1)} MB` + (m.status === 'recording' ? ' · recovered after interruption' : '');
      const acts = document.createElement('div'); acts.className = 'acts';
      acts.append(
        btn('View', async () => { vv.src = URL.createObjectURL(await getFile(m.tracks.main)); dlg.querySelector('h2').textContent = m.title; dlg.showModal(); vv.play().catch(() => {}); }),
        btn('Download', async () => save(await getFile(m.tracks.main), safe(m.title) + '.mp4')),
        btn('Edit', () => window.open('editor.html?id=' + encodeURIComponent(m.id), '_blank')),
        btn('Delete', async () => {
          if (!confirm('Delete this recording from the browser? Download it first to keep it.')) return;
          const r = await root(); for (const f of Object.values(m.tracks)) await r.removeEntry(f).catch(() => {});
          await meta.del(m.id);
        }));
      item.append(acts); frag.append(item);
    }
    if (tok === n) box.replaceChildren(frag);   // only the newest render wins, so quick changes never duplicate rows
  }
  dlg.querySelector('#closeview').onclick = () => dlg.close();
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  dlg.onclose = () => { vv.pause(); URL.revokeObjectURL(vv.src); vv.removeAttribute('src'); vv.load(); };
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && Object.keys(c).some(k => k.startsWith('rec_'))) render(); });
  render();
  return render;
}
