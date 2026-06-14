// background.js — Service Worker
// Handles ZIP creation and file downloads triggered from content script

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'DOWNLOAD_FILE') {
    const { dataUrl, filename } = msg;
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (downloadId) => {
      sendResponse({ ok: true, downloadId });
    });
    return true; // keep channel open for async response
  }
});

// Toggle sidebar when clicking the extension icon in the browser toolbar
chrome.action.onClicked.addListener((tab) => {
  if (tab.id && tab.url && tab.url.includes('web.whatsapp.com')) {
    chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_SIDEBAR' }).catch(err => {
      console.warn('[WA Assistant] Could not send TOGGLE_SIDEBAR message. Is content script loaded? Please refresh web.whatsapp.com.', err);
    });
  }
});
