/**
 * ChromaCode - Background Script
 * Handles communication between popup and content scripts
 */

const MAX_COLOR_HISTORY = 5;

chrome.runtime.onMessage.addListener(
  (
    message: ChromaCode.Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void
  ) => {
    console.log("ChromaCode: Background received message:", message);

    switch (message.action) {
      case "colorPicked":
        const color = message.color || "#ffffff";
        chrome.storage.local.get(["colorHistory"], (result) => {
          let colorHistory = Array.isArray(result.colorHistory)
            ? result.colorHistory
            : [];

          colorHistory = colorHistory.filter((c) => c !== color);
          colorHistory.unshift(color);

          if (colorHistory.length > MAX_COLOR_HISTORY) {
            colorHistory = colorHistory.slice(0, MAX_COLOR_HISTORY);
          }

          console.log('result>', result);
          console.log('storage>', chrome.storage.local);
          console.log('colorHistory>', colorHistory);

          chrome.storage.local.set({ lastPickedColor: color }, () => {
            chrome.action.openPopup();
            sendResponse({ success: true });
          });
        });
        return true;
      case "colorPickError":
        chrome.action.openPopup();
        sendResponse({ success: false });
        return true;
      case "startColorPicker":
        if (!message.tabId) {
          sendResponse({ success: false, error: "No tab ID provided" });
          return true;
        }
        chrome.tabs.get(message.tabId, (tab) => {
          if (tab && tab.id) {
            backgroundStartColorPicker(tab);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: "Tab not found" });
          }
        });
        return true;
      default:
        return false;
    }
  }
);

function backgroundStartColorPicker(tab: chrome.tabs.Tab): void {
  if (!tab.id) {
    console.error("ChromaCode: Tab has no ID");
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: "pickColor" }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      console.log(
        "ChromaCode: Content script not responding, injecting it manually"
      );
      injectContentScript(tab);
    } else {
      console.log("ChromaCode: Color picker started successfully");
    }
  });
}

function injectContentScript(tab: chrome.tabs.Tab): void {
  if (!tab.id) {
    console.error("ChromaCode: Tab has no ID for content script injection");
    return;
  }

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id as number },
      files: ["content.js"],
    },
    () => {
      chrome.tabs.sendMessage(
        tab.id as number,
        { action: "pickColor" },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            console.error(
              "ChromaCode: Content script still not responding after injection"
            );
          } else {
            console.log(
              "ChromaCode: Color picker started after manual injection"
            );
          }
        }
      );
    }
  );
}
