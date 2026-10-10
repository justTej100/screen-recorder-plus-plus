import { getFile, root, meta, save, mp4, writer, fmt } from './shared.js';
const $ = s => document.querySelector(s), v = $('#v');
const safe = s => s.replace(/[^\w -]+/g, '_');
const btn = (t, f) => Object.assign(document.createElement('button'), { textContent: t, onclick: f });
let E = null, muteStart = null;

async function list() {
  const box = $('#list'); box.textContent = '';
  const all = await meta.all();
  if (!all.length) box.innerHTML = '<p class="muted">Nothing recorded yet. Click the extension icon to record.</p>';
  for (const m of all) {
    let size = 0; try { size = (await getFile(m.tracks.main)).size; } catch {}
    const row = document.createElement('div'), info = document.createElement('div'), acts = document.createElement('div');
    row.className = 'row'; info.innerHTML = '<b></b><div class="muted"></div>';
    info.firstChild.textContent = m.title;
    info.lastChild.textContent = `${new Date(m.created).toLocaleString()} · ${m.dur ? fmt(m.dur) : 'length unknown'} · ${(size / 1e6).toFixed(1)} MB` + (m.status === 'recording' ? ' · recovered after interruption' : '');
    acts.append(btn('Edit', () => edit(m)), btn('Download MP4', async () => save(await getFile(m.tracks.main), safe(m.title) + '.mp4')));
    if (m.tracks.mic) acts.append(btn('Mic audio', async () => save(await getFile(m.tracks.mic), safe(m.title) + ' mic.m4a')));
    acts.append(btn('Delete', async () => {
      if (!confirm('Delete this recording from the browser? Download it first to keep it.')) return;
      const r = await root(); for (const n of Object.values(m.tracks)) await r.removeEntry(n).catch(() => {});
      await meta.del(m.id); if (E?.m.id === m.id) closeEditor(); list();
    }));
    row.append(info, acts); box.append(row);
  }
}

function closeEditor() {
  if (!E) return; clearInterval(E.iv); v.pause(); Object.values(E.aud).forEach(a => a.pause());
  Object.values(E.urls).forEach(URL.revokeObjectURL); E = null; $('#editor').hidden = true;
}
async function edit(m) {
  closeEditor();
  const urls = {}; for (const [k, n] of Object.entries(m.tracks)) urls[k] = URL.createObjectURL(await getFile(n));
  E = { m, urls, dur: m.dur || 1, trim: [0, m.dur || 1], mutes: [], aud: {} };
  for (const k of ['mic', 'sys']) if (urls[k]) E.aud[k] = new Audio(urls[k]);
  v.src = urls.main; v.muted = true; $('#editor').hidden = false; muteStart = null;
  v.onloadedmetadata = () => { if (isFinite(v.duration) && v.duration > 0) { E.dur = v.duration; E.trim = [0, E.dur]; } render(); };
  E.iv = setInterval(tick, 80); render(); $('#editor').scrollIntoView();
}

const inMute = t => E.mutes.some(m => t >= m.s && t < m.e);
const voStep = (t, play, mu, el) => {
  const on = play && t >= mu.s && t < mu.e;
  if (on && el.paused) { el.currentTime = t - mu.s; el.play(); } else if (!on && !el.paused) el.pause();
};
v.onvolumechange = () => { v.muted = true; };          // the original mixed audio is never played in the editor
v.onplay = () => E && Object.values(E.aud).forEach(a => a.play());
v.onpause = () => E && Object.values(E.aud).forEach(a => a.pause());
v.onseeked = () => E && Object.values(E.aud).forEach(a => a.currentTime = v.currentTime);

function tick() {
  if (!E || E.exp) return;
  const t = v.currentTime, play = !v.paused;
  for (const a of Object.values(E.aud)) if (Math.abs(a.currentTime - t) > .2) a.currentTime = t;
  if (E.aud.mic) E.aud.mic.volume = inMute(t) ? 0 : 1;
  if (!E.rec) E.mutes.forEach(mu => mu.a && voStep(t, play, mu, mu.a));
  if (E.rec && t >= E.rec.e) E.rec.stop(); else if (play && t >= E.trim[1]) v.pause();
  const h = $('#hd'); if (h) h.style.left = t / E.dur * 100 + '%';
  $('#clock').textContent = `${fmt(t)} / ${fmt(E.dur)}`;
}

