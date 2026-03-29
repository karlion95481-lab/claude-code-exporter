// Badge update when navigating to claude.ai/code
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('claude.ai/code')) {
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280', tabId });
    chrome.action.setBadgeText({ text: '...', tabId });

    // Ask content script for message count
    chrome.tabs.sendMessage(tabId, { action: 'getStatus' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        chrome.action.setBadgeText({ text: '', tabId });
        return;
      }
      const count = response.messageCount || 0;
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
      chrome.action.setBadgeBackgroundColor({
        color: count > 0 ? '#10b981' : '#6b7280',
        tabId
      });
    });
  }
});
