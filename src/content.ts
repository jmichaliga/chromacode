/**
 * ChromaCode - Content Script
 * Handles the color picking functionality in the active tab
 */

// EyeDropper API interface definition
interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperConstructor {
  new(): {
    open: () => Promise<EyeDropperResult>;
  };
}

// Simple flag to prevent multiple picker instances
let isPickerActive = false;

// Dynamically inject the stylesheet
function injectStylesheet(): void {
  // Only inject if not already present
  if (!document.querySelector('link[href*="styles.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles.css');
    document.head.appendChild(link);
  }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((
  message: ChromaCode.Message, 
  sender: chrome.runtime.MessageSender, 
  sendResponse: (response: ChromaCode.MessageResponse) => void
) => {

  if (message.action === 'pickColor') {
    // Check if picker is already active
    if (isPickerActive) {
      sendResponse({ 
        success: false, 
        error: 'Color picker already active' 
      });
      return true;
    }
    
    // Make sure stylesheet is injected
    injectStylesheet();
    
    // Check if EyeDropper API is supported
    if (!window.EyeDropper) {
      console.error('ChromaCode: EyeDropper API not supported in this browser');
      sendResponse({ 
        success: false, 
        error: 'EyeDropper API not supported in this browser. Please use a compatible browser such as Chrome 95+, Edge 95+, or Firefox 98+.' 
      });
      return true;
    }
    
    // Set active flag and start color picker
    isPickerActive = true;

    // Create new EyeDropper and open it directly
    // This maintains the user activation chain with minimal code
    const eyeDropper = new (window.EyeDropper as EyeDropperConstructor)();
    
    eyeDropper.open()
      .then(result => {
        const selectedColor = result.sRGBHex;
        chrome.runtime.sendMessage({
          action: 'colorPicked',
          color: selectedColor
        });
      })
      .catch(error => {
        isPickerActive = false;
        
        // Special handling for user cancellation (pressing Escape)
        if (error instanceof DOMException && error.name === 'AbortError') {
          return false;
        } else {
          return true;
        }
      });
    
    // Return true to indicate we want to send a response asynchronously
    return true;
  }
});
