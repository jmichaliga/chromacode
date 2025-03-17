// Variables to track picking state
let isPickerActive: boolean = false;
let pickerOverlay: HTMLDivElement | null = null;
let pickerCursor: HTMLDivElement | null = null;
let colorInfoBox: HTMLDivElement | null = null;
let magnifierGlass: HTMLDivElement | null = null;
let magnifierCanvas: HTMLCanvasElement | null = null;
let lastProcessedPosition: ChromaCode.Position = { x: 0, y: 0 };
let throttleDelay: number = 30; // ms - controls how often we process mouse movements
let lastUpdateTime: number = 0;
const ZOOM_FACTOR: number = 6; // Magnification level
const MAGNIFIER_SIZE: number = 120; // Size of the magnifier in pixels
const MAGNIFIER_PIXEL_SIZE: number = 6; // Size of each "pixel" in the magnifier

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
      contentPickerStart();
      sendResponse({ success: true });
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

// Start the color picker
function contentPickerStart(): void {
  console.log('ChromaCode: Initializing picker');
  
  // If the picker is already active, clean up old elements first
  if (isPickerActive) {
    console.log('ChromaCode: Picker already active, stopping first');
    stopColorPicker();
  }
  
  isPickerActive = true;
  
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
    magnifierGlass = document.createElement('div');
    magnifierGlass.className = 'magnifier-glass';
    magnifierGlass.style.width = `${MAGNIFIER_SIZE}px`;
    magnifierGlass.style.height = `${MAGNIFIER_SIZE}px`;
    
    // Create canvas inside magnifying glass
    magnifierCanvas = document.createElement('canvas');
    magnifierCanvas.width = MAGNIFIER_SIZE;
    magnifierCanvas.height = MAGNIFIER_SIZE;
    magnifierCanvas.style.position = 'absolute';
    magnifierCanvas.style.top = '0';
    magnifierCanvas.style.left = '0';
    magnifierCanvas.style.width = '100%';
    magnifierCanvas.style.height = '100%';
    magnifierGlass.appendChild(magnifierCanvas);
    
    // Create center dot for the magnifier
    const centerDot = document.createElement('div');
    centerDot.style.position = 'absolute';
    centerDot.style.top = '50%';
    centerDot.style.left = '50%';
    centerDot.style.width = '4px';
    centerDot.style.height = '4px';
    centerDot.style.backgroundColor = '#FF0000';
    centerDot.style.borderRadius = '50%';
    centerDot.style.transform = 'translate(-50%, -50%)';
    centerDot.style.pointerEvents = 'none';
    centerDot.style.zIndex = '2';
    centerDot.style.boxShadow = '0 0 2px white';
    magnifierGlass.appendChild(centerDot);
    
    // Create grid overlay
    const gridOverlay = document.createElement('div');
    gridOverlay.style.position = 'absolute';
    gridOverlay.style.top = '0';
    gridOverlay.style.left = '0';
    gridOverlay.style.width = '100%';
    gridOverlay.style.height = '100%';
    gridOverlay.style.backgroundImage = `linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px), 
                                        linear-gradient(90deg, rgba(255,255,255,0.2) 1px, transparent 1px)`;
    gridOverlay.style.backgroundSize = `${MAGNIFIER_PIXEL_SIZE}px ${MAGNIFIER_PIXEL_SIZE}px`;
    gridOverlay.style.pointerEvents = 'none';
    gridOverlay.style.zIndex = '1';
    magnifierGlass.appendChild(gridOverlay);
    
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
    
    console.log('ChromaCode: Picker initialized successfully');
  } catch (error) {
    isPickerActive = false;
    console.error('ChromaCode: Error initializing picker:', error);
    throw error;
  }
}

