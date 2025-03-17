// Global variables for our picker
let pickerOverlay: HTMLElement | null = null;
let pickerCursor: HTMLElement | null = null;
let colorInfoBox: HTMLElement | null = null;
let magnifierGlass: HTMLElement | null = null;
let magnifierCanvas: HTMLCanvasElement | null = null;
let magnifierContext: CanvasRenderingContext2D | null = null;
let currentCenterPixelColor: string = '#ffffff';
let pickerActive = false;
const MAGNIFIER_SIZE = 150; // Size of the magnification area
let lastProcessedPosition: ChromaCode.Position = { x: 0, y: 0 };
let throttleDelay: number = 30; // ms - controls how often we process mouse movements
let lastUpdateTime: number = 0;
const ZOOM_FACTOR: number = 6; // Magnification level
const MAGNIFIER_PIXEL_SIZE: number = 6; // Size of each "pixel" in the magnifier
let standaloneInfoBox: HTMLElement | null = null; // New standalone color info box

// Check if the EyeDropper API is available
const hasEyeDropperAPI = (): boolean => {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
};

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
      // Make sure stylesheet is injected before starting the picker
      injectStylesheet();
      
      if (hasEyeDropperAPI()) {
        // Use the native EyeDropper API if available
        startNativeEyeDropper()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            console.error('ChromaCode: Error using native EyeDropper:', error);
            // Fall back to custom implementation if the native one fails
            contentPickerStart();
            sendResponse({ success: true });
          });
      } else {
        // Fall back to our custom implementation
        contentPickerStart();
        sendResponse({ success: true });
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

// Use the native EyeDropper API
async function startNativeEyeDropper(): Promise<void> {
  if (!hasEyeDropperAPI()) {
    throw new Error('EyeDropper API not supported');
  }
  
  try {
    console.log('ChromaCode: Using native EyeDropper API');
    
    // Create a preview/helper element that will show while moving the cursor
    createStandaloneInfoBox();
    
    // Setup event listeners for live preview before starting EyeDropper
    setupLivePreviewListeners(true);
    
    // Create a new EyeDropper instance
    const eyeDropper = new (window.EyeDropper as EyeDropperConstructor)();
    
    // Open the eyedropper - this will show the native UI
    const result = await eyeDropper.open();
    
    // Clean up our preview once the EyeDropper returns a result
    removeStandaloneInfoBox();
    
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
    // Clean up our preview elements
    removeStandaloneInfoBox();
    
    // The user likely canceled the eyedropper or it failed
    console.error('ChromaCode: Native EyeDropper error:', error);
    
    // Forward the error
    throw error;
  }
}

// Setup live preview event listeners
function setupLivePreviewListeners(isNative: boolean): void {
  document.addEventListener('mousemove', handlePreviewMouseMove);
  
  // Also stop preview when eye dropper is active or on key press
  if (isNative) {
    document.addEventListener('keydown', removeStandaloneInfoBox);
    document.addEventListener('mousedown', removeStandaloneInfoBox);
  }
}

// Handle mouse movement for the standalone preview
function handlePreviewMouseMove(e: MouseEvent): void {
  if (!standaloneInfoBox) return;
  
  // Get mouse position
  const mouseX = e.clientX;
  const mouseY = e.clientY;
  
  // Throttle updates for better performance
  const now = Date.now();
  if (now - lastUpdateTime < throttleDelay) return;
  lastUpdateTime = now;
  
  // Position the info box near the cursor but not directly under it
  positionStandaloneInfoBox(mouseX, mouseY);
  
  // Get the element under the cursor
  const element = document.elementFromPoint(mouseX, mouseY);
  if (!element) return;
  
  // Sample the color at the cursor position
  const sampledColor = getColorAtPoint(mouseX, mouseY, element);
  
  // Update the info box with the sampled color
  updateStandaloneInfoBox(sampledColor);
}

// Create standalone color info box
function createStandaloneInfoBox(): void {
  // Remove any existing info box
  removeStandaloneInfoBox();
  
  // Create the info box
  standaloneInfoBox = document.createElement('div');
  standaloneInfoBox.className = 'standalone-color-info';
  standaloneInfoBox.style.cssText = `
    position: fixed;
    z-index: 2147483646;
    background: rgba(30, 30, 30, 0.9);
    color: white;
    border-radius: 4px;
    padding: 8px 12px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    pointer-events: none;
    display: flex;
    align-items: center;
    border: 1px solid rgba(255, 255, 255, 0.2);
    max-width: 200px;
  `;
  
  // Create the color swatch
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    margin-right: 10px;
    background-color: #ffffff;
  `;
  
  // Create info container
  const info = document.createElement('div');
  info.className = 'color-info-text';
  info.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 3px;
  `;
  
  // HEX value
  const hexInfo = document.createElement('div');
  hexInfo.className = 'color-hex';
  hexInfo.style.cssText = `
    font-weight: bold;
    letter-spacing: 0.5px;
  `;
  
  // RGB value
  const rgbInfo = document.createElement('div');
  rgbInfo.className = 'color-rgb';
  rgbInfo.style.cssText = `
    font-size: 12px;
    opacity: 0.8;
  `;
  
  // Add all elements to the DOM
  info.appendChild(hexInfo);
  info.appendChild(rgbInfo);
  standaloneInfoBox.appendChild(swatch);
  standaloneInfoBox.appendChild(info);
  document.body.appendChild(standaloneInfoBox);
  
  // Initial position offscreen until we have a mouse position
  standaloneInfoBox.style.left = '-9999px';
  standaloneInfoBox.style.top = '-9999px';
}

// Position the standalone info box
function positionStandaloneInfoBox(x: number, y: number): void {
  if (!standaloneInfoBox) return;
  
  // Position the info box offset from cursor to prevent obscuring content
  let posX = x + 20;
  let posY = y + 20;
  
  // Check if we're near the right edge of the screen
  if (posX + 200 > window.innerWidth) {
    posX = x - 220; // Position on the left side of cursor
  }
  
  // Check if we're near the bottom edge of the screen
  if (posY + 80 > window.innerHeight) {
    posY = y - 80; // Position above cursor
  }
  
  standaloneInfoBox.style.left = `${posX}px`;
  standaloneInfoBox.style.top = `${posY}px`;
}

// Update the standalone info box with color information
function updateStandaloneInfoBox(color: string): void {
  if (!standaloneInfoBox) return;
  
  const swatch = standaloneInfoBox.querySelector('.color-swatch') as HTMLElement;
  const hexInfo = standaloneInfoBox.querySelector('.color-hex') as HTMLElement;
  const rgbInfo = standaloneInfoBox.querySelector('.color-rgb') as HTMLElement;
  
  if (swatch && hexInfo && rgbInfo) {
    swatch.style.backgroundColor = color;
    hexInfo.textContent = color.toUpperCase();
    rgbInfo.textContent = hexToRgbString(color);
    
    // Set text color based on background for better contrast
    const contrastColor = getContrastColor(color);
    hexInfo.style.color = contrastColor === '#ffffff' ? '#ffffff' : '#222222';
  }
}

// Remove the standalone info box
function removeStandaloneInfoBox(): void {
  if (standaloneInfoBox && standaloneInfoBox.parentNode) {
    standaloneInfoBox.parentNode.removeChild(standaloneInfoBox);
    standaloneInfoBox = null;
  }
  
  // Remove event listeners
  document.removeEventListener('mousemove', handlePreviewMouseMove);
  document.removeEventListener('keydown', removeStandaloneInfoBox);
  document.removeEventListener('mousedown', removeStandaloneInfoBox);
}

// Start the custom color picker (fallback for browsers without EyeDropper API)
function contentPickerStart(): void {
  console.log('ChromaCode: Initializing custom picker (fallback)');
  
  // If the picker is already active, clean up old elements first
  if (pickerActive) {
    console.log('ChromaCode: Picker already active, stopping first');
    stopColorPicker();
  }
  
  pickerActive = true;
  
  try {
    // Create an overlay that covers the entire page
    pickerOverlay = document.createElement('div');
    pickerOverlay.style.position = 'fixed';
    pickerOverlay.style.top = '0';
    pickerOverlay.style.left = '0';
    pickerOverlay.style.width = '100%';
    pickerOverlay.style.height = '100%';
    pickerOverlay.style.zIndex = '2147483647'; // Highest possible z-index
    pickerOverlay.style.cursor = 'crosshair';
    pickerOverlay.style.backgroundColor = 'transparent';
    
    // Create a custom cursor for better precision
    pickerCursor = document.createElement('div');
    pickerCursor.className = 'picker-cursor';
    
    // Create color info box
    colorInfoBox = document.createElement('div');
    colorInfoBox.className = 'color-info-box';
    
    // Create magnifying glass
    magnifierGlass = createMagnifier();
    
    // Create standalone info box for better visibility
    createStandaloneInfoBox();
    
    // Add elements to the page
    document.body.appendChild(pickerOverlay);
    document.body.appendChild(magnifierGlass);
    document.body.appendChild(pickerCursor);
    document.body.appendChild(colorInfoBox);
    
    // Add event listeners - use capture option for guaranteed event processing
    pickerOverlay.addEventListener('mousemove', handleMouseMove, { capture: true, passive: false });
    pickerOverlay.addEventListener('click', handleMouseClick, { capture: true, passive: false });
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    
    // Initial cursor position - set to center of screen
    const initialX = window.innerWidth / 2;
    const initialY = window.innerHeight / 2;
    pickerCursor.style.left = `${initialX}px`;
    pickerCursor.style.top = `${initialY}px`;
    
    // Force an initial update of the magnifier
    setTimeout(() => {
      // Make sure overlay still exists before dispatching event
      if (pickerOverlay) {
        const initialEvent = new MouseEvent('mousemove', {
          clientX: initialX,
          clientY: initialY,
          bubbles: true
        });
        pickerOverlay.dispatchEvent(initialEvent);
      }
    }, 50);
    
    // Disable scrolling while picker is active
    document.body.style.overflow = 'hidden';
    
    console.log('ChromaCode: Custom picker initialized successfully');
  } catch (error) {
    pickerActive = false;
    console.error('ChromaCode: Error initializing custom picker:', error);
    throw error;
  }
}

// Stop the color picker
function stopColorPicker(): void {
  console.log('ChromaCode: Stopping picker');
  
  if (!pickerActive) {
    console.log('ChromaCode: Picker not active');
    return;
  }
  
  pickerActive = false;
  
  try {
    // Remove elements
    if (pickerOverlay && pickerOverlay.parentNode) {
      pickerOverlay.removeEventListener('mousemove', handleMouseMove, { capture: true });
      pickerOverlay.removeEventListener('click', handleMouseClick, { capture: true });
      pickerOverlay.remove();
    }
    
    if (pickerCursor && pickerCursor.parentNode) {
      pickerCursor.remove();
    }
    
    if (colorInfoBox && colorInfoBox.parentNode) {
      colorInfoBox.remove();
    }
    
    if (magnifierGlass && magnifierGlass.parentNode) {
      magnifierGlass.remove();
    }
    
    // Remove standalone info box
    removeStandaloneInfoBox();
    
    // Remove event listeners
    document.removeEventListener('keydown', handleKeyDown, { capture: true });
    
    // Re-enable scrolling
    document.body.style.overflow = '';
    
    pickerOverlay = null;
    pickerCursor = null;
    colorInfoBox = null;
    magnifierGlass = null;
    magnifierCanvas = null;
    
    console.log('ChromaCode: Picker stopped successfully');
  } catch (error) {
    console.error('ChromaCode: Error stopping picker:', error);
  }
}

// Handle mouse movement to show color under cursor
function handleMouseMove(e: MouseEvent): void {
  if (!pickerActive) return;
  
  try {
    // Store mouse position
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // Throttle updates for better performance
    const now = Date.now();
    if (now - lastUpdateTime < throttleDelay) return;
    lastUpdateTime = now;
    
    // Skip if position hasn't changed enough (avoid micro-movements)
    if (Math.abs(mouseX - lastProcessedPosition.x) < 2 && 
        Math.abs(mouseY - lastProcessedPosition.y) < 2) {
      return;
    }
    
    // Update position
    lastProcessedPosition = { x: mouseX, y: mouseY };
    
    // Update cursor position
    if (pickerCursor) {
      pickerCursor.style.left = mouseX + 'px';
      pickerCursor.style.top = mouseY + 'px';
      pickerCursor.style.display = 'block';
    }
    
    // Update magnifier position if available
    if (magnifierGlass) {
      const magnifierRadius = MAGNIFIER_SIZE / 2;
      
      // Position the magnifier near the cursor, but avoid going off screen
      let magnifierX = mouseX + 30;
      let magnifierY = mouseY - magnifierRadius - 20;
      
      // If too close to top of window, move below cursor
      if (magnifierY < 20) {
        magnifierY = mouseY + 30;
      }
      
      // If too close to right edge, move to left of cursor
      if (magnifierX + MAGNIFIER_SIZE > window.innerWidth - 20) {
        magnifierX = mouseX - MAGNIFIER_SIZE - 30;
      }
      
      magnifierGlass.style.left = magnifierX + 'px';
      magnifierGlass.style.top = magnifierY + 'px';
      magnifierGlass.style.display = 'block';
      
      // Update magnifier view
      updateMagnifierView(mouseX, mouseY);
    }
    
    // Update the standalone info box
    if (standaloneInfoBox) {
      // Position the info box
      positionStandaloneInfoBox(mouseX, mouseY);
      
      // Update with the current center pixel color
      updateStandaloneInfoBox(currentCenterPixelColor);
    }
  } catch (error: any) {
    console.error('ChromaCode: Error tracking mouse:', error);
  }
}

// Handle mouse click to select a color
function handleMouseClick(e: MouseEvent): void {
  if (!pickerActive) return;
  
  try {
    // Prevent default behavior and stop propagation
    e.preventDefault();
    e.stopPropagation();
    
    // Get the color at the exact cursor position
    const cursorX = Math.round(e.clientX);
    const cursorY = Math.round(e.clientY);
    
    // Get the element under the cursor for more precise color picking
    const targetElement = document.elementFromPoint(cursorX, cursorY);
    
    // Get the color, prioritizing the magnifier's center pixel color
    // which should be the most accurate representation
    let selectedColor = currentCenterPixelColor;
    
    // Validate the color format - should be a proper hex color
    if (!selectedColor.match(/^#[0-9A-Fa-f]{6}$/)) {
      console.error('ChromaCode: Invalid center pixel color format:', selectedColor);
      // Try to fix the color format if possible
      if (selectedColor.match(/^[0-9A-Fa-f]{6}$/)) {
        selectedColor = '#' + selectedColor;
      } else {
        // Fall back to a default color
        selectedColor = '#808080';
      }
    }
    
    // Double-check by directly sampling at click position
    if (targetElement) {
      const directColor = getColorAtPoint(cursorX, cursorY, targetElement);
      
      // If the colors differ significantly and the direct color isn't transparent,
      // we'll take the direct color as it might be more accurate for some elements
      if (directColor !== selectedColor && 
          directColor !== '#ffffff' && 
          directColor !== '#000000' &&
          !isTransparentLike(directColor)) {
        console.log('ChromaCode: Direct color differs from magnifier:', directColor, selectedColor);
        
        // Check if the currentCenterPixelColor is grayscale (R=G=B)
        const isGrayscale = isGrayscaleColor(selectedColor);
        const isDirectGrayscale = isGrayscaleColor(directColor);
        
        // If magnifier color is grayscale but direct color isn't, use direct color
        if (isGrayscale && !isDirectGrayscale) {
          console.log('ChromaCode: Using direct color because magnifier color is grayscale');
          selectedColor = directColor;
        }
      }
    }
    
    console.log('ChromaCode: Final color selected:', selectedColor);
    
    // Show visual feedback that color was selected
    if (pickerCursor) {
      // Store original size to restore
      const originalSize = pickerCursor.style.width;
      const originalBorder = pickerCursor.style.border;
      
      // Update cursor style to show the selected color
      pickerCursor.style.backgroundColor = selectedColor;
      pickerCursor.style.border = `2px solid ${selectedColor}`;
      
      // Apply the active animation
      pickerCursor.classList.add('active');
      
      // Delay sending the color to provide visual feedback
      setTimeout(() => {
        // Restore cursor style
        if (pickerCursor) {
          pickerCursor.style.width = originalSize;
          pickerCursor.style.border = originalBorder;
          pickerCursor.classList.remove('active');
        }
        
        console.log('ChromaCode: Sending picked color to background:', selectedColor);
        
        // Send the selected color to the background script
        // Note: The background script is expecting 'colorPicked' action
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
        
        // Stop the color picker
        stopColorPicker();
      }, 350);
    } else {
      // If cursor element isn't available, just send the color immediately
      console.log('ChromaCode: Sending picked color to background (no animation):', selectedColor);
      
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
      
      stopColorPicker();
    }
  } catch (error: any) {
    console.error('ChromaCode: Error handling click:', error);
    
    // Send error and stop picker
    chrome.runtime.sendMessage({
      action: 'colorPickError',
      error: error.message || 'Unknown error during color selection'
    });
    
    stopColorPicker();
  }
}

// Helper to check if a color is transparent or close to transparent
function isTransparentLike(color: string): boolean {
  return color === 'transparent' || 
         color === 'rgba(0, 0, 0, 0)' || 
         color.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(\.\d+)?\s*\)/) !== null;
}

