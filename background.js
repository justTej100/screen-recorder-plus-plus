const REC = chrome.runtime.getURL('recorder.html');

// Draw the toolbar icon in code: dark square with a red dot when idle, solid red with a stop square when recording
function icon(rec) {
  const imageData = {};
  for (const s of [16, 32, 48, 128]) {
    const g = new OffscreenCanvas(s, s).getContext('2d');
    g.fillStyle = rec ? '#d9372f' : '#1b1b1f';
    g.beginPath(); g.roundRect(0, 0, s, s, s * .22); g.fill();
    if (rec) { g.fillStyle = '#fff'; g.fillRect(s * .3, s * .3, s * .4, s * .4); }
    else { g.fillStyle = '#d9372f'; g.beginPath(); g.arc(s / 2, s / 2, s * .26, 0, 7); g.fill(); }
    imageData[s] = g.getImageData(0, 0, s, s);
  }
  chrome.action.setIcon({ imageData });
}
function setState(rec, tabId) {
  icon(rec);
  chrome.action.setBadgeText({ text: rec ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#d9372f' });
  chrome.action.setTitle({ title: rec ? 'Recording. Click to go back to the recorder.' : 'Record' });
  if (rec) chrome.storage.session.set({ recTab: tabId }); else chrome.storage.session.remove('recTab');
}

chrome.runtime.onInstalled.addListener(() => setState(false));
chrome.runtime.onStartup.addListener(() => setState(false));

chrome.action.onClicked.addListener(async () => {
  const [t] = await chrome.tabs.query({ url: REC });
  if (t) { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); }
  else chrome.tabs.create({ url: REC });
});
chrome.runtime.onMessage.addListener((m, sender) => { if ('rec' in m) setState(m.rec, sender.tab?.id); });
// If the recorder tab is closed mid-recording, don't leave the icon stuck on red
chrome.tabs.onRemoved.addListener(async id => {
  const { recTab } = await chrome.storage.session.get('recTab');
  if (recTab === id) setState(false);
});