// Stop the color picker
function stopColorPicker(): void {
  console.log('ChromaCode: Stopping picker');
  
  if (!isPickerActive) {
    console.log('ChromaCode: Picker not active');
    return;
  }
  
  isPickerActive = false;
  
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

// Update the magnifier view with a more robust method
function updateMagnifierView(x: number, y: number, centerColor?: string): string {
  if (!magnifierCanvas || !pickerOverlay) return '#ffffff';
  
  try {
    const ctx = magnifierCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '#ffffff';
    
    // Clear the canvas
    ctx.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
    
    // Fill with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
    
    // Store original pointer-events setting
    const originalPointerEvents = pickerOverlay.style.pointerEvents;
    
    // Temporarily disable the overlay to get elements underneath
    pickerOverlay.style.pointerEvents = 'none';
    
    // Calculate the area we need to capture (half of magnifier size divided by zoom)
    const captureRadius = Math.floor(MAGNIFIER_SIZE / (2 * ZOOM_FACTOR));
    
    // Collect all elements in the capture area
    const elements: Element[] = [];
    const visited = new Set<Element>();
    
    // Sample points in a grid pattern around the cursor
    for (let offsetX = -captureRadius; offsetX <= captureRadius; offsetX += 2) {
      for (let offsetY = -captureRadius; offsetY <= captureRadius; offsetY += 2) {
        const sampleX = Math.round(x + offsetX);
        const sampleY = Math.round(y + offsetY);
        
        // Skip if outside viewport
        if (sampleX < 0 || sampleX >= window.innerWidth || 
            sampleY < 0 || sampleY >= window.innerHeight) {
          continue;
        }
        
        const element = document.elementFromPoint(sampleX, sampleY);
        if (element && !visited.has(element)) {
          visited.add(element);
          
          // Skip our own elements
          if (element === pickerOverlay || 
              element === pickerCursor || 
              element === colorInfoBox || 
              element === magnifierGlass ||
              element.closest('[id^="magnifier"]') !== null) {
            continue;
          }
          
          elements.push(element);
        }
      }
    }
    
    // Prepare to collect colored rectangles
    interface ColoredRect {
      element: Element;
      rect: DOMRect;
      color: string;
      isImage?: boolean;
      zIndex: number;
    }
    
    const coloredRects: ColoredRect[] = [];
    
    // Process each element - starting with elements that are likely in the background
    elements.forEach(element => {
      const rect = element.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(element);
      
      // Skip elements with zero size
      if (rect.width === 0 || rect.height === 0) return;
      
      // Get element's stacking context (approximated by z-index)
      const zIndex = parseInt(computedStyle.zIndex) || 0;
      
      // Get background color
      let color = computedStyle.backgroundColor;
      
      // If element has a background image
      const backgroundImage = computedStyle.backgroundImage;
      if (backgroundImage && backgroundImage !== 'none') {
        // Can't easily render background images, use a placeholder
        if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
          color = 'rgba(200, 200, 200, 0.3)';
        }
      }
      
      // If background is transparent, try text color
      if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
        color = computedStyle.color;
      }
      
      // If still transparent, use a very light gray
      if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
        color = 'rgba(240, 240, 240, 0.5)';
      }
      
      // Check if this is an image
      if (element.tagName === 'IMG') {
        coloredRects.push({
          element,
          rect,
          color,
          isImage: true,
          zIndex
        });
      } else {
        coloredRects.push({
          element,
          rect,
          color,
          zIndex
        });
      }
    });
    
    // Sort rects by z-index to respect stacking order (draw from bottom to top)
    coloredRects.sort((a, b) => a.zIndex - b.zIndex);
    
    // Calculate center of magnifier canvas
    const centerX = MAGNIFIER_SIZE / 2;
    const centerY = MAGNIFIER_SIZE / 2;
    
    // Draw all the colored rectangles
    coloredRects.forEach(item => {
      // Calculate element's position relative to cursor
      const rectLeft = item.rect.left - x;
      const rectTop = item.rect.top - y;
      
      // Map to canvas coordinates - center of canvas corresponds to cursor position
      // Multiply by ZOOM_FACTOR to achieve the zooming effect
      const canvasX = centerX + (rectLeft * ZOOM_FACTOR);
      const canvasY = centerY + (rectTop * ZOOM_FACTOR);
      const canvasWidth = item.rect.width * ZOOM_FACTOR;
      const canvasHeight = item.rect.height * ZOOM_FACTOR;
      
      if (item.isImage) {
        try {
          const imgElement = item.element as HTMLImageElement;
          
          // Skip if image isn't fully loaded
          if (!imgElement.complete) return;
          
          // Get exact cursor position within the image
          const imageX = x - item.rect.left;
          const imageY = y - item.rect.top;
          
          // Only proceed if cursor is within the image
          if (imageX >= 0 && imageX < item.rect.width &&
              imageY >= 0 && imageY < item.rect.height) {
            
            // Scale factor between natural size and displayed size
            const scaleX = imgElement.naturalWidth / item.rect.width;
            const scaleY = imgElement.naturalHeight / item.rect.height;
            
            // Calculate source rectangle in the original image
            // This centers the extraction around the cursor position
            const srcX = Math.max(0, Math.floor(imageX * scaleX - (captureRadius * scaleX)));
            const srcY = Math.max(0, Math.floor(imageY * scaleY - (captureRadius * scaleY)));
            const srcWidth = Math.min(imgElement.naturalWidth - srcX, Math.ceil(captureRadius * 2 * scaleX));
            const srcHeight = Math.min(imgElement.naturalHeight - srcY, Math.ceil(captureRadius * 2 * scaleY));
            
            // Calculate destination rectangle, making sure the cursor position is centered
            const drawX = canvasX - (imageX * ZOOM_FACTOR) + (srcX / scaleX * ZOOM_FACTOR);
            const drawY = canvasY - (imageY * ZOOM_FACTOR) + (srcY / scaleY * ZOOM_FACTOR);
            const drawWidth = srcWidth / scaleX * ZOOM_FACTOR;
            const drawHeight = srcHeight / scaleY * ZOOM_FACTOR;
            
            // Draw the image
            ctx.drawImage(
              imgElement,
              srcX, srcY, srcWidth, srcHeight,
              drawX, drawY, drawWidth, drawHeight
            );
          }
        } catch (e) {
          console.error('ChromaCode: Error rendering image in magnifier:', e);
          // Fallback to a colored rectangle
          ctx.fillStyle = 'rgba(180, 180, 180, 0.5)';
          ctx.fillRect(canvasX, canvasY, canvasWidth, canvasHeight);
        }
      } else {
        // Draw regular element as a colored rectangle
        ctx.fillStyle = item.color;
        ctx.fillRect(canvasX, canvasY, canvasWidth, canvasHeight);
      }
    });
    
    // Make sure pickerOverlay still exists before trying to restore its state
    if (pickerOverlay) {
      // Restore overlay pointer events
      pickerOverlay.style.pointerEvents = originalPointerEvents;
    }
    
    // Draw a precise crosshair at center
    const hairSize = 10;
    const hairWidth = 1;
    
    // Horizontal line
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = hairWidth;
    ctx.beginPath();
    ctx.moveTo(centerX - hairSize, centerY);
    ctx.lineTo(centerX + hairSize, centerY);
    ctx.stroke();
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - hairSize);
    ctx.lineTo(centerX, centerY + hairSize);
    ctx.stroke();
    
    // Add white outline to crosshair for better visibility
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = hairWidth + 1;
    ctx.beginPath();
    ctx.moveTo(centerX - hairSize - 1, centerY);
    ctx.lineTo(centerX + hairSize + 1, centerY);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - hairSize - 1);
    ctx.lineTo(centerX, centerY + hairSize + 1);
    ctx.stroke();
    
    // Draw a border around the central pixel
    const pixelSize = ZOOM_FACTOR;
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      centerX - pixelSize / 2, 
      centerY - pixelSize / 2, 
      pixelSize, 
      pixelSize
    );
    
    // Get the exact color from the center of the magnifier
    let magnifierCenterColor = '#ffffff';
    try {
      const pixelData = ctx.getImageData(centerX, centerY, 1, 1).data;
      magnifierCenterColor = rgbToHex(pixelData[0], pixelData[1], pixelData[2]);
    } catch (e) {
      console.error('ChromaCode: Error reading center pixel from magnifier:', e);
      // Fall back to provided centerColor or element color if we can't read directly
      magnifierCenterColor = centerColor || getColorAtPoint(x, y);
    }
    
    // Add color info label to magnifier with more modern style
    // Create gradient background for the label
    const labelGradient = ctx.createLinearGradient(0, MAGNIFIER_SIZE - 38, 0, MAGNIFIER_SIZE);
    labelGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    labelGradient.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    
    // Fill the bottom area with gradient
    ctx.fillStyle = labelGradient;
    ctx.fillRect(0, MAGNIFIER_SIZE - 38, MAGNIFIER_SIZE, 38);
    
    // Add color swatch
    const swatchSize = 12;
    const swatchX = MAGNIFIER_SIZE / 2 - 50;
    const swatchY = MAGNIFIER_SIZE - 21;
    
    // Draw color swatch with border
    ctx.fillStyle = magnifierCenterColor;
    ctx.fillRect(swatchX, swatchY, swatchSize, swatchSize);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(swatchX, swatchY, swatchSize, swatchSize);
    
    // Draw text with better styling
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.fillText(magnifierCenterColor.toUpperCase(), swatchX + swatchSize + 6, MAGNIFIER_SIZE - 12);
    
    // Try to add RGB value if we can compute it
    try {
      // Extract RGB components
      const colorValue = magnifierCenterColor.replace('#', '');
      if (colorValue.length === 6) {
        const r = parseInt(colorValue.substr(0, 2), 16);
        const g = parseInt(colorValue.substr(2, 2), 16);
        const b = parseInt(colorValue.substr(4, 2), 16);
        
        // Draw RGB value in smaller font
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(`RGB(${r}, ${g}, ${b})`, swatchX + swatchSize + 6, MAGNIFIER_SIZE - 24);
      }
    } catch (e) {
      // Skip RGB display if there's an error
    }
    
    return magnifierCenterColor;
  } catch (error) {
    console.error('ChromaCode: Error updating magnifier view:', error);
    return centerColor || '#ffffff';
  }
}