// Helper to check if a color is grayscale (all RGB channels equal)
function isGrayscaleColor(hexColor: string): boolean {
  // Remove the # if present
  const hex = hexColor.replace('#', '');
  
  // Handle 6-digit hex
  if (hex.length === 6) {
    const r = hex.substring(0, 2);
    const g = hex.substring(2, 4);
    const b = hex.substring(4, 6);
    
    return r === g && g === b;
  }
  
  // Handle 3-digit hex
  if (hex.length === 3) {
    return hex[0] === hex[1] && hex[1] === hex[2];
  }
  
  return false;
}

// Handle ESC key to cancel color picking
function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && pickerActive) {
    console.log('ChromaCode: ESC pressed, canceling picker');
    stopColorPicker();
  }
}

// Get the color at a specific point on the screen
function getColorAtPoint(x: number, y: number, element?: Element): string {
  // Round coordinates to ensure exact pixel targeting
  x = Math.round(x);
  y = Math.round(y);
  
  try {
    // Special handling for image elements - they're the most accurate
    if (element && element.tagName === 'IMG' && (element as HTMLImageElement).complete) {
      try {
        const imgElement = element as HTMLImageElement;
        const rect = imgElement.getBoundingClientRect();
        
        // Calculate position within the image
        const imageX = x - rect.left;
        const imageY = y - rect.top;
        
        // Only proceed if we're within the image bounds
        if (imageX >= 0 && imageX < rect.width && imageY >= 0 && imageY < rect.height) {
          // Create a canvas to get the image data
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
          
          if (context) {
            // Scale coordinates to match the natural image size
            const scaleX = imgElement.naturalWidth / rect.width;
            const scaleY = imgElement.naturalHeight / rect.height;
            const scaledX = Math.round(imageX * scaleX);
            const scaledY = Math.round(imageY * scaleY);
            
            // Set size big enough to hold the image
            canvas.width = imgElement.naturalWidth;
            canvas.height = imgElement.naturalHeight;
            
            // Draw image to canvas
            context.drawImage(imgElement, 0, 0);
            
            try {
              // Get pixel data
              const pixelData = context.getImageData(scaledX, scaledY, 1, 1).data;
              // Always use hex - no transparency
              return rgbToHex(pixelData[0], pixelData[1], pixelData[2]);
            } catch (e) {
              console.error('ChromaCode: Image color extraction error:', e);
            }
          }
        }
      } catch (e) {
        console.error('ChromaCode: Image processing error:', e);
      }
    }
    
    // For non-image elements, we'll use a more sophisticated approach
    // to get the exact rendered color at a point
    
    // Get the window's device pixel ratio for accurate rendering
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Create a canvas for capturing the element's appearance
    const canvas = document.createElement('canvas');
    canvas.width = 3 * pixelRatio;
    canvas.height = 3 * pixelRatio;
    
    const context = canvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: false // Disable alpha to ensure solid colors
    });
    
    if (!context) {
      console.error('ChromaCode: Could not get canvas context');
      return '#ffffff';
    }
    
    // Use html2canvas-like approach for complex elements
    if (element && !(element instanceof HTMLImageElement)) {
      try {
        // Try CSS computed color first - often more accurate for solid colors
        const style = window.getComputedStyle(element);
        let elementColor = style.backgroundColor;
        
        // If background color exists and isn't transparent, use it directly
        if (elementColor && elementColor !== 'rgba(0, 0, 0, 0)' && elementColor !== 'transparent') {
          return removeTransparency(elementColor.startsWith('#') ? elementColor : rgbStringToHex(elementColor));
        }
        
        // For text, use the text color
        const textColor = style.color;
        if (element.textContent && textColor && textColor !== 'rgba(0, 0, 0, 0)' && textColor !== 'transparent') {
          // Check if the click point is within or close to text content
          const range = document.createRange();
          range.selectNodeContents(element);
          const rects = range.getClientRects();
          
          for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
              return removeTransparency(textColor.startsWith('#') ? textColor : rgbStringToHex(textColor));
            }
          }
        }
      } catch (e) {
        console.error('ChromaCode: Error getting element computed style:', e);
      }
    }
    
    // Fall back to bitmap sampling approach
    // Position our sampling canvas - completely hidden
    canvas.style.position = 'absolute';
    canvas.style.left = (x - 1) + 'px';
    canvas.style.top = (y - 1) + 'px';
    canvas.style.width = '3px';
    canvas.style.height = '3px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '-1';
    canvas.style.opacity = '0';
    
    // Temporarily hide our color picker UI
    let overlayDisplay = 'none';
    let cursorDisplay = 'none';
    let infoBoxDisplay = 'none';
    let magnifierDisplay = 'none';
    
    if (pickerOverlay && pickerOverlay.style) {
      overlayDisplay = pickerOverlay.style.display;
      pickerOverlay.style.display = 'none';
    }
    
    if (pickerCursor && pickerCursor.style) {
      cursorDisplay = pickerCursor.style.display;
      pickerCursor.style.display = 'none';
    }
    
    if (colorInfoBox && colorInfoBox.style) {
      infoBoxDisplay = colorInfoBox.style.display;
      colorInfoBox.style.display = 'none';
    }
    
    if (magnifierGlass && magnifierGlass.style) {
      magnifierDisplay = magnifierGlass.style.display;
      magnifierGlass.style.display = 'none';
    }
    
    // Add the canvas to the page temporarily
    document.body.appendChild(canvas);
    
    // If we don't have a specific element, find one
    if (!element) {
      element = document.elementFromPoint(x, y) || undefined;
    }
    
    // For complex elements or unknown situations, try to capture screen at that point
    if (element) {
      // Try to get actual rendered appearance
      try {
        // Fill with white background as default
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        // Try to get the page's background color
        const bodyStyle = window.getComputedStyle(document.body);
        const bodyColor = bodyStyle.backgroundColor;
        if (bodyColor && bodyColor !== 'rgba(0, 0, 0, 0)' && bodyColor !== 'transparent') {
          context.fillStyle = removeTransparency(bodyColor);
          context.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          const htmlStyle = window.getComputedStyle(document.documentElement);
          const htmlColor = htmlStyle.backgroundColor;
          if (htmlColor && htmlColor !== 'rgba(0, 0, 0, 0)' && htmlColor !== 'transparent') {
            context.fillStyle = removeTransparency(htmlColor);
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
        }
        
        // Get element's color
        const elemStyle = window.getComputedStyle(element);
        let bgColor = elemStyle.backgroundColor;
        
        // If element has a visible background, draw it
        if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
          context.fillStyle = removeTransparency(bgColor);
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
      } catch (e) {
        console.error('ChromaCode: Error getting element appearance:', e);
      }
    }
    
    // Get the center pixel color
    const centerX = Math.floor(canvas.width / 2);
    const centerY = Math.floor(canvas.height / 2);
    let pixelData;
    
    try {
      // Sample a 1x1 pixel from the center of our canvas
      pixelData = context.getImageData(centerX, centerY, 1, 1).data;
    } catch (e) {
      console.error('ChromaCode: Error reading pixel data:', e);
      
      // Fall back to element's computed style
      if (element) {
        const style = window.getComputedStyle(element);
        let color = style.backgroundColor;
        
        // If background is transparent, try text color
        if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
          color = style.color;
        }
        
        // Clean up and restore UI elements
        canvas.remove();
        
        if (pickerOverlay) pickerOverlay.style.display = overlayDisplay;
        if (pickerCursor) pickerCursor.style.display = cursorDisplay;
        if (colorInfoBox) colorInfoBox.style.display = infoBoxDisplay;
        if (magnifierGlass) magnifierGlass.style.display = magnifierDisplay;
        
        return removeTransparency(color.startsWith('#') ? color : rgbStringToHex(color));
      }
      
      // If all else fails, return white
      return '#ffffff';
    }
    
    // Clean up
    canvas.remove();
    
    // Restore our UI elements
    if (pickerOverlay) pickerOverlay.style.display = overlayDisplay;
    if (pickerCursor) pickerCursor.style.display = cursorDisplay;
    if (colorInfoBox) colorInfoBox.style.display = infoBoxDisplay;
    if (magnifierGlass) magnifierGlass.style.display = magnifierDisplay;
    
    // Always return a solid color - no transparency
    return rgbToHex(pixelData[0], pixelData[1], pixelData[2]);
  } catch (error) {
    console.error('ChromaCode: Error in getColorAtPoint:', error);
    
    // Fall back to simplified approach if our main approach fails
    if (element) {
      try {
        const style = window.getComputedStyle(element);
        let color = style.backgroundColor;
        
        // If background is transparent, try text color
        if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
          color = style.color;
        }
        
        // If we got a valid color, use it
        if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
          return removeTransparency(color.startsWith('#') ? color : rgbStringToHex(color));
        }
      } catch (e) {
        console.error('ChromaCode: Error getting element style:', e);
      }
    }
    
    // Return a default if all else fails
    return '#333333'; // Using a dark gray as default is often better than white
  }
}

