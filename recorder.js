import { writer, mp4, meta, fmt } from './shared.js';
const $ = s => document.querySelector(s), say = t => $('#msg').textContent = t;
const PRE = { 'Clear voice': [-2, 3, 2, 90], Podcast: [3, 2, 1, 80], 'Reduce room': [-5, 1, 0, 120], Flat: [0, 0, 0, 60] };
const BANDS = ['low', 'mid', 'high'];
let filt, hpHz = 90, S = null;

$('#preset').innerHTML = Object.keys(PRE).map(k => `<option>${k}</option>`).join('');
const eq = () => filt && BANDS.forEach(k => filt[k].gain.value = +$('#' + k).value);
$('#preset').onchange = () => {
  const p = PRE[$('#preset').value]; BANDS.forEach((k, i) => $('#' + k).value = p[i]);
  hpHz = p[3]; if (filt) filt.hp.frequency.value = hpHz; eq();
};
BANDS.forEach(k => $('#' + k).oninput = eq);
$('#preset').onchange();

function buildAudio(ctx, mic, sysTracks) {
  const mix = ctx.createMediaStreamDestination(), out = { mix };
  if (mic) {
    const src = ctx.createMediaStreamSource(mic);
    filt = {
      hp: new BiquadFilterNode(ctx, { type: 'highpass', frequency: hpHz, Q: .7 }),
      low: new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 120 }),
      mid: new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2500, Q: 1 }),
      high: new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8000 })
    };
    const comp = new DynamicsCompressorNode(ctx, { threshold: -24, ratio: 3, attack: .01, release: .25 });
    out.an = new AnalyserNode(ctx, { fftSize: 1024 });
    src.connect(filt.hp).connect(filt.low).connect(filt.mid).connect(filt.high).connect(comp).connect(out.an);
    out.an.connect(mix); out.mic = ctx.createMediaStreamDestination(); out.an.connect(out.mic);
    eq();
  }
  if (sysTracks.length) {
    const s = ctx.createMediaStreamSource(new MediaStream(sysTracks));
    s.connect(mix); out.sys = ctx.createMediaStreamDestination(); s.connect(out.sys);
  }
  return out;
}

$('#rec').onclick = () => S ? stop() : start();
onbeforeunload = e => { if (S) e.preventDefault(); };

async function start() {
  if (!mp4()) return say('This browser can’t record MP4. Update Chrome, Brave or Edge.');
  let screen, mic = null, cam = null;
  try {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    if ($('#mic').checked) mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    if ($('#cam').checked) cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  } catch (e) { screen?.getTracks().forEach(t => t.stop()); mic?.getTracks().forEach(t => t.stop()); return say('Couldn’t start: ' + e.message); }

  // Video: screen + face cam bubble drawn on a canvas, ticked by a worker so it keeps running in a hidden tab
  const vt = screen.getVideoTracks()[0], { width: W = 1920, height: H = 1080 } = vt.getSettings();
  const vid = s => { const v = document.createElement('video'); v.srcObject = s; v.muted = true; v.play(); return v; };
  const sv = vid(screen), cv = cam && vid(cam);
  const cvs = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = cvs.getContext('2d');
  const ticker = new Worker('worker.js');
  ticker.onmessage = () => {
    g.drawImage(sv, 0, 0, W, H);
    if (cv?.videoWidth) {
      const d = Math.round(H * .24), x = 24, y = H - d - 24, s = Math.min(cv.videoWidth, cv.videoHeight);
      g.save(); g.beginPath(); g.arc(x + d / 2, y + d / 2, d / 2, 0, 7); g.clip();
      g.drawImage(cv, (cv.videoWidth - s) / 2, (cv.videoHeight - s) / 2, s, s, x, y, d, d); g.restore();
    }
  };
  ticker.postMessage({ t: 'tick' });

  const ctx = new AudioContext(), A = buildAudio(ctx, mic, screen.getAudioTracks());
  const id = Date.now().toString(36), t0 = Date.now();
  const m = { id, title: 'Recording ' + new Date().toLocaleString(), created: t0, dur: 0, status: 'recording', tracks: {} };
  const rs = [];
  const mk = (kind, stream, audio) => {
    const name = `${id}.${kind}.mp4`, w = writer(name), r = new MediaRecorder(stream, { mimeType: mp4(audio) });
    r.ondataavailable = e => e.data.size && w.write(e.data);
    const done = new Promise(res => r.onstop = res);
    m.tracks[kind] = name; rs.push({ r, w, done }); r.start(2000);
  };
  mk('main', new MediaStream([...cvs.captureStream(30).getVideoTracks(), ...A.mix.stream.getAudioTracks()]), false);
  if (A.mic) mk('mic', A.mic.stream, true);   // processed mic on its own track, for the editor
  if (A.sys) mk('sys', A.sys.stream, true);   // system audio on its own track
  await meta.set(m);

  const buf = new Float32Array(1024);
  const iv = setInterval(() => {
    $('#t').textContent = fmt((Date.now() - t0) / 1000);
    if (!A.an) return;
    A.an.getFloatTimeDomainData(buf);
    let pk = 0, sq = 0; for (const x of buf) { pk = Math.max(pk, Math.abs(x)); sq += x * x; }
    $('#lvl').style.width = Math.min(100, Math.sqrt(sq / buf.length) * 300) + '%';
    $('#lvl').className = pk > .98 ? 'clip' : '';
  }, 100);
  S = { m, rs, iv, ticker, ctx, streams: [screen, mic, cam], t0 };
  vt.onended = stop;
  $('#rec').textContent = 'Stop recording'; say('Recording. You can switch to another tab or window. Stop here or with the browser’s “Stop sharing” bar.');
  chrome.runtime.sendMessage({ rec: true });
}

async function stop() {
  if (!S) return; const s = S; S = null;
  clearInterval(s.iv); s.ticker.terminate();
  await Promise.all(s.rs.map(async x => { if (x.r.state !== 'inactive') x.r.stop(); await x.done; await x.w.close(); }));
  s.streams.forEach(st => st?.getTracks().forEach(t => t.stop())); s.ctx.close();
  s.m.dur = (Date.now() - s.t0) / 1000; s.m.status = 'done'; await meta.set(s.m);
  chrome.runtime.sendMessage({ rec: false });
  $('#rec').textContent = 'Start recording'; $('#lvl').style.width = 0;
  say(`Saved (${fmt(s.m.dur)}). Open the library to edit or download it. It isn’t on your disk until you download it.`);
}