// Handle mouse movement to show color under cursor
function handleMouseMove(e: MouseEvent): void {
  if (!isPickerActive) return;
  
  try {
    if (!pickerCursor || !magnifierGlass || !colorInfoBox) return;
    
    // Always update cursor position for smooth tracking
    pickerCursor.style.left = `${e.clientX}px`;
    pickerCursor.style.top = `${e.clientY}px`;
    
    // Position the magnifying glass - offset it to avoid blocking mouse
    // Adjust position based on which quadrant of the screen we're in
    let magX: number, magY: number;
    
    // Determine which corner to place the magnifier in (opposite of cursor position)
    if (e.clientX < window.innerWidth / 2) {
      // Cursor is on left side, place magnifier on right
      magX = e.clientX + 40;
    } else {
      // Cursor is on right side, place magnifier on left
      magX = e.clientX - MAGNIFIER_SIZE - 40;
    }
    
    if (e.clientY < window.innerHeight / 2) {
      // Cursor is on top half, place magnifier below
      magY = e.clientY + 40;
    } else {
      // Cursor is on bottom half, place magnifier above
      magY = e.clientY - MAGNIFIER_SIZE - 40;
    }
    
    // Ensure magnifier stays within viewport bounds
    magX = Math.max(10, Math.min(window.innerWidth - MAGNIFIER_SIZE - 10, magX));
    magY = Math.max(10, Math.min(window.innerHeight - MAGNIFIER_SIZE - 10, magY));
    
    magnifierGlass.style.left = `${magX}px`;
    magnifierGlass.style.top = `${magY}px`;
    
    // First, get the true color under the cursor by temporarily hiding UI elements
    if (!pickerOverlay) return;
    
    // Save current visibility states
    const originalOverlayPointerEvents = pickerOverlay.style.pointerEvents;
    const originalCursorDisplay = pickerCursor.style.display;
    const originalInfoBoxDisplay = colorInfoBox.style.display;
    const originalMagnifierDisplay = magnifierGlass.style.display;
    
    // Hide picker elements temporarily to get accurate element underneath
    pickerOverlay.style.pointerEvents = 'none';
    pickerCursor.style.display = 'none';
    colorInfoBox.style.display = 'none';
    magnifierGlass.style.display = 'none';
    
    // Get element under the cursor with UI hidden
    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
    
    // Get accurate color with UI hidden
    let actualColor = '';
    if (elementUnderCursor) {
      actualColor = getColorAtPoint(e.clientX, e.clientY, elementUnderCursor);
    } else {
      actualColor = '#ffffff'; // Default white if no element
    }
    
    // Restore visibility
    pickerOverlay.style.pointerEvents = originalOverlayPointerEvents;
    pickerCursor.style.display = originalCursorDisplay;
    colorInfoBox.style.display = originalInfoBoxDisplay;
    magnifierGlass.style.display = originalMagnifierDisplay;
    
    // Now update the magnifying glass view with accurate color information from the element
    // This returns the actual color from the center of the magnifier
    const magnifierCenterColor = updateMagnifierView(e.clientX, e.clientY, actualColor);
    
    // Update cursor border color immediately for better visibility
    // Using the color from the magnifier center for consistency
    pickerCursor.style.borderColor = getContrastColor(magnifierCenterColor);
    pickerCursor.style.backgroundColor = magnifierCenterColor + '80'; // Add 50% transparency
    
    // Throttle detailed color info box updates to improve performance
    const now = Date.now();
    if (now - lastUpdateTime < throttleDelay) {
      return;
    }
    lastUpdateTime = now;
    
    // Update color info box with the color from the magnifier center
    const rgbColor = contentHexToRgb(magnifierCenterColor);
    colorInfoBox.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="color-swatch" style="background-color: ${magnifierCenterColor};"></div>
        <div>
          <div class="font-semibold">${magnifierCenterColor.toUpperCase()}</div>
          <div class="text-xs opacity-70">${rgbColor}</div>
        </div>
      </div>
    `;
    colorInfoBox.style.color = '#333';
    
    // Position the info box
    colorInfoBox.style.left = (e.clientX + 20) + 'px';
    colorInfoBox.style.top = (e.clientY + 20) + 'px';
    
    // Update last processed position
    lastProcessedPosition.x = e.clientX;
    lastProcessedPosition.y = e.clientY;
  } catch (error) {
    console.error('ChromaCode: Error during mouse move:', error);
  }
  
  // Always prevent default behavior to avoid text selection and other interactions
  e.preventDefault();
  e.stopPropagation();
}

// Handle mouse click to select a color
function handleMouseClick(e: MouseEvent): void {
  if (!isPickerActive) return;
  
  try {
    e.preventDefault();
    e.stopPropagation();
    
    if (!pickerOverlay || !pickerCursor || !colorInfoBox || !magnifierGlass || !magnifierCanvas) return;
    
    // Get ONLY the color from the center of the magnifier
    // This ensures what you see is what you pick
    const magnifierCtx = magnifierCanvas.getContext('2d', { willReadFrequently: true });
    const centerX = MAGNIFIER_SIZE / 2;
    const centerY = MAGNIFIER_SIZE / 2;
    let color = '#ffffff'; // Default white
    
    if (magnifierCtx) {
      try {
        // Get the exact pixel at the center of the magnifier
        const pixelData = magnifierCtx.getImageData(centerX, centerY, 1, 1).data;
        color = rgbToHex(pixelData[0], pixelData[1], pixelData[2]);
        console.log('ChromaCode: Color from magnifier center:', color);
      } catch (e) {
        console.error('ChromaCode: Error reading from magnifier:', e);
      }
    }
    
    // Temporarily hide UI elements for visual feedback
    // Save current visibility states
    const originalOverlayPointerEvents = pickerOverlay.style.pointerEvents;
    const originalCursorDisplay = pickerCursor.style.display;
    const originalInfoBoxDisplay = colorInfoBox.style.display;
    const originalMagnifierDisplay = magnifierGlass.style.display;
    
    // Hide magnifier but keep cursor visible for feedback
    pickerOverlay.style.pointerEvents = 'none';
    magnifierGlass.style.display = 'none';
    
    // Show the selected color in the cursor before closing
    // This gives visual feedback that the correct color was selected
    pickerCursor.style.backgroundColor = color;
    pickerCursor.style.borderColor = getContrastColor(color);
    pickerCursor.style.display = 'block';
    pickerCursor.classList.add('active'); // Add active class for animation
    
    // Display the selected color in the color info box
    const rgbColor = contentHexToRgb(color);
    colorInfoBox.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="color-swatch" style="background-color: ${color};"></div>
        <div>
          <div class="font-semibold">${color.toUpperCase()}</div>
          <div class="text-xs opacity-70">${rgbColor}</div>
        </div>
      </div>
    `;
    colorInfoBox.style.display = 'block';
    
    // A brief delay to show the selected color before closing
    setTimeout(() => {
      // Send the color back to the extension
      chrome.runtime.sendMessage({
        action: 'colorPicked',
        color: color
      }, (response?: any) => {
        if (chrome.runtime.lastError) {
          console.error('ChromaCode: Error sending picked color:', chrome.runtime.lastError);
        } else {
          console.log('ChromaCode: Color sent successfully:', response);
        }
        
        // Stop the picker
        stopColorPicker();
      });
    }, 350); // Delay for visual feedback
    
    console.log('ChromaCode: Final color picked:', color);
  } catch (error) {
    console.error('ChromaCode: Error handling click:', error);
    stopColorPicker();
  }
}