// Convert RGB values to hex color
function rgbToHex(r: number, g: number, b: number): string {
  // Ensure values are in valid range
  r = Math.max(0, Math.min(255, Math.round(r)));
  g = Math.max(0, Math.min(255, Math.round(g)));
  b = Math.max(0, Math.min(255, Math.round(b)));
  
  // Use proper padding to ensure each value is two hex digits
  return '#' + 
    r.toString(16).padStart(2, '0') + 
    g.toString(16).padStart(2, '0') + 
    b.toString(16).padStart(2, '0');
}

// Convert RGB string to hex color
function rgbStringToHex(rgb: string): string {
  // Handle 'rgb(r, g, b)' format
  const rgbMatch = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    return rgbToHex(parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3]));
  }
  
  // Handle 'rgba(r, g, b, a)' format
  const rgbaMatch = rgb.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i);
  if (rgbaMatch) {
    return rgbToHex(parseInt(rgbaMatch[1]), parseInt(rgbaMatch[2]), parseInt(rgbaMatch[3]));
  }
  
  return '#ffffff'; // Default fallback
}

// Get a contrasting color (black or white) based on the background
function getContrastColor(hexColor: string): string {
  // Remove the # if present
  hexColor = hexColor.replace('#', '');
  
  // Convert to RGB
  const r = parseInt(hexColor.substr(0, 2), 16);
  const g = parseInt(hexColor.substr(2, 2), 16);
  const b = parseInt(hexColor.substr(4, 2), 16);
  
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Return black for bright colors, white for dark colors
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

// Convert hex color to RGB string
function contentHexToRgb(hex: string): string {
  // Remove the # if present
  hex = hex.replace('#', '');
  
  // Handle RGB format
  if (hex.match(/^rgba?\(/)) {
    return hex;
  }
  
  // Handle short hex format (e.g. #FFF)
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  
  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Return RGB format
  return `RGB(${r}, ${g}, ${b})`;
}

// Remove transparency from a color, blending with white background
function removeTransparency(color: string): string {
  try {
    // If already a hex color without transparency, return as is
    if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
      return color;
    }
    
    // Handle rgb/rgba format
    if (color.startsWith('rgb')) {
      const parts = color.match(/[\d.]+/g);
      if (!parts) return '#ffffff';
      
      if (parts.length >= 3) {
        // RGB values
        const r = parseInt(parts[0], 10);
        const g = parseInt(parts[1], 10);
        const b = parseInt(parts[2], 10);
        
        // If it's rgba with alpha channel
        if (parts.length >= 4) {
          const alpha = parseFloat(parts[3]);
          
          // Blend with white background if has transparency
          if (alpha < 1) {
            // Simple alpha blending formula: C_result = C_fg * alpha + C_bg * (1 - alpha)
            // Where background (C_bg) is white (255, 255, 255)
            const blendedR = Math.round(r * alpha + 255 * (1 - alpha));
            const blendedG = Math.round(g * alpha + 255 * (1 - alpha));
            const blendedB = Math.round(b * alpha + 255 * (1 - alpha));
            
            return rgbToHex(blendedR, blendedG, blendedB);
          }
        }
        
        // For solid colors, just convert to hex
        return rgbToHex(r, g, b);
      }
    }
    
    // For any other format or parsing failure, return white instead of a neutral gray
    return '#ffffff';
  } catch (error) {
    console.error('ChromaCode: Error removing transparency:', error);
    return '#ffffff';
  }
}

// Create the magnifier component
function createMagnifier(): HTMLElement {
  try {
    const magnifier = document.createElement('div');
    magnifier.id = 'magnifier-glass';
    magnifier.className = 'magnifier-glass';
    magnifier.style.cssText = 'pointer-events: none; position: fixed; z-index: 2147483647; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.3); overflow: hidden; width: 150px; height: 150px; display: none;';
    
    // Create canvas for the magnification
    magnifierCanvas = document.createElement('canvas');
    magnifierCanvas.width = MAGNIFIER_SIZE;
    magnifierCanvas.height = MAGNIFIER_SIZE;
    magnifierCanvas.style.cssText = 'width: 100%; height: 100%; position: absolute; top: 0; left: 0;';
    
    // Get canvas context for drawing
    magnifierContext = magnifierCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
    if (!magnifierContext) {
      console.error('ChromaCode: Could not get canvas context for magnifier');
      throw new Error('Could not create canvas context');
    }
    
    // Initial fill
    magnifierContext.fillStyle = '#ffffff';
    magnifierContext.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
    
    magnifier.appendChild(magnifierCanvas);
    return magnifier;
  } catch (error) {
    console.error('ChromaCode: Error creating magnifier:', error);
    throw error;
  }
}

// Update the magnifier view to show magnified pixels around the cursor
function updateMagnifierView(x: number, y: number): void {
  if (!magnifierCanvas || !magnifierContext) {
    console.error('ChromaCode: Magnifier canvas or context is not available');
    return;
  }

  try {
    // Get the actual screen pixel ratio for high-DPI displays
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Calculate the area to capture based on the magnifier size and zoom factor
    const captureSize = Math.ceil(MAGNIFIER_SIZE / ZOOM_FACTOR);
    const halfCaptureSize = Math.floor(captureSize / 2);
    
    // Round coordinates to whole pixels
    const cursorX = Math.round(x);
    const cursorY = Math.round(y);

    // Create a temporary canvas for the screen capture
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = captureSize * pixelRatio;
    tempCanvas.height = captureSize * pixelRatio;
    
    const tempContext = tempCanvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: false // No transparency to ensure colors are accurate
    });
    
    if (!tempContext) {
      console.error('ChromaCode: Could not get temporary canvas context');
      return;
    }
    
    // Fill with white background
    tempContext.fillStyle = '#ffffff';
    tempContext.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    // Temporarily hide color picker UI to get accurate colors
    const elementsToHide = [pickerOverlay, pickerCursor, colorInfoBox, magnifierGlass];
    const originalVisibility: {element: HTMLElement | null, style: string}[] = [];
    
    // Store original visibility and hide elements
    elementsToHide.forEach(element => {
      if (element && element.style) {
        originalVisibility.push({
          element,
          style: element.style.display
        });
        element.style.display = 'none';
      }
    });
    
    try {
      // Get all elements at and around the cursor position
      const areaElements: Element[] = [];
      const visited = new Set<Element>();
      
      // Sample points in a grid pattern around the cursor - use smaller step for better coverage
      for (let offsetX = -halfCaptureSize; offsetX <= halfCaptureSize; offsetX += 2) {
        for (let offsetY = -halfCaptureSize; offsetY <= halfCaptureSize; offsetY += 2) {
          const sampleX = cursorX + offsetX;
          const sampleY = cursorY + offsetY;
          
          // Skip if outside viewport
          if (sampleX < 0 || sampleX >= window.innerWidth || 
              sampleY < 0 || sampleY >= window.innerHeight) {
            continue;
          }
          
          const elements = document.elementsFromPoint(sampleX, sampleY);
          for (const element of elements) {
            if (!visited.has(element) && 
                !elementsToHide.includes(element as HTMLElement) && 
                element !== document.documentElement && 
                element !== document.body) {
              visited.add(element);
              areaElements.push(element);
            }
          }
        }
      }
      
      // Sort elements by z-index and position in the DOM
      // Reverse the order to get proper visual stacking (highest z-index last)
      areaElements.sort((a, b) => {
        const aStyle = window.getComputedStyle(a);
        const bStyle = window.getComputedStyle(b);
        const aZIndex = parseInt(aStyle.zIndex) || 0;
        const bZIndex = parseInt(bStyle.zIndex) || 0;
        
        // First compare z-index
        if (aZIndex !== bZIndex) return aZIndex - bZIndex;
        
        // If same z-index, use DOM position as a tiebreaker
        const aPosition = getDOMPosition(a);
        const bPosition = getDOMPosition(b);
        return aPosition - bPosition;
      });
      
      // Get page background color
      const bodyBgColor = getComputedStyle(document.body).backgroundColor;
      const htmlBgColor = getComputedStyle(document.documentElement).backgroundColor;
      
      // Draw background color
      if (bodyBgColor && bodyBgColor !== 'rgba(0, 0, 0, 0)' && bodyBgColor !== 'transparent') {
        tempContext.fillStyle = removeTransparency(bodyBgColor);
        tempContext.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      } else if (htmlBgColor && htmlBgColor !== 'rgba(0, 0, 0, 0)' && htmlBgColor !== 'transparent') {
        tempContext.fillStyle = removeTransparency(htmlBgColor);
        tempContext.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      }
      
      // Render each element to the canvas
      for (const element of areaElements) {
        renderElementToCanvas(element, tempContext, cursorX, cursorY, halfCaptureSize, pixelRatio);
      }
      
      // Get the center pixel color
      const centerX = Math.floor(tempCanvas.width / 2);
      const centerY = Math.floor(tempCanvas.height / 2);
      
      try {
        // Get pixel data with a small area around the center for better color sampling
        const pixelData = tempContext.getImageData(
          centerX - 1, 
          centerY - 1, 
          3, 
          3
        ).data;
        
        // Calculate the average RGB values from the sample area for more accurate color
        let totalR = 0, totalG = 0, totalB = 0;
        
        // Process each pixel in our 3x3 sample
        for (let i = 0; i < 9; i++) {
          const pixelIndex = i * 4; // Each pixel has 4 values (r,g,b,a)
          totalR += pixelData[pixelIndex];
          totalG += pixelData[pixelIndex + 1];
          totalB += pixelData[pixelIndex + 2];
        }
        
        // Calculate the average color
        const avgR = Math.round(totalR / 9);
        const avgG = Math.round(totalG / 9);
        const avgB = Math.round(totalB / 9);
        
        // Use the average if it's not a grayscale color
        if (!(avgR === avgG && avgG === avgB)) {
          currentCenterPixelColor = rgbToHex(avgR, avgG, avgB);
        } else {
          // If it's grayscale, try the exact center pixel directly
          const centerPixel = tempContext.getImageData(centerX, centerY, 1, 1).data;
          currentCenterPixelColor = rgbToHex(centerPixel[0], centerPixel[1], centerPixel[2]);
        }
        
        // Log the color for debugging
        console.log('ChromaCode: Center pixel color:', currentCenterPixelColor);
      } catch (error) {
        console.error('ChromaCode: Error getting center pixel:', error);
        // Fall back to element's computed color
        const centerElement = document.elementFromPoint(cursorX, cursorY);
        if (centerElement) {
          const style = getComputedStyle(centerElement);
          const bgColor = style.backgroundColor;
          
          if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
            currentCenterPixelColor = removeTransparency(bgColor);
          } else if (centerElement.textContent && style.color) {
            currentCenterPixelColor = removeTransparency(style.color);
          } else {
            currentCenterPixelColor = '#808080'; // Neutral gray
          }
        }
      }
      
      // Draw to the magnifier
      if (magnifierContext) {
        // Clear with white background
        magnifierContext.fillStyle = '#ffffff';
        magnifierContext.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
        
        // Disable image smoothing for a crisp pixelated look
        magnifierContext.imageSmoothingEnabled = false;
        
        // Draw the captured content with zoom
        magnifierContext.drawImage(
          tempCanvas, 
          0, 0, tempCanvas.width, tempCanvas.height,
          0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE
        );
        
        // Add crosshair
        drawMagnifierCrosshair(magnifierContext);
        
        // Draw color info
        drawColorInfoInMagnifier(magnifierContext, currentCenterPixelColor);
      }
      
    } catch (error) {
      console.error('ChromaCode: Error capturing screen content:', error);
    } finally {
      // Restore visibility of hidden elements
      originalVisibility.forEach(({element, style}) => {
        if (element) element.style.display = style;
      });
    }
  } catch (error: any) {
    console.error('ChromaCode: Error updating magnifier view:', error);
  }
}

