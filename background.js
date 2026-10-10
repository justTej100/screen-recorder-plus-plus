const REC = chrome.runtime.getURL('recorder.html');
chrome.action.onClicked.addListener(async () => {
  const [t] = await chrome.tabs.query({ url: REC });
  if (t) { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); }
  else chrome.tabs.create({ url: REC });
});
chrome.runtime.onMessage.addListener(m => {
  if ('rec' in m) {
    chrome.action.setBadgeText({ text: m.rec ? 'REC' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#d9372f' });
  }
});
