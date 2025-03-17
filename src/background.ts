/**
 * ChromaCode - Background Script
 * Handles communication between popup and content scripts
 */

// Listen for messages from both popup and content scripts
chrome.runtime.onMessage.addListener(
  (message: ChromaCode.Message, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => {
    console.log('ChromaCode: Background received message:', message);

    // Handle color picked from content script
    if (message.action === 'colorPicked') {
      try {
        // Store the picked color in Chrome storage
        const color = message.color || '#ffffff';
        
        // First get existing history
        chrome.storage.local.get(['colorHistory'], (result) => {
          let colorHistory = Array.isArray(result.colorHistory) ? result.colorHistory : [];
          
          // Remove this color if it already exists in history
          colorHistory = colorHistory.filter(c => c !== color);
          
          // Add to the beginning of history
          colorHistory.unshift(color);
          
          // Limit history to the max number defined in popup.ts
          if (colorHistory.length > 20) {
            colorHistory = colorHistory.slice(0, 20);
          }
          
          // Save both lastPickedColor and updated colorHistory
          chrome.storage.local.set({ 
            lastPickedColor: color,
            colorHistory: colorHistory
          }, () => {
            console.log('ChromaCode: Color stored:', color);
            console.log('ChromaCode: History updated:', colorHistory);
            
            // Try to open the popup if it's not already open
            // Use a timeout to avoid race conditions
            setTimeout(() => {
              try {
                chrome.action.openPopup()
                  .catch(error => {
                    console.log('ChromaCode: Could not open popup automatically, it might already be open');
                  });
              } catch (popupError) {
                // Some browsers might throw instead of returning a rejected promise
                console.log('ChromaCode: Error opening popup:', popupError);
              }
            }, 150);
              
            sendResponse({ success: true });
          });
        });
      } catch (error) {
        console.error('ChromaCode: Error handling colorPicked:', error);
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
      return true; // Indicates async response
    }
    
    // Handle color pick error
    if (message.action === 'colorPickError') {
      console.error('ChromaCode: Color pick error:', message.error);
      
      // Show error in popup if possible
      try {
        setTimeout(() => {
          chrome.action.openPopup()
            .catch(() => {
              console.log('ChromaCode: Could not open popup to show error');
            });
        }, 150);
      } catch (error) {
        console.error('ChromaCode: Error opening popup to show error:', error);
      }
      
      sendResponse({ success: false });
      return true;
    }
    
    // Handle request to start color picker from popup
    if (message.action === 'startColorPicker') {
      if (!message.tabId) {
        console.error('ChromaCode: No tabId provided for startColorPicker');
        sendResponse({ success: false, error: 'No tab ID provided' });
        return true;
      }
      
      try {
        chrome.tabs.get(message.tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.error('ChromaCode: Error accessing tab:', chrome.runtime.lastError);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          
          if (!tab.id) {
            console.error('ChromaCode: Tab has no ID');
            sendResponse({ success: false, error: 'Tab has no ID' });
            return;
          }
          
          backgroundStartColorPicker(tab);
          sendResponse({ success: true });
        });
      } catch (error) {
        console.error('ChromaCode: Error starting color picker:', error);
        sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
      return true; // Indicates async response
    }

    return false; // For other messages, no async response
  }
);

// Set up context menu
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'pick-color',
      title: 'Pick Color',
      contexts: ['page', 'image']
    });
    console.log('ChromaCode: Context menu created');
  } catch (error) {
    console.error('ChromaCode: Error creating context menu:', error);
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'pick-color' && tab && tab.id) {
    backgroundStartColorPicker(tab);
  }
});

/**
 * Start the color picker in the specified tab
 */
function backgroundStartColorPicker(tab: chrome.tabs.Tab): void {
  if (!tab.id) {
    console.error('ChromaCode: Tab has no ID');
    return;
  }
  
  // Message the content script to start picking
  chrome.tabs.sendMessage(
    tab.id,
    { action: 'pickColor' },
    (response) => {
      // Check for errors or no response (content script might not be loaded yet)
      if (chrome.runtime.lastError || !response || !response.success) {
        console.log('ChromaCode: Content script not responding, injecting it manually');
        
        // If the content script hasn't loaded, inject it manually
        injectContentScript(tab);
      } else {
        console.log('ChromaCode: Color picker started successfully');
      }
    }
  );
}

/**
 * Inject the content script manually if it's not already loaded
 */
function injectContentScript(tab: chrome.tabs.Tab): void {
  if (!tab.id) {
    console.error('ChromaCode: Tab has no ID for content script injection');
    return;
  }
  
  // First, check if we have the scripting permission
  chrome.permissions.contains(
    { permissions: ['scripting'] },
    (hasPermission) => {
      if (hasPermission) {
        // Inject the content script
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id as number },
            files: ['content.js']
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error('ChromaCode: Error injecting content script:', chrome.runtime.lastError);
              return;
            }
            
            console.log('ChromaCode: Content script injected successfully');
            
            // Try to start the color picker again after a short delay
            setTimeout(() => {
              chrome.tabs.sendMessage(
                tab.id as number,
                { action: 'pickColor' },
                (response) => {
                  if (chrome.runtime.lastError || !response || !response.success) {
                    console.error('ChromaCode: Content script still not responding after injection');
                  } else {
                    console.log('ChromaCode: Color picker started after manual injection');
                  }
                }
              );
            }, 350); // Increased delay to allow for proper initialization
          }
        );
      } else {
        console.error('ChromaCode: Missing scripting permission for content script injection');
      }
    }
  );
} 