// Get element's position in the DOM tree (for z-ordering)
function getDOMPosition(element: Element): number {
  let position = 0;
  let current = element;
  
  while (current.previousElementSibling) {
    position++;
    current = current.previousElementSibling;
  }
  
  if (current.parentElement && current.parentElement !== document.documentElement) {
    position += 1000 * getDOMPosition(current.parentElement); // Parent weight
  }
  
  return position;
}

// Render a specific element to the canvas
function renderElementToCanvas(
  element: Element, 
  context: CanvasRenderingContext2D,
  cursorX: number, 
  cursorY: number, 
  halfCaptureSize: number,
  pixelRatio: number
): void {
  try {
    const rect = element.getBoundingClientRect();
    
    // Convert element position to canvas coordinates
    const elementX = (rect.left - (cursorX - halfCaptureSize)) * pixelRatio;
    const elementY = (rect.top - (cursorY - halfCaptureSize)) * pixelRatio;
    const elementWidth = rect.width * pixelRatio;
    const elementHeight = rect.height * pixelRatio;
    
    // Skip elements too small or outside of our capture area
    if (elementWidth < 1 || elementHeight < 1 || 
        elementX + elementWidth < 0 || elementY + elementHeight < 0 ||
        elementX > context.canvas.width || elementY > context.canvas.height) {
      return;
    }
    
    const computedStyle = window.getComputedStyle(element);
    
    // Handle images with special care - highest priority for accuracy
    if (element instanceof HTMLImageElement && element.complete) {
      renderImageElement(element, context, rect, cursorX, cursorY, halfCaptureSize, pixelRatio);
      return;
    }
    
    // Get element background properties
    const bgColor = computedStyle.backgroundColor;
    const hasBgColor = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';
    
    // Process element background
    if (hasBgColor) {
      // Draw the background
      context.fillStyle = removeTransparency(bgColor);
      context.fillRect(elementX, elementY, elementWidth, elementHeight);
    }
    
    // Check if element has background image
    const bgImage = computedStyle.backgroundImage;
    if (bgImage && bgImage !== 'none') {
      // Can't directly render background images due to security restrictions,
      // but we can approximate with better colored patterns
      try {
        // If it's a gradient, use colorful approximation
        if (bgImage.includes('gradient')) {
          // Try to extract colors from gradient string
          const colorMatches = bgImage.match(/#[0-9a-f]{3,6}|rgba?\([^)]+\)/gi);
          
          if (colorMatches && colorMatches.length > 0) {
            // Use actual gradient colors if we could extract them
            const startColor = removeTransparency(colorMatches[0]);
            let endColor = colorMatches.length > 1 ? 
              removeTransparency(colorMatches[colorMatches.length-1]) : 
              startColor;
              
            // Create a simple two-color gradient simulation
            const gradient = context.createLinearGradient(
              elementX, elementY, 
              elementX + elementWidth, elementY + elementHeight
            );
            gradient.addColorStop(0, startColor);
            gradient.addColorStop(1, endColor);
            
            context.fillStyle = gradient;
            context.fillRect(elementX, elementY, elementWidth, elementHeight);
          } else {
            // Fallback to a colorful pattern if we couldn't extract gradient colors
            const gradientColors = [
              '#3498db', '#2ecc71', '#9b59b6', '#e74c3c', '#f1c40f'
            ];
            
            // Draw colorful lines to simulate gradient
            for (let i = 0; i < elementHeight; i += 4) {
              const colorIndex = Math.floor((i / elementHeight) * gradientColors.length);
              context.fillStyle = gradientColors[colorIndex];
              context.fillRect(elementX, elementY + i, elementWidth, 3);
            }
          }
        } else if (bgImage.includes('url')) {
          // For image URLs, use a colorful pattern instead of grayscale
          
          // First, try to extract image colors if possible
          let hasExtractedColors = false;
          
          // If that fails, use a colorful checkerboard pattern
          if (!hasExtractedColors) {
            // Draw a colorful checkerboard pattern to indicate an image
            const colors = ['#f3e5f5', '#e1bee7', '#ce93d8', '#ba68c8'];
            const tileSize = 8;
            
            for (let i = 0; i < elementWidth; i += tileSize) {
              for (let j = 0; j < elementHeight; j += tileSize) {
                const colorIndex = (Math.floor(i / tileSize) + Math.floor(j / tileSize)) % colors.length;
                context.fillStyle = colors[colorIndex];
                context.fillRect(elementX + i, elementY + j, tileSize, tileSize);
              }
            }
            
            // Draw border to indicate this is an image
            context.strokeStyle = '#9c27b0';
            context.lineWidth = 1;
            context.strokeRect(elementX, elementY, elementWidth, elementHeight);
          }
        }
      } catch (e) {
        console.error('ChromaCode: Error rendering background image:', e);
      }
    }
    
    // Handle text with improved rendering
    if (element.textContent && element.textContent.trim() !== '') {
      renderTextElement(element, context, elementX, elementY, elementWidth, elementHeight, computedStyle);
    }
    
    // Handle borders if present and visible
    renderElementBorders(element, context, elementX, elementY, elementWidth, elementHeight, computedStyle);
    
    // Handle box-shadow if present
    const boxShadow = computedStyle.boxShadow;
    if (boxShadow && boxShadow !== 'none') {
      // Simplify by just drawing a dark outline
      context.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      context.lineWidth = 2;
      context.strokeRect(elementX - 1, elementY - 1, elementWidth + 2, elementHeight + 2);
    }
  } catch (error) {
    console.error('ChromaCode: Error rendering element:', error);
  }
}

// Render image elements with high fidelity
function renderImageElement(
  imgElement: HTMLImageElement,
  context: CanvasRenderingContext2D,
  rect: DOMRect,
  cursorX: number,
  cursorY: number,
  halfCaptureSize: number,
  pixelRatio: number
): void {
  try {
    // Calculate the visible portion of the image
    const visibleLeft = Math.max(0, rect.left);
    const visibleTop = Math.max(0, rect.top);
    const visibleRight = Math.min(window.innerWidth, rect.right);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    
    // Skip if image is not visible
    if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
      return;
    }
    
    // Calculate image portion relative to the capture area
    const canvasX = (visibleLeft - (cursorX - halfCaptureSize)) * pixelRatio;
    const canvasY = (visibleTop - (cursorY - halfCaptureSize)) * pixelRatio;
    const canvasWidth = (visibleRight - visibleLeft) * pixelRatio;
    const canvasHeight = (visibleBottom - visibleTop) * pixelRatio;
    
    // Calculate which portion of the original image to use
    const imgX = (visibleLeft - rect.left) / rect.width * imgElement.naturalWidth;
    const imgY = (visibleTop - rect.top) / rect.height * imgElement.naturalHeight;
    const imgWidth = (visibleRight - visibleLeft) / rect.width * imgElement.naturalWidth;
    const imgHeight = (visibleBottom - visibleTop) / rect.height * imgElement.naturalHeight;
    
    // Special handling for SVG images to preserve colors
    const isSvg = imgElement.src.toLowerCase().endsWith('.svg') || 
                 imgElement.src.toLowerCase().includes('image/svg');
    
    if (isSvg) {
      // For SVGs, we'll try to preserve colors by using an intermediate canvas
      try {
        const svgCanvas = document.createElement('canvas');
        svgCanvas.width = imgElement.naturalWidth;
        svgCanvas.height = imgElement.naturalHeight;
        
        const svgContext = svgCanvas.getContext('2d', { alpha: false });
        if (svgContext) {
          // Use color-preserving rendering
          svgContext.fillStyle = '#ffffff'; // White background to avoid transparency issues
          svgContext.fillRect(0, 0, svgCanvas.width, svgCanvas.height);
          
          // Draw the SVG with full color
          svgContext.drawImage(imgElement, 0, 0);
          
          // Then draw from our special canvas to the main context
          context.drawImage(
            svgCanvas,
            imgX, imgY, imgWidth, imgHeight,
            canvasX, canvasY, canvasWidth, canvasHeight
          );
          return;
        }
      } catch (svgError) {
        console.error('ChromaCode: Error rendering SVG image:', svgError);
      }
    }
    
    // For regular images, draw directly
    // Set image rendering for better quality on scaled images
    context.imageSmoothingEnabled = false;
    
    // Draw the image with its original colors
    context.drawImage(
      imgElement,
      imgX, imgY, imgWidth, imgHeight,
      canvasX, canvasY, canvasWidth, canvasHeight
    );
  } catch (error) {
    console.error('ChromaCode: Error rendering image:', error);
  }
}