function render() {
  const p = x => x / E.dur * 100 + '%';
  $('#tl').innerHTML = `<i class="trim" style="left:${p(E.trim[0])};width:${p(E.trim[1] - E.trim[0])}"></i>` +
    E.mutes.map(m => `<i class="mute${m.vo ? ' vo' : ''}" style="left:${p(m.s)};width:${p(m.e - m.s)}"></i>`).join('') + '<i class="head" id="hd"></i>';
  const box = $('#mutes'); box.textContent = '';
  E.mutes.forEach((mu, i) => {
    const d = document.createElement('div'), s = document.createElement('span'), a = document.createElement('div');
    d.className = 'row'; s.textContent = `Voice muted ${fmt(mu.s)} to ${fmt(mu.e)}` + (mu.vo ? ' · voiceover recorded' : '');
    a.append(btn(mu.vo ? 'Re-record' : 'Record over', () => recordOver(mu)), btn('Remove', () => { E.mutes.splice(i, 1); render(); }));
    d.append(s, a); box.append(d);
  });
  $('#trimInfo').textContent = `Keeping ${fmt(E.trim[0])} to ${fmt(E.trim[1])}`;
}
$('#tl').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); v.currentTime = (e.clientX - r.left) / r.width * E.dur; };
$('#setIn').onclick = () => { E.trim[0] = Math.min(v.currentTime, E.trim[1] - .1); render(); };
$('#setOut').onclick = () => { E.trim[1] = Math.max(v.currentTime, E.trim[0] + .1); render(); };
$('#reset').onclick = () => { E.trim = [0, E.dur]; render(); };
$('#muteBtn').onclick = () => {
  const t = v.currentTime, b = $('#muteBtn');
  if (muteStart === null) { muteStart = t; b.textContent = 'End mute here'; return; }
  if (t - muteStart > .2) E.mutes.push({ s: muteStart, e: t });
  E.mutes.sort((x, y) => x.s - y.s); muteStart = null; b.textContent = 'Mute my voice from here'; render();
};

async function recordOver(mu) {
  if (E.rec || E.exp) return;
  let mic; try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { return alert('Microphone unavailable: ' + e.message); }
  const r = new MediaRecorder(mic, { mimeType: mp4(true) }), ch = [];
  r.ondataavailable = e => ch.push(e.data);
  r.onstop = () => {
    mic.getTracks().forEach(t => t.stop()); v.pause();
    mu.vo = new Blob(ch, { type: 'audio/mp4' }); mu.a = new Audio(URL.createObjectURL(mu.vo));
    E.rec = null; $('#recbar').hidden = true; render();
  };
  E.rec = { e: mu.e, stop: () => r.state !== 'inactive' && r.stop() };
  $('#recbar').hidden = false; v.currentTime = mu.s; r.start(); await v.play();
}
$('#stopvo').onclick = () => E?.rec?.stop();

// Export: real-time render of trimmed video + mic (with muted ranges) + system audio + voiceovers
$('#export').onclick = async () => {
  if (!E || E.rec || E.exp) return;
  if (!mp4()) return alert('This browser can’t record MP4.');
  const [a, b] = E.trim, { m } = E, xv = $('#xv'), xb = $('#export');
  E.exp = true; xb.disabled = true; v.pause();
  xv.hidden = false; xv.muted = true; xv.src = E.urls.main; await new Promise(r => xv.onloadedmetadata = r);
  const ac = new AudioContext(), dest = ac.createMediaStreamDestination();
  const wire = url => { const el = new Audio(url), g = ac.createGain(); ac.createMediaElementSource(el).connect(g).connect(dest); return [el, g]; };
  const tr = [E.urls.mic, E.urls.sys].filter(Boolean).map(wire), micG = E.urls.mic ? tr[0][1] : null;
  const vos = E.mutes.filter(x => x.vo).map(mu => [mu, wire(URL.createObjectURL(mu.vo))[0]]);
  const id = Date.now().toString(36), name = id + '.main.mp4', w = writer(name);
  const rc = new MediaRecorder(new MediaStream([...xv.captureStream().getVideoTracks(), ...dest.stream.getAudioTracks()]), { mimeType: mp4() });
  rc.ondataavailable = e => e.data.size && w.write(e.data);
  const done = new Promise(r => rc.onstop = r);
  if (a > .05) { xv.currentTime = a; await new Promise(r => xv.onseeked = r); }
  tr.forEach(([el]) => el.currentTime = a);
  const fin = async () => {
    clearInterval(iv);
    [xv, ...tr.map(x => x[0]), ...vos.map(x => x[1])].forEach(e => e.pause());
    if (rc.state !== 'inactive') rc.stop(); await done; await w.close(); ac.close();
    xv.hidden = true; xv.removeAttribute('src');
    await meta.set({ id, title: m.title + ' (edited)', created: Date.now(), dur: b - a, status: 'done', tracks: { main: name } });
    E.exp = false; xb.disabled = false; $('#prog').textContent = 'Done. The edited video is in your library above.'; list();
  };
  const iv = setInterval(() => {
    const t = xv.currentTime;
    tr.forEach(([el]) => { if (Math.abs(el.currentTime - t) > .25) el.currentTime = t; });
    if (micG) micG.gain.value = inMute(t) ? 0 : 1;
    vos.forEach(([mu, el]) => voStep(t, true, mu, el));
    $('#prog').textContent = `Exporting ${fmt(t - a)} / ${fmt(b - a)}`;
    if (t >= b || xv.ended) fin();
  }, 20);
  rc.start(2000); await ac.resume();
  await Promise.all([xv.play(), ...tr.map(([el]) => el.play())]);
};

list();
