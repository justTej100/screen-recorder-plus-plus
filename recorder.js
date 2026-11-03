import { writer, mp4, meta, fmt, root } from './shared.js';
import { initLibrary } from './library.js';
const $ = s => document.querySelector(s), say = t => $('#msg').textContent = t;
const PRE = { 'Clear voice': [-2, 3, 2, 90], Podcast: [3, 2, 1, 80], 'Reduce room': [-5, 1, 0, 120], Flat: [0, 0, 0, 60] };
const BANDS = ['low', 'mid', 'high'];
let filt, testChain = null, hpHz = 90, S = null;

const setFav = rec => {   // tab icon swaps to the recording version while recording
  const l = document.querySelector('link[rel=icon]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
  l.href = (rec ? 'icons/rec-32.png' : 'icons/icon-32.png') + '?v=3';
};
setFav(false);

$('#preset').innerHTML = Object.keys(PRE).map(k => `<option>${k}</option>`).join('');
const eq = () => [filt, testChain].forEach(f => f && BANDS.forEach(k => { f[k].gain.value = +$('#' + k).value; }));
$('#preset').onchange = () => {
  const p = PRE[$('#preset').value]; BANDS.forEach((k, i) => $('#' + k).value = p[i]);
  hpHz = p[3]; [filt, testChain].forEach(f => f && (f.hp.frequency.value = hpHz)); eq();
};
BANDS.forEach(k => $('#' + k).oninput = eq);
$('#preset').onchange();

// The mic processing chain (EQ + compressor). Used for recording and for the mic test, so they sound the same.
function makeChain(ctx) {
  const c = {
    hp: new BiquadFilterNode(ctx, { type: 'highpass', frequency: hpHz, Q: .7 }),
    low: new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 120 }),
    mid: new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2500, Q: 1 }),
    high: new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8000 }),
    comp: new DynamicsCompressorNode(ctx, { threshold: -24, ratio: 3, attack: .01, release: .25 })
  };
  c.hp.connect(c.low).connect(c.mid).connect(c.high).connect(c.comp);
  BANDS.forEach(k => { c[k].gain.value = +$('#' + k).value; });
  return c;
}

function buildAudio(ctx, mic, sysTracks) {
  const mix = ctx.createMediaStreamDestination(), out = { mix };
  if (mic) {
    const src = ctx.createMediaStreamSource(mic);
    filt = makeChain(ctx);
    out.an = new AnalyserNode(ctx, { fftSize: 1024 });
    src.connect(filt.hp); filt.comp.connect(out.an);
    out.an.connect(mix); out.mic = ctx.createMediaStreamDestination(); out.an.connect(out.mic);
    eq();
  }
  if (sysTracks.length) {
    const s = ctx.createMediaStreamSource(new MediaStream(sysTracks));
    s.connect(mix); out.sys = ctx.createMediaStreamDestination(); s.connect(out.sys);
  }
  return out;
}

// Elapsed time excludes paused time. The same numbers go to the on-screen bar (overlay.js) via storage.
const elapsed = () => S.accum + (S.paused ? 0 : (Date.now() - S.last) / 1000);
const publish = () => chrome.storage.local.set({ live: { status: S.paused ? 'paused' : 'recording', accum: S.accum, last: S.last, overlay: !!S.useOverlay, bubble: !!S.cam && (S.surface === 'browser' || S.surface === 'window') } });

$('#rec').onclick = start;
$('#pause').onclick = () => pause(!S.paused);
$('#stop').onclick = stop;
$('#cancel').onclick = () => confirm('Discard this recording? It can’t be recovered.') && cancel();
$('#restart').onclick = () => confirm('Discard this take and start over?') && restart();
const run = cmd => S && ({ pause: () => pause(true), resume: () => pause(false), toggle: () => pause(!S.paused), stop, cancel, restart })[cmd]?.();
chrome.runtime.onMessage.addListener(m => m.cmd && run(m.cmd));   // from the on-screen bar on other pages, and from shortcuts
addEventListener('srpp-cmd', e => run(e.detail));                // from the on-screen bar when it is shown on this page
onbeforeunload = e => { if (S) e.preventDefault(); };
const refreshLib = initLibrary($('#lib'), () => S?.m?.id);
const lock = v => document.querySelectorAll('.opt').forEach(e => { e.disabled = v; });   // options can't change mid-recording