// Render text content
function renderTextElement(
  element: Element,
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  style: CSSStyleDeclaration
): void {
  try {
    // First, render the background if any
    const bgColor = style.backgroundColor;
    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
      context.fillStyle = removeTransparency(bgColor);
      context.fillRect(x, y, width, height);
    }
    
    // Get the text color and approximate text position
    const textColor = style.color || '#000000';
    
    // Ensure we're using the actual text color, not a grayscale version
    // Parse the color and explicitly use the RGB values
    let finalTextColor = textColor;
    
    // If textColor is in RGB/RGBA format, ensure we're using its actual values
    if (textColor.startsWith('rgb')) {
      const parts = textColor.match(/[\d.]+/g);
      if (parts && parts.length >= 3) {
        const r = parseInt(parts[0], 10);
        const g = parseInt(parts[1], 10);
        const b = parseInt(parts[2], 10);
        
        // Only convert if it's not grayscale
        if (!(r === g && g === b)) {
          finalTextColor = rgbToHex(r, g, b);
        }
      }
    }
    
    context.fillStyle = removeTransparency(finalTextColor);
    
    // We can't render actual text to the canvas due to security restrictions,
    // but we can approximate its appearance with blocks
    const text = element.textContent || '';
    const textLength = text.length;
    
    if (textLength > 0) {
      // Get font properties
      const fontSize = parseInt(style.fontSize) || 16;
      const fontWeight = style.fontWeight; // bold, normal, etc.
      const isItalic = style.fontStyle === 'italic';
      const isUnderlined = style.textDecoration.includes('underline');
      
      // Scale font for better appearance in magnifier
      const scaledFontSize = fontSize * 0.8;
      const lineHeight = parseInt(style.lineHeight) || Math.ceil(fontSize * 1.2);
      const scaledLineHeight = lineHeight * 0.8;
      
      // Get text alignment
      const textAlign = style.textAlign || 'left';
      
      // Initial position
      let currentX = x + 2; // Small padding
      let currentY = y + scaledFontSize;
      
      // Handle different text alignments
      if (textAlign === 'center') {
        currentX = x + (width / 2) - ((textLength * scaledFontSize * 0.5) / 2);
      } else if (textAlign === 'right') {
        currentX = x + width - (textLength * scaledFontSize * 0.5) - 2;
      }
      
      // Make line breaks more visible by separating text into paragraphs
      const paragraphs = text.split(/\n|\r\n/);
      let yOffset = 0;
      
      for (const paragraph of paragraphs) {
        if (paragraph.trim() === '') {
          yOffset += scaledLineHeight * 1.5; // Extra space for paragraph breaks
          continue;
        }
        
        // Handle each paragraph's text
        let wordsX = currentX;
        const words = paragraph.split(/\s+/);
        
        for (const word of words) {
          if (word.trim() === '') {
            wordsX += scaledFontSize * 0.5; // Space between words
            continue;
          }
          
          // Calculate word width
          const wordWidth = word.length * scaledFontSize * 0.5;
          
          // Check if word needs to wrap to next line
          if (wordsX + wordWidth > x + width - 2) {
            wordsX = x + 2; // Reset X position
            yOffset += scaledLineHeight; // Move to next line
          }
          
          // Draw a more accurate word representation
          // Adjust height based on font weight (bold = taller)
          const fontHeightMultiplier = fontWeight === 'bold' || parseInt(fontWeight) >= 600 ? 0.9 : 0.8;
          const charHeight = scaledFontSize * fontHeightMultiplier;
          
          // Draw word as a single rectangle for better performance
          context.fillRect(
            wordsX, 
            currentY + yOffset - charHeight, 
            wordWidth, 
            charHeight
          );
          
          // Add underline if needed
          if (isUnderlined) {
            context.fillRect(
              wordsX,
              currentY + yOffset - charHeight + charHeight + 2,
              wordWidth,
              1
            );
          }
          
          // For italic, add a slant indicator
          if (isItalic) {
            context.fillRect(
              wordsX + wordWidth - 2,
              currentY + yOffset - charHeight,
              1,
              charHeight
            );
          }
          
          // Move to next word position
          wordsX += wordWidth + scaledFontSize * 0.3; // Space between words
        }
        
        // Move to next paragraph
        yOffset += scaledLineHeight * 1.2;
      }
    }
    
    // Render borders if any
    renderElementBorders(element, context, x, y, width, height, style);
  } catch (error) {
    console.error('ChromaCode: Error rendering text element:', error);
  }
}

