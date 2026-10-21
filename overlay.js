// On-screen recording bar, injected into normal web pages while a recording is running.
(() => {
  if (window.top !== window) return;
  const IC = {
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
    cancel: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>'
  };
  const LABEL = { restart: 'Restart?', cancel: 'Discard?' };
  const CSS = `
  .bar{position:fixed;left:20px;bottom:20px;z-index:2147483647;display:flex;align-items:center;gap:10px;background:#000;color:#fff;border:2px solid #fff;outline:2px solid #000;border-radius:999px;padding:6px 8px 6px 14px;font:600 14px/1 system-ui,sans-serif;user-select:none}
  .dot{width:10px;height:10px;border-radius:50%;background:#fff;animation:b 1.2s infinite}
  .paused .dot{background:none;border:2px solid #fff;animation:none}
  @keyframes b{50%{opacity:.2}}
  @media(prefers-reduced-motion:reduce){.dot{animation:none}}
  .time{font-variant-numeric:tabular-nums;min-width:3ch;display:inline-block}
  .btns{display:flex;gap:2px}
  button{all:unset;box-sizing:border-box;min-width:32px;height:32px;display:grid;place-items:center;border-radius:999px;cursor:pointer;color:#fff;font:600 12px system-ui,sans-serif;padding:0 8px}
  button:hover,button.armed{background:#fff;color:#000}
  button:focus-visible{outline:2px solid #fff;outline-offset:2px}
  button.stop{background:#fff;color:#000}
  button.stop:hover{background:#000;color:#fff;box-shadow:inset 0 0 0 2px #fff}
  svg{width:18px;height:18px;fill:currentColor}
  .min .btns{display:none}`;
  const fmt = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

  let host, bar, st, iv, armed, armT, shownPaused;
  const btn = c => bar.querySelector(`[data-c="${c}"]`);
  const send = cmd => { try { chrome.runtime.sendMessage({ cmd }); } catch {} };
  const disarm = () => { clearTimeout(armT); if (armed) { const b = btn(armed); b.classList.remove('armed'); b.innerHTML = IC[armed]; armed = null; } };

  function mount() {
    host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><div class="bar" role="region" aria-label="Screen recording controls">
      <span class="dot"></span><span><b class="lbl">REC</b> <span class="time">0:00</span></span>
      <span class="btns">
        <button data-c="pause" title="Pause" aria-label="Pause"></button>
        <button data-c="restart" title="Restart" aria-label="Restart">${IC.restart}</button>
        <button data-c="cancel" title="Cancel recording" aria-label="Cancel recording">${IC.cancel}</button>
        <button data-c="stop" class="stop" title="Stop and save" aria-label="Stop and save">${IC.stop}</button>
      </span>
      <button data-c="min" title="Collapse" aria-label="Collapse">–</button></div>`;
    bar = root.querySelector('.bar');
    bar.onclick = e => {
      const b = e.target.closest('button'); if (!b) return; const c = b.dataset.c;
      if (c === 'min') { bar.classList.toggle('min'); b.textContent = bar.classList.contains('min') ? '+' : '–'; return; }
      if (c === 'pause') return send(st.status === 'paused' ? 'resume' : 'pause');
      if (c === 'stop') return send('stop');
      if (armed === c) { disarm(); return send(c); }   // restart and cancel throw away the take, so they need a second click
      disarm(); armed = c; b.classList.add('armed'); b.textContent = LABEL[c]; armT = setTimeout(disarm, 3000);
    };
    document.documentElement.append(host);
  }
  function render() {
    const paused = st.status === 'paused';
    bar.querySelector('.time').textContent = fmt(st.accum + (paused ? 0 : (Date.now() - st.last) / 1000));
    if (paused === shownPaused) return; shownPaused = paused;
    bar.classList.toggle('paused', paused); bar.querySelector('.lbl').textContent = paused ? 'PAUSED' : 'REC';
    const p = btn('pause'); p.innerHTML = paused ? IC.play : IC.pause; p.title = p.ariaLabel = paused ? 'Resume' : 'Pause';
  }
  function apply(live) {
    st = live; clearInterval(iv);
    if (!live || !live.overlay) { host?.remove(); host = bar = null; shownPaused = undefined; return; }
    if (!host) mount();
    render(); iv = setInterval(render, 250);
  }
  chrome.storage.local.get('live', r => apply(r.live));
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.live) apply(c.live.newValue); });
})();
