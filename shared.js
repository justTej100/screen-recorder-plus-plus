export const fmt = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(t % 60).padStart(2, '0'); };
export const root = () => navigator.storage.getDirectory();
export const getFile = async n => (await (await root()).getFileHandle(n)).getFile();
export const mp4 = audio => (audio
  ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']
  : ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
).find(t => MediaRecorder.isTypeSupported(t));
export const save = (blob, name) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};
export function writer(name) {
  const w = new Worker('worker.js'); let p = Promise.resolve();
  w.postMessage({ t: 'open', name });
  return {
    write(blob) { p = p.then(async () => { const buf = await blob.arrayBuffer(); w.postMessage({ t: 'w', name, buf }, [buf]); }); },
    close() { return p.then(() => new Promise(r => { w.onmessage = () => { w.terminate(); r(); }; w.postMessage({ t: 'close', name }); })); }
  };
}
export const meta = {
  all: async () => Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('rec_')).map(x => x[1]).sort((a, b) => b.created - a.created),
  set: m => chrome.storage.local.set({ ['rec_' + m.id]: m }),
  del: id => chrome.storage.local.remove('rec_' + id)
};