// Sidebar navigation: Record / Settings
const panes = { navRec: '#viewRec', navSet: '#viewSet' };
for (const id in panes) $('#' + id).onclick = () => {
  for (const k in panes) {
    const on = k === id; $(panes[k]).hidden = !on; $('#' + k).classList.toggle('on', on);
    if (on) $('#' + k).setAttribute('aria-current', 'page'); else $('#' + k).removeAttribute('aria-current');
  }
};
// Top-right ⋯ menu (shortcuts)
$('#topMore').onclick = e => { e.stopPropagation(); const m = $('#topMenu'); m.hidden = !m.hidden; $('#topMore').setAttribute('aria-expanded', String(!m.hidden)); };
addEventListener('click', () => { $('#topMenu').hidden = true; $('#topMore').setAttribute('aria-expanded', 'false'); });

// ---- Test your mic: record 5 seconds, then play it back through the current settings (so you hear your own voice)
let testBuf = null, testCtx = null, testSrc = null, testAn = null, testIv = 0;
const tmsg = t => { $('#testMsg').textContent = t; };
const level = an => {
  const b = new Float32Array(1024); an.getFloatTimeDomainData(b); let sq = 0; for (const x of b) sq += x * x;
  $('#testLvl').style.width = Math.min(100, Math.sqrt(sq / b.length) * 300) + '%';
};
function stopTest() {
  clearInterval(testIv);
  if (testSrc) { testSrc.onended = null; try { testSrc.stop(); } catch {} testSrc.disconnect(); testSrc = null; }
  $('#testPlay').textContent = 'Play back'; $('#testLvl').style.width = 0;
}
function playTest() {
  stopTest();
  testCtx ??= new AudioContext({ sampleRate: 48000 });
  if (!testChain) {
    testChain = makeChain(testCtx); testAn = new AnalyserNode(testCtx, { fftSize: 1024 });
    testChain.comp.connect(testCtx.destination); testChain.comp.connect(testAn);
  }
  testCtx.resume();
  testSrc = testCtx.createBufferSource(); testSrc.buffer = testBuf; testSrc.connect(testChain.hp);
  testSrc.onended = () => { stopTest(); tmsg('Press Play back to hear it again, or record a new test.'); };
  testSrc.start(); $('#testPlay').textContent = 'Stop';
  tmsg('Playing back with your current settings. Move the sliders to hear the difference.');
  testIv = setInterval(() => level(testAn), 80);
}
$('#testPlay').onclick = () => testSrc ? stopTest() : playTest();
$('#testRec').onclick = async () => {
  if (S) return tmsg('Stop your recording before testing the mic.');
  if (!$('#mic').value || $('#mic').value === 'off') return tmsg('The microphone is turned off. Turn it on above first.');
  stopTest();
  let mic;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: $('#ns').checked, autoGainControl: false, channelCount: 1, sampleRate: 48000 } }); }
  catch (e) { return tmsg('Couldn’t use the microphone: ' + e.message); }
  const ctx = new AudioContext(), an = new AnalyserNode(ctx, { fftSize: 1024 }); ctx.createMediaStreamSource(mic).connect(an);
  const r = new MediaRecorder(mic, { mimeType: mp4(true), audioBitsPerSecond: 192000 }), ch = [];
  r.ondataavailable = e => ch.push(e.data);
  const done = new Promise(res => { r.onstop = res; });
  $('#testRec').disabled = true; $('#testPlay').disabled = true; r.start();
  let left = 5; tmsg(`Recording… speak now (${left}s)`);
  testIv = setInterval(() => level(an), 80);
  const tick = setInterval(() => { left--; if (left <= 0) { clearInterval(tick); r.stop(); } else tmsg(`Recording… speak now (${left}s)`); }, 1000);
  await done; clearInterval(tick); clearInterval(testIv);
  mic.getTracks().forEach(t => t.stop()); ctx.close(); $('#testRec').disabled = false; $('#testLvl').style.width = 0;
  try {
    const d = new AudioContext(); testBuf = await d.decodeAudioData(await new Blob(ch, { type: 'audio/mp4' }).arrayBuffer()); d.close();
  } catch { return tmsg('Couldn’t read the test recording. Try again.'); }
  $('#testPlay').disabled = false; playTest();
};