// Render element borders if present
function renderElementBorders(
  element: Element,
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  style: CSSStyleDeclaration
): void {
  try {
    const borderTopWidth = parseInt(style.borderTopWidth) || 0;
    const borderRightWidth = parseInt(style.borderRightWidth) || 0;
    const borderBottomWidth = parseInt(style.borderBottomWidth) || 0;
    const borderLeftWidth = parseInt(style.borderLeftWidth) || 0;
    
    if (borderTopWidth > 0) {
      context.fillStyle = removeTransparency(style.borderTopColor);
      context.fillRect(x, y, width, borderTopWidth);
    }
    
    if (borderRightWidth > 0) {
      context.fillStyle = removeTransparency(style.borderRightColor);
      context.fillRect(x + width - borderRightWidth, y, borderRightWidth, height);
    }
    
    if (borderBottomWidth > 0) {
      context.fillStyle = removeTransparency(style.borderBottomColor);
      context.fillRect(x, y + height - borderBottomWidth, width, borderBottomWidth);
    }
    
    if (borderLeftWidth > 0) {
      context.fillStyle = removeTransparency(style.borderLeftColor);
      context.fillRect(x, y, borderLeftWidth, height);
    }
  } catch (error) {
    console.error('ChromaCode: Error rendering borders:', error);
  }
}

