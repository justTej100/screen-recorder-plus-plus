// The on-screen recording bar (a slim vertical pill) and, when the face cam is on, a live camera bubble beside it.
(() => {
  if (window.top !== window || window.__srpp) return; window.__srpp = true;
  const IC = {
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
    cancel: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg>',
    min: '<svg viewBox="0 0 24 24"><path d="M11 6L5 12l6 6V6zM19 6l-6 6 6 6V6z"/></svg>'
  };
  const CSS = `
  .dock{position:fixed;left:20px;bottom:20px;z-index:2147483647;display:flex;align-items:flex-end;gap:12px;touch-action:none;cursor:grab}
  .bar{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px;background:#000;color:#fff;border-radius:22px;box-shadow:0 0 0 1px rgba(255,255,255,.4),0 8px 24px rgba(0,0,0,.45);font:600 13px/1 system-ui,sans-serif;user-select:none}
  .bubble{flex:none;width:150px;height:150px;border-radius:50%;overflow:hidden;background:#000;box-shadow:0 0 0 2px rgba(255,255,255,.4),0 8px 24px rgba(0,0,0,.45)}
  .bubble[hidden]{display:none}
  .bubble iframe{display:block;width:100%;height:100%;border:0;pointer-events:none}
  .t{display:flex;align-items:center;gap:5px;margin:7px 0 5px;font-variant-numeric:tabular-nums}
  .dot{width:7px;height:7px;border-radius:50%;background:#fff;animation:b 1.2s infinite}
  .paused .dot{background:none;border:1.5px solid #fff;animation:none}
  @keyframes b{50%{opacity:.2}}
  @media(prefers-reduced-motion:reduce){.dot{animation:none}}
  .grp{display:flex;flex-direction:column;gap:2px}
  hr{width:24px;border:0;border-top:1.5px solid #fff;margin:5px 0}
  button{all:unset;box-sizing:border-box;width:40px;height:40px;display:grid;place-items:center;border-radius:12px;cursor:pointer;color:#fff;font:600 10px system-ui,sans-serif;overflow:hidden}
  button:hover,button.armed{background:#fff;color:#000}
  button:focus-visible{outline:2px solid #fff;outline-offset:1px}
  button.stop{width:44px;height:44px;background:#fff;color:#000}
  button.stop:hover{background:#000;color:#fff;box-shadow:inset 0 0 0 2px #fff}
  svg{width:20px;height:20px;fill:currentColor}
  .min .grp,.min hr{display:none}.min [data-c=min] svg{transform:rotate(180deg)}`;
  const fmt = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

  let host, dock, bar, st, iv, armed, armT, shownPaused, mounting = false, bubbleOn = false, lastK = '';
  const btn = c => bar.querySelector(`[data-c="${c}"]`);
  const send = cmd => { try { chrome.runtime.sendMessage({ cmd }); } catch {} if (location.protocol === 'chrome-extension:') dispatchEvent(new CustomEvent('srpp-cmd', { detail: cmd })); };
  const disarm = () => { clearTimeout(armT); if (armed) { const b = btn(armed); b.classList.remove('armed'); b.innerHTML = IC[armed]; armed = null; } };

  // Where an element is, as fractions of the page and of the browser window, so the recorder can paint over it in tab and window recordings.
  const rect = r => {
    const iw = innerWidth, ih = innerHeight, ow = outerWidth, oh = outerHeight, offX = (ow - iw) / 2, offY = oh - ih - offX;
    return { v: { l: r.left / iw, t: r.top / ih, w: r.width / iw, h: r.height / ih }, wnd: { l: (r.left + offX) / ow, t: (r.top + offY) / oh, w: r.width / ow, h: r.height / oh } };
  };
  function report() {
    if (!dock) return;
    const b = dock.querySelector('.bubble'), d = dock.getBoundingClientRect();
    const pill = { ...rect(bar.getBoundingClientRect()), bub: b.hidden ? null : rect(b.getBoundingClientRect()), dock: { l: d.left / innerWidth, t: d.top / innerHeight } };
    const k = JSON.stringify(pill); if (k === lastK) return; lastK = k;
    try { chrome.storage.local.set({ pill }); } catch {}
  }

  // The camera bubble is a small extension page in an iframe (a web page can't use the extension's camera permission directly).
  // Only the tab you're looking at opens the camera.
  function syncBubble() {
    const want = !!(dock && st?.overlay && st.bubble && !document.hidden);
    if (want === bubbleOn) return; bubbleOn = want;
    const b = dock.querySelector('.bubble'); b.textContent = ''; b.hidden = !want;
    if (want) { const f = document.createElement('iframe'); f.setAttribute('allow', 'camera'); f.title = 'Your camera'; f.src = chrome.runtime.getURL('bubble.html'); b.append(f); }
    requestAnimationFrame(report);
  }
  document.addEventListener('visibilitychange', () => { if (dock) syncBubble(); });

  function mount(pos) {
    host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><div class="dock">
      <div class="bar" role="toolbar" aria-label="Screen recording controls">
        <button class="stop" data-c="stop" title="Stop and save" aria-label="Stop and save">${IC.stop}</button>
        <div class="t"><span class="dot"></span><span class="time">0:00</span></div>
        <div class="grp">
          <button data-c="pause" title="Pause" aria-label="Pause"></button>
          <button data-c="restart" title="Restart" aria-label="Restart">${IC.restart}</button>
          <button data-c="cancel" title="Cancel recording" aria-label="Cancel recording">${IC.cancel}</button>
        </div><hr>
        <button data-c="min" title="Collapse" aria-label="Collapse">${IC.min}</button>
      </div><div class="bubble" hidden></div></div>`;
    dock = root.querySelector('.dock'); bar = root.querySelector('.bar');
    if (pos?.dock) { dock.style.left = pos.dock.l * innerWidth + 'px'; dock.style.top = pos.dock.t * innerHeight + 'px'; dock.style.bottom = 'auto'; }
    bar.onclick = e => {
      const b = e.target.closest('button'); if (!b) return; const c = b.dataset.c;
      if (c === 'min') { bar.classList.toggle('min'); return void requestAnimationFrame(report); }
      if (c === 'pause') return send(st.status === 'paused' ? 'resume' : 'pause');
      if (c === 'stop') return send('stop');
      if (armed === c) { disarm(); return send(c); }   // restart and cancel throw the take away, so they need a second click
      disarm(); armed = c; b.classList.add('armed'); b.textContent = 'Sure?'; armT = setTimeout(disarm, 3000);
    };
    dock.onpointerdown = e => {   // drag the bar and bubble together by their background
      if (e.target.closest('button')) return;
      const r = dock.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      dock.setPointerCapture(e.pointerId); dock.style.cursor = 'grabbing';
      dock.onpointermove = m => {
        dock.style.left = Math.max(0, Math.min(innerWidth - r.width, m.clientX - dx)) + 'px';
        dock.style.top = Math.max(0, Math.min(innerHeight - r.height, m.clientY - dy)) + 'px'; dock.style.bottom = 'auto';
      };
      dock.onpointerup = () => { dock.onpointermove = dock.onpointerup = null; dock.style.cursor = ''; report(); };
    };
    document.documentElement.append(host);
    requestAnimationFrame(report);
  }
  function render() {
    const paused = st.status === 'paused';
    bar.querySelector('.time').textContent = fmt(st.accum + (paused ? 0 : (Date.now() - st.last) / 1000));
    if (paused === shownPaused) return; shownPaused = paused;
    bar.classList.toggle('paused', paused);
    const p = btn('pause'); p.innerHTML = paused ? IC.play : IC.pause; p.title = p.ariaLabel = paused ? 'Resume' : 'Pause';
  }
  async function apply(live) {
    st = live; clearInterval(iv);
    if (!live || !live.overlay) { host?.remove(); host = dock = bar = null; shownPaused = undefined; bubbleOn = false; return; }
    if (!host && !mounting) { mounting = true; const { pill } = await chrome.storage.local.get('pill'); if (!host && st?.overlay) mount(pill); mounting = false; }
    if (!host) return;
    render(); syncBubble(); iv = setInterval(render, 250);
  }
  addEventListener('resize', () => requestAnimationFrame(report));
  chrome.storage.local.get('live', r => apply(r.live));
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.live) apply(c.live.newValue); });
})();