// Handle ESC key to cancel color picking
function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isPickerActive) {
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
          const context = canvas.getContext('2d', { willReadFrequently: true });
          
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
              // Only use hex for fully opaque pixels, otherwise use rgba
              if (pixelData[3] < 255) {
                return `rgba(${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]}, ${(pixelData[3] / 255).toFixed(2)})`;
              } else {
                return rgbToHex(pixelData[0], pixelData[1], pixelData[2]);
              }
            } catch (e) {
              console.error('ChromaCode: Image color extraction error:', e);
            }
          }
        }
      } catch (e) {
        console.error('ChromaCode: Image processing error:', e);
      }
    }
    
    // Create a small canvas to grab the exact pixel color for any element
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!context) {
      console.error('ChromaCode: Could not get canvas context');
      return '#ffffff';
    }
    
    // Take device pixel ratio into account for retina/high DPI displays
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Make the canvas larger for higher resolution screens
    canvas.width = 3 * pixelRatio;
    canvas.height = 3 * pixelRatio;
    
    // Position it centered on the target point
    canvas.style.position = 'absolute';
    canvas.style.left = (x - 1) + 'px';
    canvas.style.top = (y - 1) + 'px';
    canvas.style.width = '3px';
    canvas.style.height = '3px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '-1';
    canvas.style.opacity = '0';  // Make it invisible
    
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
    
    // We can use the element under cursor as a starting point
    if (!element) {
      const found = document.elementFromPoint(x, y);
      if (found) {
        element = found;
      }
    }
    
    if (element) {
      // Use a special case for normal elements with solid background colors
      try {
        // Start with element's background color
        const elemStyle = window.getComputedStyle(element);
        let bgColor = elemStyle.backgroundColor;
        
        // If it's not transparent, use it to fill the canvas
        if (bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
          context.fillStyle = bgColor;
          context.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          // Try to find a parent with non-transparent background
          let parent = element.parentElement;
          while (parent) {
            const parentStyle = window.getComputedStyle(parent);
            bgColor = parentStyle.backgroundColor;
            
            if (bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
              context.fillStyle = bgColor;
              context.fillRect(0, 0, canvas.width, canvas.height);
              break;
            }
            
            parent = parent.parentElement;
          }
        }
      } catch (e) {
        console.error('ChromaCode: Error getting background color:', e);
      }
    }
    
    // Get the center pixel color
    const centerX = Math.floor(canvas.width / 2);
    const centerY = Math.floor(canvas.height / 2);
    let pixelData;
    
    try {
      // Sample a 1x1 pixel from the center of our 3x3 canvas
      pixelData = context.getImageData(centerX, centerY, 1, 1).data;
    } catch (e) {
      console.error('ChromaCode: Error reading pixel data:', e);
      
      // If we can't read pixel data (cross-origin or other issues),
      // fall back to element's computed style
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
        
        return color.startsWith('#') ? color : rgbStringToHex(color);
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
    
    // Convert to hex, with rgba handling if necessary
    if (pixelData[3] < 255) {
      // Has transparency, use rgba format
      return `rgba(${pixelData[0]}, ${pixelData[1]}, ${pixelData[2]}, ${(pixelData[3] / 255).toFixed(2)})`;
    } else {
      // Fully opaque, use hex
      return rgbToHex(pixelData[0], pixelData[1], pixelData[2]);
    }
  } catch (error) {
    console.error('ChromaCode: Error in getColorAtPoint:', error);
    
    // Fall back to original implementation if our new approach fails
    // Get the proper element to check - either the one passed in or find one at the cursor
    const targetElement = element || document.elementFromPoint(x, y)!;
    
    // If no element found, return default white
    if (!targetElement) {
      return '#ffffff';
    }
    
    // Try to get color directly from CSS of the element and its stack
    // Start with the current element
    const style = window.getComputedStyle(targetElement);
    let color = style.backgroundColor;
    
    // If background is transparent, try text color
    if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
      color = style.color;
    }
    
    // If color is still transparent, traverse up the DOM
    let parentElement = targetElement.parentElement;
    while (parentElement && (color === 'rgba(0, 0, 0, 0)' || color === 'transparent')) {
      const parentStyle = window.getComputedStyle(parentElement);
      color = parentStyle.backgroundColor;
      
      // If still transparent, try text color
      if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
        color = parentStyle.color;
      }
      
      parentElement = parentElement.parentElement;
    }
    
    // If we still have no color, default to white
    if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent' || !color) {
      color = '#ffffff';
    }
    
    // Convert to hex color if it's not already
    return color.startsWith('#') ? color : rgbStringToHex(color);
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