// Draw the crosshair in the magnifier
function drawMagnifierCrosshair(context: CanvasRenderingContext2D): void {
  // Draw the crosshair
  context.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  context.lineWidth = 1;
  
  // Horizontal line
  context.beginPath();
  context.moveTo(0, MAGNIFIER_SIZE / 2);
  context.lineTo(MAGNIFIER_SIZE, MAGNIFIER_SIZE / 2);
  context.stroke();
  
  // Vertical line
  context.beginPath();
  context.moveTo(MAGNIFIER_SIZE / 2, 0);
  context.lineTo(MAGNIFIER_SIZE / 2, MAGNIFIER_SIZE);
  context.stroke();
  
  // Draw crosshair in white for visibility
  context.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  context.lineWidth = 1;
  
  // Horizontal line
  context.beginPath();
  context.moveTo(0, MAGNIFIER_SIZE / 2 + 1);
  context.lineTo(MAGNIFIER_SIZE, MAGNIFIER_SIZE / 2 + 1);
  context.stroke();
  
  // Vertical line
  context.beginPath();
  context.moveTo(MAGNIFIER_SIZE / 2 + 1, 0);
  context.lineTo(MAGNIFIER_SIZE / 2 + 1, MAGNIFIER_SIZE);
  context.stroke();
}

