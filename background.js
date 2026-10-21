const REC = chrome.runtime.getURL('recorder.html');

const paths = r => Object.fromEntries([16, 32, 48, 128].map(s => [s, `icons/${r ? 'rec' : 'icon'}-${s}.png`]));
function setState(rec, tabId) {
  chrome.action.setIcon({ path: paths(rec) });
  chrome.action.setTitle({ title: rec ? 'Recording. Click to go back to the recorder.' : 'Record' });
  if (rec) chrome.storage.session.set({ recTab: tabId });
  else { chrome.storage.session.remove('recTab'); chrome.storage.local.remove('live'); }
}

chrome.runtime.onInstalled.addListener(() => setState(false));
chrome.runtime.onStartup.addListener(() => setState(false));

chrome.action.onClicked.addListener(async () => {
  const [t] = await chrome.tabs.query({ url: REC });
  if (t) { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); }
  else chrome.tabs.create({ url: REC });
});
chrome.commands.onCommand.addListener(c => chrome.runtime.sendMessage({ cmd: c === 'toggle-pause' ? 'toggle' : 'stop' }).catch(() => {}));
chrome.runtime.onMessage.addListener((m, sender) => { if ('rec' in m) setState(m.rec, sender.tab?.id); });
// If the recorder tab is closed mid-recording, don't leave the icon stuck on red
chrome.tabs.onRemoved.addListener(async id => {
  const { recTab } = await chrome.storage.session.get('recTab');
  if (recTab === id) setState(false);
});