chrome.storage.onChanged.addListener((c, a) => { if (a === 'local' && c.pill && S) S.pill = c.pill.newValue; });

// ---- Floating controls: a Chrome Picture-in-Picture window. It stays on top of every window and app, which a
// page overlay can't do. Chrome only opens it from a click, so start() opens it first, before the share picker.
const IC = {
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  cancel: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg>'
};
const PIP_CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#000;color:#fff;font:600 14px/1 system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;overflow:hidden}
[hidden]{display:none!important}
.bar{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px}
.cambox{width:150px;height:150px;border-radius:50%;overflow:hidden;margin-bottom:10px;box-shadow:0 0 0 2px rgba(255,255,255,.4)}
.cambox video{display:block;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
.st{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;letter-spacing:.08em}
.dot{width:8px;height:8px;border-radius:50%;background:#fff;animation:b 1.2s infinite}
.paused .dot{background:none;border:1.5px solid #fff;animation:none}
@keyframes b{50%{opacity:.2}}
@media(prefers-reduced-motion:reduce){.dot{animation:none}}
.time{font:700 18px ui-monospace,monospace;font-variant-numeric:tabular-nums;margin:2px 0 8px}
button{all:unset;box-sizing:border-box;width:44px;height:44px;display:grid;place-items:center;border-radius:13px;cursor:pointer;color:#fff;font:600 11px system-ui,sans-serif;overflow:hidden}
button:hover,button.armed{background:#fff;color:#000}
button:focus-visible{outline:2px solid #fff;outline-offset:2px}
button.stop{width:56px;height:56px;border-radius:16px;background:#fff;color:#000}
button.stop:hover{background:#000;color:#fff;box-shadow:inset 0 0 0 2px #fff}
svg{width:22px;height:22px;fill:currentColor}`;

async function openPip() {
  if (!window.documentPictureInPicture) return null;
  try {
    const w = await documentPictureInPicture.requestWindow({ width: 200, height: $('#cam').value === 'on' ? 470 : 310 });
    const st = w.document.createElement('style'); st.textContent = PIP_CSS; w.document.head.append(st);
    w.document.title = 'Recording controls';
    w.document.body.innerHTML = `<div class="bar" role="toolbar" aria-label="Recording controls">
      <div class="cambox" id="pcamBox" hidden><video id="pcam" autoplay muted playsinline></video></div>
      <button class="stop" data-c="stop" title="Stop and save" aria-label="Stop and save">${IC.stop}</button>
      <div class="st"><span class="dot"></span><span id="pst">REC</span></div>
      <div class="time" id="ptime">0:00</div>
      <button data-c="pause" title="Pause" aria-label="Pause">${IC.pause}</button>
      <button data-c="restart" title="Restart" aria-label="Restart">${IC.restart}</button>
      <button data-c="cancel" title="Cancel recording" aria-label="Cancel recording">${IC.cancel}</button></div>`;
    w.document.body.onclick = pipClick;
    w.addEventListener('pagehide', () => { if (S?.pip === w) S.pip = null; });
    return w;
  } catch { return null; }
}
function attachCam() {   // show your camera in the floating window (the stream is already open on this page)
  if (!S?.pip || S.pip.closed) return;
  const box = S.pip.document.getElementById('pcamBox'), v = S.pip.document.getElementById('pcam');
  box.hidden = !S.cam; if (S.cam) { v.srcObject = S.cam; v.play().catch(() => {}); }
}
let armed = null, armT;
function disarm() {
  clearTimeout(armT);
  try { if (armed && S?.pip) { const b = S.pip.document.querySelector(`[data-c="${armed}"]`); b.classList.remove('armed'); b.innerHTML = IC[armed]; } } catch {}
  armed = null;
}
function pipClick(e) {
  const b = e.target.closest('button'); if (!b || !S) return; const c = b.dataset.c;
  if (c === 'stop') return stop();
  if (c === 'pause') return pause(!S.paused);
  if (armed === c) { disarm(); return c === 'cancel' ? cancel() : restart(); }   // these throw the take away: second click needed
  disarm(); armed = c; b.classList.add('armed'); b.textContent = 'Sure?'; armT = setTimeout(disarm, 3000);
}
$('#pipBtn').onclick = async () => {
  if (!S || (S.pip && !S.pip.closed)) return;
  const w = await openPip();
  if (!w) return say('Couldn’t open the floating controls in this browser.');
  S.pip = w; S.useOverlay = false; S.pipShown = undefined; attachCam(); publish(); tickUI();
};

async function start() {
  if (S) return;
  stopTest();
  if (!mp4()) return say('This browser can’t record MP4. Update Chrome, Brave or Edge.');
  const pip = $('#ovl').checked ? await openPip() : null;   // first await: opening it needs this click's user activation
  let screen, mic = null, cam = null;
  try {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    if ($('#mic').value === 'on') mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: $('#ns').checked, autoGainControl: false, channelCount: 1, sampleRate: 48000 } });
    if ($('#cam').value === 'on') cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  } catch (e) { screen?.getTracks().forEach(t => t.stop()); mic?.getTracks().forEach(t => t.stop()); pip?.close(); return say('Couldn’t start: ' + e.message); }

  // Video: screen + face cam bubble drawn on a canvas, ticked by a worker so it keeps running in a hidden tab
  const vt = screen.getVideoTracks()[0], { width: W = 1920, height: H = 1080 } = vt.getSettings();
  const vid = s => { const v = document.createElement('video'); v.srcObject = s; v.muted = true; v.play(); return v; };
  const sv = vid(screen), cv = cam && vid(cam);
  const cvs = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = cvs.getContext('2d');
  const ticker = new Worker('worker.js');
  let n = 0;
  ticker.onmessage = () => {
    if (++n % 8 === 0 && S) tickUI();   // worker-driven, so the timer keeps updating while this tab is in the background
    g.drawImage(sv, 0, 0, W, H);
    const k = S?.useOverlay && S.pill && (S.surface === 'browser' ? 'v' : S.surface === 'window' ? 'wnd' : '');
    if (k) for (const p of [S.pill[k], S.pill.bub?.[k]]) if (p) {   // the on-screen bar and camera bubble are part of the page, so paint over them by stretching the pixels just beside them
      const x = Math.max(0, Math.floor(p.l * W) - 8), y = Math.max(0, Math.floor(p.t * H) - 8), w = Math.min(W - x, Math.ceil(p.w * W) + 16), h = Math.min(H - y, Math.ceil(p.h * H) + 16);
      g.drawImage(g.canvas, x > 3 ? x - 3 : Math.min(W - 1, x + w + 3), y, 1, h, x, y, w, h);
    }
    if (cv?.videoWidth && !(S?.surface === 'monitor' && S.pip && !S.pip.closed)) {
      const d = Math.round(H * .24), x = 24, y = H - d - 24, s = Math.min(cv.videoWidth, cv.videoHeight);
      g.save(); g.beginPath(); g.arc(x + d / 2, y + d / 2, d / 2, 0, 7); g.clip();
      g.drawImage(cv, (cv.videoWidth - s) / 2, (cv.videoHeight - s) / 2, s, s, x, y, d, d); g.restore();
    }
  };
  ticker.postMessage({ t: 'tick' });
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' }), A = buildAudio(ctx, mic, screen.getAudioTracks());
  S = { screen, mic, cam, ctx, A, ticker, vtrack: cvs.captureStream(30).getVideoTracks()[0], pip, pipShown: undefined, useOverlay: $('#ovl').checked && !pip, surface: vt.getSettings().displaySurface, pill: null, rs: [], m: null, accum: 0, last: 0, paused: false, busy: false, iv: 0 };
  vt.onended = stop; attachCam();
  await begin();
  $('#hero').hidden = true; $('#ctl').hidden = false; lock(true);
  $('#meter').hidden = false; tickUI();
  say('Recording. Switch to what you want to show. Use the floating controls, the shortcuts, or this tab.');
  chrome.runtime.sendMessage({ rec: true, overlay: S.useOverlay }); setFav(true);
  chrome.storage.local.get('pill').then(r => { if (S) S.pill = r.pill; });
}

// Start a fresh take on the streams we already have (used by start and restart)
async function begin() {
  const id = Date.now().toString(36);
  const m = { id, title: 'Recording ' + new Date().toLocaleString(), created: Date.now(), dur: 0, status: 'recording', tracks: {} };
  S.m = m; S.rs = [];
  const mk = (kind, stream, audio) => {
    const name = `${id}.${kind}.mp4`, w = writer(name);
    const r = new MediaRecorder(stream, { mimeType: mp4(audio), audioBitsPerSecond: 192000, ...(audio ? {} : { videoBitsPerSecond: 8e6 }) });
    r.ondataavailable = e => e.data.size && w.write(e.data);
    const done = new Promise(res => r.onstop = res);
    m.tracks[kind] = name; S.rs.push({ r, w, done }); r.start(2000);
  };
  mk('main', new MediaStream([S.vtrack, ...S.A.mix.stream.getAudioTracks()]), false);
  if (S.A.mic) mk('mic', S.A.mic.stream, true);   // processed mic on its own track, for the editor
  if (S.A.sys) mk('sys', S.A.sys.stream, true);   // system audio on its own track
  S.accum = 0; S.last = Date.now(); S.paused = false;
  await meta.set(m); publish();
}

const finishRecorders = () => Promise.all(S.rs.map(async x => { if (x.r.state !== 'inactive') x.r.stop(); await x.done; await x.w.close(); }));
async function discard() {
  await finishRecorders(); const r = await root();
  for (const n of Object.values(S.m.tracks)) await r.removeEntry(n).catch(() => {});
  await meta.del(S.m.id);
}
function teardown() {
  clearInterval(S.iv); S.ticker.terminate(); disarm(); S.pip?.close(); 
  [S.screen, S.mic, S.cam].forEach(st => st?.getTracks().forEach(t => t.stop())); S.ctx.close();
  chrome.storage.local.remove('live'); chrome.runtime.sendMessage({ rec: false });
  setFav(false); document.title = 'Screen Recorder Plus Plus';
  $('#hero').hidden = false; $('#ctl').hidden = true; lock(false);
  $('#lvl').style.width = 0; $('#lvl').className = ''; $('#clip').hidden = true; $('#meter').hidden = true; S = null; refreshLib();
}

function pause(on) {
  if (!S || S.busy || on === S.paused) return;
  S.accum = elapsed(); S.last = Date.now(); S.paused = on;
  S.rs.forEach(x => on ? x.r.pause() : x.r.resume());
  publish(); tickUI();
}
async function stop() {
  if (!S || S.busy) return; S.busy = true;
  const s = S, dur = elapsed();
  await finishRecorders(); s.m.dur = dur; s.m.status = 'done'; await meta.set(s.m);
  teardown(); say(`Saved (${fmt(dur)}). It’s in the library on the right. It isn’t on your disk until you download it.`);
}
async function cancel() {
  if (!S || S.busy) return; S.busy = true;
  await discard(); teardown(); say('Recording discarded.');
}
async function restart() {
  if (!S || S.busy) return; S.busy = true;
  await discard(); await begin(); S.busy = false; refreshLib(); tickUI(); say('Started over.');
}

const buf = new Float32Array(1024);
function tickUI() {
  if (!S) return;
  const e = fmt(elapsed());
  $('#big').textContent = e; $('#state').textContent = S.paused ? 'Paused' : 'Recording';
  $('#pause').textContent = S.paused ? 'Resume' : 'Pause';
  document.title = (S.paused ? '❚❚ Paused ' : '● Recording ') + e;
  if (S.pip && !S.pip.closed) {
    const d = S.pip.document; d.getElementById('ptime').textContent = e;
    if (S.pipShown !== S.paused) {
      S.pipShown = S.paused; const p = d.querySelector('[data-c="pause"]');
      p.innerHTML = S.paused ? IC.play : IC.pause; p.title = S.paused ? 'Resume' : 'Pause';
      d.getElementById('pst').textContent = S.paused ? 'PAUSED' : 'REC'; d.querySelector('.bar').classList.toggle('paused', S.paused);
    }
  }
  $('#pipBtn').hidden = !!(S.pip && !S.pip.closed);
  if (!S.A.an) return;
  S.A.an.getFloatTimeDomainData(buf);
  let pk = 0, sq = 0; for (const x of buf) { pk = Math.max(pk, Math.abs(x)); sq += x * x; }
  $('#lvl').style.width = Math.min(100, Math.sqrt(sq / buf.length) * 300) + '%';
  $('#lvl').className = pk > .98 ? 'clip' : ''; $('#clip').hidden = pk <= .98;
}
