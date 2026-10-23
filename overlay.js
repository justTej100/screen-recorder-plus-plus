// Fallback on-screen bar (only used when the floating controls window can't open). Vertical, like the floating one.
(() => {
  if (window.top !== window || window.__srpp) return; window.__srpp = true;
  const IC = {
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
    cancel: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
    min: '<svg viewBox="0 0 24 24"><path d="M11 6L5 12l6 6V6zM19 6l-6 6 6 6V6z"/></svg>'
  };
  const CSS = `
  .bar{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 10px;background:#000;color:#fff;border:2px solid #fff;outline:2px solid #000;border-radius:28px;font:600 14px/1 system-ui,sans-serif;user-select:none}
  .t{display:flex;align-items:center;gap:6px;margin:2px 0 4px;font-variant-numeric:tabular-nums;font-size:15px}
  .dot{width:9px;height:9px;border-radius:50%;background:#fff;animation:b 1.2s infinite}
  .paused .dot{background:none;border:2px solid #fff;animation:none}
  @keyframes b{50%{opacity:.2}}
  @media(prefers-reduced-motion:reduce){.dot{animation:none}}
  .grp{display:flex;flex-direction:column;gap:6px}
  hr{width:34px;border:0;border-top:2px solid #fff;margin:4px 0}
  button{all:unset;box-sizing:border-box;min-width:44px;height:44px;display:grid;place-items:center;border-radius:14px;cursor:pointer;color:#fff;font:600 12px system-ui,sans-serif;padding:0 6px}
  button:hover,button.armed{background:#fff;color:#000}
  button:focus-visible{outline:2px solid #fff;outline-offset:2px}
  button.stop{width:56px;height:56px;border-radius:16px;background:#fff;color:#000}
  button.stop:hover{background:#000;color:#fff;box-shadow:inset 0 0 0 2px #fff}
  svg{width:22px;height:22px;fill:currentColor}
  .min .grp,.min hr{display:none}.min [data-c=min] svg{transform:rotate(180deg)}`;
  const fmt = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  let host, bar, st, iv, armed, armT, shownPaused;
  const btn = c => bar.querySelector(`[data-c="${c}"]`);
  const send = cmd => { try { chrome.runtime.sendMessage({ cmd }); } catch {} };
  const disarm = () => { clearTimeout(armT); if (armed) { const b = btn(armed); b.classList.remove('armed'); b.innerHTML = IC[armed]; armed = null; } };
  function mount() {
    host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><div class="bar" role="toolbar" aria-label="Screen recording controls">
      <button class="stop" data-c="stop" title="Stop and save" aria-label="Stop and save">${IC.stop}</button>
      <div class="t"><span class="dot"></span><span class="time">0:00</span></div>
      <div class="grp">
        <button data-c="pause" title="Pause" aria-label="Pause"></button>
        <button data-c="restart" title="Restart" aria-label="Restart">${IC.restart}</button>
        <button data-c="cancel" title="Cancel recording" aria-label="Cancel recording">${IC.cancel}</button>
      </div><hr>
      <button data-c="min" title="Collapse" aria-label="Collapse">${IC.min}</button></div>`;
    bar = root.querySelector('.bar');
    bar.onclick = e => {
      const b = e.target.closest('button'); if (!b) return; const c = b.dataset.c;
      if (c === 'min') return void bar.classList.toggle('min');
      if (c === 'pause') return send(st.status === 'paused' ? 'resume' : 'pause');
      if (c === 'stop') return send('stop');
      if (armed === c) { disarm(); return send(c); }   // restart and cancel throw the take away, so they need a second click
      disarm(); armed = c; b.classList.add('armed'); b.textContent = 'Sure?'; armT = setTimeout(disarm, 3000);
    };
    document.documentElement.append(host);
  }
  function render() {
    const paused = st.status === 'paused';
    bar.querySelector('.time').textContent = fmt(st.accum + (paused ? 0 : (Date.now() - st.last) / 1000));
    if (paused === shownPaused) return; shownPaused = paused;
    bar.classList.toggle('paused', paused);
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
