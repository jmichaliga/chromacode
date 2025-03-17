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

// Indicate that the content script is loaded and ready
console.log('ChromaCode: Content script loaded');

// Dynamically inject the stylesheet
function injectStylesheet(): void {
  // Only inject if not already present
  if (!document.querySelector('link[href*="styles.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles.css');
    document.head.appendChild(link);
    console.log('ChromaCode: Stylesheet injected');
  }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((
  message: ChromaCode.Message, 
  sender: chrome.runtime.MessageSender, 
  sendResponse: (response: ChromaCode.MessageResponse) => void
) => {
  console.log('ChromaCode: Received message:', message);

  if (message.action === 'pickColor') {
    console.log('ChromaCode: Starting color picker');
    
    // Check if picker is already active
    if (isPickerActive) {
      console.log('ChromaCode: Picker already active, ignoring request');
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
        // Get the selected color
        const selectedColor = result.sRGBHex;
        console.log('ChromaCode: Color picked with native EyeDropper:', selectedColor);
        
        // Send the selected color to the background script
        chrome.runtime.sendMessage({
          action: 'colorPicked',
          color: selectedColor
        }, response => {
          isPickerActive = false;
          
          if (chrome.runtime.lastError) {
            console.error('ChromaCode: Error sending color to background:', chrome.runtime.lastError);
            sendResponse({ 
              success: false, 
              error: 'Error sending color to background' 
            });
          } else {
            console.log('ChromaCode: Background response:', response);
            sendResponse({ success: true });
          }
        });
      })
      .catch(error => {
        isPickerActive = false;
        
        // Special handling for user cancellation (pressing Escape)
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log('ChromaCode: User canceled color picking');
          sendResponse({ 
            success: false, 
            error: 'Color picking was canceled' 
          });
        } else {
          console.error('ChromaCode: Error using native EyeDropper:', error);
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      });
    
    // Return true to indicate we want to send a response asynchronously
    return true;
  }
}); 