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

// Indicate that the content script is loaded and ready
console.log('ChromaCode: Content script loaded');

// Dynamically inject the stylesheet
function injectStylesheet(): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('styles.css');
  document.head.appendChild(link);
  console.log('ChromaCode: Stylesheet injected');
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
    
    try {
      // Make sure stylesheet is injected
      injectStylesheet();
      
      if (hasEyeDropperAPI()) {
        // Use the native EyeDropper API
        startNativeEyeDropper()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            console.error('ChromaCode: Error using native EyeDropper:', error);
            sendResponse({ 
              success: false, 
              error: error instanceof Error ? error.message : String(error) 
            });
          });
      } else {
        // No fallback - inform user the browser doesn't support the EyeDropper API
        console.error('ChromaCode: EyeDropper API not supported in this browser');
        sendResponse({ 
          success: false, 
          error: 'EyeDropper API not supported in this browser. Please use a compatible browser such as Chrome 95+, Edge 95+, or Firefox 98+.' 
        });
      }
    } catch (error) {
      console.error('ChromaCode: Error starting color picker:', error);
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
    
    // Return true to indicate we want to send a response asynchronously
    return true;
  }
});

// Check if the EyeDropper API is available
const hasEyeDropperAPI = (): boolean => {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
};

// Use the native EyeDropper API
async function startNativeEyeDropper(): Promise<void> {
  if (!hasEyeDropperAPI()) {
    throw new Error('EyeDropper API not supported');
  }
  
  try {
    console.log('ChromaCode: Using native EyeDropper API');
    
    // Create a new EyeDropper instance
    const eyeDropper = new (window.EyeDropper as EyeDropperConstructor)();
    
    // Open the eyedropper - this will show the native UI
    const result = await eyeDropper.open();
    
    // Get the selected color
    const selectedColor = result.sRGBHex;
    console.log('ChromaCode: Color picked with native EyeDropper:', selectedColor);
    
    // Send the selected color to the background script
    chrome.runtime.sendMessage({
      action: 'colorPicked',
      color: selectedColor
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('ChromaCode: Error sending color to background:', chrome.runtime.lastError);
      } else {
        console.log('ChromaCode: Background response:', response);
      }
    });
  } catch (error) {
    // The user likely canceled the eyedropper or it failed
    console.error('ChromaCode: Native EyeDropper error:', error);
    
    // Forward the error
    throw error;
  }
} 