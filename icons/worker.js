// Tick: drives canvas drawing while the tab is hidden. Writer: appends chunks to an OPFS file (crash-safe).
const files = {};
let q = Promise.resolve();
onmessage = e => { q = q.then(() => handle(e.data)); };
async function handle(d) {
  if (d.t === 'tick') setInterval(() => postMessage(0), 33);
  if (d.t === 'open') {
    const root = await navigator.storage.getDirectory();
    const h = await (await root.getFileHandle(d.name, { create: true })).createSyncAccessHandle();
    files[d.name] = { h, pos: 0 };
  }
  if (d.t === 'w') { const f = files[d.name]; f.pos += f.h.write(new Uint8Array(d.buf), { at: f.pos }); f.h.flush(); }
  if (d.t === 'close') { files[d.name].h.close(); delete files[d.name]; postMessage('closed'); }
}
