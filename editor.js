import { getFile, root, meta, save, mp4, writer, fmt } from './shared.js';
const $ = s => document.querySelector(s), v = $('#v');
const safe = s => s.replace(/[^\w -]+/g, '_');
const CLS = { 'Record over': 'b-orange', 'Re-record': 'b-orange', Remove: 'b-pink' };
const btn = (t, f) => Object.assign(document.createElement('button'), { textContent: t, onclick: f, className: CLS[t] || '' });
let E = null, muteStart = null;

function closeEditor() {
  if (!E) return; clearInterval(E.iv); v.pause(); Object.values(E.aud).forEach(a => a.pause());
  Object.values(E.urls).forEach(URL.revokeObjectURL); E = null; $('#editor').hidden = true;
}
async function edit(m) {
  closeEditor();
  const urls = {}; for (const [k, n] of Object.entries(m.tracks)) urls[k] = URL.createObjectURL(await getFile(n));
  E = { m, urls, dur: m.dur || 1, trim: [0, m.dur || 1], mutes: [], aud: {}, vol: +$('#volume').value };
  for (const k of ['mic', 'sys']) if (urls[k]) E.aud[k] = new Audio(urls[k]);
  v.src = urls.main; v.muted = true; $('#editor').hidden = false; muteStart = null;
  $('#title').textContent = m.title; document.title = 'Edit · ' + m.title;
  $('#micdl').hidden = !m.tracks.mic; $('#micdl').onclick = async () => save(await getFile(m.tracks.mic), safe(m.title) + ' mic.m4a');
  v.onloadedmetadata = () => { if (isFinite(v.duration) && v.duration > 0) { E.dur = v.duration; E.trim = [0, E.dur]; } render(); };
  E.iv = setInterval(tick, 80); render(); $('#editor').scrollIntoView();
}

const inMute = t => E.mutes.some(m => t >= m.s && t < m.e);
const voStep = (t, play, mu, el, vol = 1) => {
  el.volume = vol;
  const on = play && t >= mu.s && t < mu.e;
  if (on && el.paused) { el.currentTime = t - mu.s; el.play(); } else if (!on && !el.paused) el.pause();
};
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};
// The video element stays silent (the editor plays the separate mic/system tracks), so it has no native controls.
// Our own play and volume controls drive those tracks instead.
const setPlay = () => { $('#play').innerHTML = v.paused ? ICON.play : ICON.pause; $('#play').setAttribute('aria-label', v.paused ? 'Play' : 'Pause'); };
$('#play').onclick = v.onclick = () => v.paused ? v.play() : v.pause();
let lastVol = 1;
$('#volume').oninput = () => { const x = +$('#volume').value; if (E) E.vol = x; $('#vol').innerHTML = x ? ICON.vol : ICON.mute; };
$('#vol').onclick = () => { const i = $('#volume'); if (+i.value) { lastVol = +i.value; i.value = 0; } else i.value = lastVol; i.oninput(); };
setPlay(); $('#volume').oninput();
v.onplay = () => { setPlay(); E && Object.values(E.aud).forEach(a => a.play()); };
v.onpause = () => { setPlay(); E && Object.values(E.aud).forEach(a => a.pause()); };
v.onseeked = () => E && Object.values(E.aud).forEach(a => a.currentTime = v.currentTime);

function tick() {
  if (!E || E.exp) return;
  const t = v.currentTime, play = !v.paused;
  for (const a of Object.values(E.aud)) if (Math.abs(a.currentTime - t) > .5) a.currentTime = t;
  if (E.aud.mic) E.aud.mic.volume = inMute(t) ? 0 : E.vol;
  if (E.aud.sys) E.aud.sys.volume = E.vol;
  if (!E.rec) E.mutes.forEach(mu => mu.a && voStep(t, play, mu, mu.a, E.vol));
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
  let mic; try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1, sampleRate: 48000 } }); }
  catch (e) { return alert('Microphone unavailable: ' + e.message); }
  const r = new MediaRecorder(mic, { mimeType: mp4(true), audioBitsPerSecond: 192000 }), ch = [];
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
  const ac = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' }), dest = ac.createMediaStreamDestination();
  const wire = url => { const el = new Audio(url), g = ac.createGain(); ac.createMediaElementSource(el).connect(g).connect(dest); return [el, g]; };
  const tr = [E.urls.mic, E.urls.sys].filter(Boolean).map(wire), micG = E.urls.mic ? tr[0][1] : null;
  const vos = E.mutes.filter(x => x.vo).map(mu => [mu, wire(URL.createObjectURL(mu.vo))[0]]);
  const id = Date.now().toString(36), name = id + '.main.mp4', w = writer(name);
  const rc = new MediaRecorder(new MediaStream([...xv.captureStream().getVideoTracks(), ...dest.stream.getAudioTracks()]), { mimeType: mp4(), audioBitsPerSecond: 192000, videoBitsPerSecond: 8e6 });
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
    E.exp = false; xb.disabled = false; $('#prog').textContent = 'Done. Also saved to your library.';
    $('#dl').hidden = false; $('#dl').onclick = async () => save(await getFile(name), safe(m.title) + ' (edited).mp4');
  };
  const iv = setInterval(() => {
    const t = xv.currentTime;
    tr.forEach(([el]) => { if (Math.abs(el.currentTime - t) > .5) el.currentTime = t; });
    if (micG) micG.gain.value = inMute(t) ? 0 : 1;
    vos.forEach(([mu, el]) => voStep(t, true, mu, el));
    $('#prog').textContent = `Exporting ${fmt(t - a)} / ${fmt(b - a)}`;
    if (t >= b || xv.ended) fin();
  }, 20);
  rc.start(2000); await ac.resume();
  await Promise.all([xv.play(), ...tr.map(([el]) => el.play())]);
};

$('#close').onclick = () => window.close();
const id = new URLSearchParams(location.search).get('id');
chrome.storage.local.get('rec_' + id).then(r => r['rec_' + id] ? edit(r['rec_' + id]) : ($('#nf').hidden = false));
