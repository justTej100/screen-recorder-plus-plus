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

async function start() {
  if (S) return;
  stopTest();
  if (!mp4()) return say('This browser can’t record MP4. Update Chrome, Brave or Edge.');
  let screen, mic = null, cam = null;
  try {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    if ($('#mic').value === 'on') mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: $('#ns').checked, autoGainControl: false, channelCount: 1, sampleRate: 48000 } });
    if ($('#cam').value === 'on') cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  } catch (e) { screen?.getTracks().forEach(t => t.stop()); mic?.getTracks().forEach(t => t.stop()); return say('Couldn’t start: ' + e.message); }

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
    if (cv?.videoWidth) {
      const d = Math.round(H * .24), x = 24, y = H - d - 24, s = Math.min(cv.videoWidth, cv.videoHeight);
      g.save(); g.beginPath(); g.arc(x + d / 2, y + d / 2, d / 2, 0, 7); g.clip();
      g.drawImage(cv, (cv.videoWidth - s) / 2, (cv.videoHeight - s) / 2, s, s, x, y, d, d); g.restore();
    }
  };
  ticker.postMessage({ t: 'tick' });
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' }), A = buildAudio(ctx, mic, screen.getAudioTracks());
  S = { screen, mic, cam, ctx, A, ticker, vtrack: cvs.captureStream(30).getVideoTracks()[0], useOverlay: $('#ovl').checked, surface: vt.getSettings().displaySurface, pill: null, rs: [], m: null, accum: 0, last: 0, paused: false, busy: false, iv: 0 };
  vt.onended = stop;
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
  clearInterval(S.iv); S.ticker.terminate(); 
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
  if (!S.A.an) return;
  S.A.an.getFloatTimeDomainData(buf);
  let pk = 0, sq = 0; for (const x of buf) { pk = Math.max(pk, Math.abs(x)); sq += x * x; }
  $('#lvl').style.width = Math.min(100, Math.sqrt(sq / buf.length) * 300) + '%';
  $('#lvl').className = pk > .98 ? 'clip' : ''; $('#clip').hidden = pk <= .98;
}