// Draw color information in the magnifier
function drawColorInfoInMagnifier(context: CanvasRenderingContext2D, color: string): void {
  // Draw semi-transparent background for the info area
  const infoAreaHeight = 44; // Increased height for more info
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  context.fillRect(0, MAGNIFIER_SIZE - infoAreaHeight, MAGNIFIER_SIZE, infoAreaHeight);
  
  // Draw color swatch
  const swatchSize = 24; // Larger swatch
  const swatchY = MAGNIFIER_SIZE - swatchSize - 10;
  const swatchX = 8;
  
  // Draw color swatch with the center color
  context.fillStyle = color;
  context.fillRect(swatchX, swatchY, swatchSize, swatchSize);
  
  // Swatch border
  context.strokeStyle = '#ffffff';
  context.lineWidth = 1;
  context.strokeRect(swatchX, swatchY, swatchSize, swatchSize);
  
  // Calculate contrasting text color for better visibility
  const contrastColor = getContrastColor(color);
  
  // Add small indicator inside the swatch with contrast color
  context.fillStyle = contrastColor;
  context.fillRect(swatchX + swatchSize - 8, swatchY + swatchSize - 8, 6, 6);
  
  // Convert to RGB for display
  const rgbColor = hexToRgbString(color);
  
  // Draw the color info text
  context.font = 'bold 14px system-ui, -apple-system, sans-serif';
  context.fillStyle = '#ffffff';
  context.textAlign = 'left';
  
  // Draw HEX value
  context.fillText(color.toUpperCase(), swatchX + swatchSize + 8, swatchY + 14);
  
  // Draw RGB value in smaller font
  context.font = '12px system-ui, -apple-system, sans-serif';
  context.fillText(rgbColor, swatchX + swatchSize + 8, swatchY + 30);
}

// Convert hex color to RGB string for display
function hexToRgbString(hex: string): string {
  // Remove the # if present
  hex = hex.replace('#', '');
  
  // Handle short hex format (e.g. #FFF)
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  
  // Parse the hex values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Return RGB format
  return `RGB(${r}, ${g}, ${b})`;
} 