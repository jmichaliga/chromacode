/**
 * ChromaCode - Popup Script
 * Handles the popup UI and interactions
 */

// DOM Elements
const colorPickerBtn = document.getElementById('colorPickerBtn') as HTMLButtonElement | null;
const currentColorBox = document.getElementById('currentColor') as HTMLDivElement | null;
const hexValue = document.getElementById('hexValue') as HTMLInputElement | null;
const rgbValue = document.getElementById('rgbValue') as HTMLInputElement | null;
const tailwindValue = document.getElementById('tailwindValue') as HTMLInputElement | null;
const colorHistory = document.getElementById('colorHistory') as HTMLDivElement | null;
const clearHistoryBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement | null;
const dismissBtn = document.getElementById('dismissBtn') as HTMLButtonElement | null;
const toast = document.getElementById('toast') as HTMLDivElement | null;

// Color history
let colorHistoryArray: string[] = [];
const MAX_HISTORY_ITEMS = 5;

// Check if the EyeDropper API is available
const isEyeDropperSupported = (): boolean => {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
};

// Initialize the popup
document.addEventListener('DOMContentLoaded', () => {
  // Load the last picked color and history from storage
  loadColorFromStorage();
  
  // Set up event listeners
  setupEventListeners();
  
  // Show an error message if the browser doesn't support the EyeDropper API
  if (!isEyeDropperSupported()) {
    showToast('Error: EyeDropper API not supported in this browser. Please use Chrome 95+, Edge 95+, or Firefox 98+.', 5000);
    // Disable the color picker button
    if (colorPickerBtn) {
      colorPickerBtn.disabled = true;
      colorPickerBtn.title = 'EyeDropper API not supported in this browser';
      colorPickerBtn.classList.add('disabled');
    }
  }
});

/**
 * Load previously picked colors from Chrome storage
 */
function loadColorFromStorage(): void {
  chrome.storage.local.get(['lastPickedColor', 'colorHistory'], (result) => {
    // Set last picked color
    if (result.lastPickedColor) {
      updateColorDisplay(result.lastPickedColor);
    }
    
    // Set color history
    if (Array.isArray(result.colorHistory)) {
      colorHistoryArray = result.colorHistory;
      updateColorHistory();
    }
  });
}

/**
 * Set up all event listeners
 */
function setupEventListeners(): void {
  // Color picker button
  if (colorPickerBtn) {
    colorPickerBtn.addEventListener('click', startColorPickerWithUserGesture);
  }
  
  // Clear history button
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', clearColorHistory);
  }
  
  // Add click-to-copy functionality for color values
  if (hexValue) {
    hexValue.addEventListener('click', () => copyToClipboard(hexValue.value, 'HEX value'));
  }
  
  if (rgbValue) {
    rgbValue.addEventListener('click', () => copyToClipboard(rgbValue.value, 'RGB value'));
  }
  
  if (tailwindValue) {
    tailwindValue.addEventListener('click', () => copyToClipboard(tailwindValue.value, 'Tailwind color'));
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      window.close();
    });
  }
}

/**
 * Start the color picker with direct user gesture
 * This approach ensures the user activation is preserved
 */
function startColorPickerWithUserGesture(): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      showToast('Error: Cannot access active tab', 3000);
      return;
    }
    
    const tabId = tabs[0].id;
    
    // Execute script directly in the content page to preserve user activation
    chrome.scripting.executeScript({
      target: { tabId },
      func: executeEyeDropperInPage
    })
    .then(() => {
      // Close the popup after starting the eyedropper
      window.close();
    })
    .catch(error => {
      console.error('ChromaCode: Error executing script in page:', error);
      
      // Fall back to the original method if scripting fails
      fallbackStartColorPicker(tabId);
    });
  });
}

/**
 * This function will be injected and executed directly in the page context
 * to ensure it has the user activation status
 */
function executeEyeDropperInPage() {
  if (!window.EyeDropper) {
    chrome.runtime.sendMessage({
      action: 'colorPickError',
      error: 'EyeDropper API not supported in this browser'
    });
    return;
  }
  
  try {
    const eyeDropper = new window.EyeDropper();
    eyeDropper.open()
      .then(result => {
        if (result.sRGBHex) {
          chrome.runtime.sendMessage({
            action: 'colorPicked',
            color: result.sRGBHex
          });
        }
      })
      .catch(e => {
        // Don't report cancellation as an error
        if (e.name !== 'AbortError') {
          chrome.runtime.sendMessage({
            action: 'colorPickError',
            error: e.message || 'Unknown error'
          });
        }
      });
  } catch (err: any) {
    chrome.runtime.sendMessage({
      action: 'colorPickError',
      error: err.message || 'Unknown error'
    });
  }
}

/**
 * Fallback to original method if direct scripting fails
 */
function fallbackStartColorPicker(tabId: number): void {
  // Send message to the background script to start the picker
  chrome.runtime.sendMessage({
    action: 'startColorPicker',
    tabId: tabId
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('ChromaCode: Error starting color picker:', chrome.runtime.lastError);
      showToast(`Error: ${chrome.runtime.lastError.message}`, 3000);
    } else if (!response || !response.success) {
      console.error('ChromaCode: Failed to start color picker:', response?.error || 'Unknown error');
      showToast(`Error: ${response?.error || 'Failed to start color picker'}`, 3000);
    } else {
      console.log('ChromaCode: Color picker started');
      // Close the popup
      window.close();
    }
  });
}

/**
 * Update the color display in the popup
 */
function updateColorDisplay(color: string): void {
  if (!color) return;
  
  // Ensure color is in proper hex format
  color = standardizeHexColor(color);
  
  // Update the color box
  if (currentColorBox) {
    currentColorBox.style.backgroundColor = color;
  }
  
  // Update the HEX value
  if (hexValue) {
    hexValue.value = color.toUpperCase();
  }
  
  // Update the RGB value
  if (rgbValue) {
    rgbValue.value = hexToRgb(color);
  }
  
  // Update the Tailwind value
  if (tailwindValue) {
    const closestTailwindColor = findClosestTailwindColor(color);
    tailwindValue.value = closestTailwindColor.name;
    tailwindValue.style.backgroundColor = closestTailwindColor.hex;
    tailwindValue.style.color = getContrastTextColor(closestTailwindColor.hex);
  }
  
  // Add to history if it's a new color
  addToColorHistory(color);
}

/**
 * Standardize hex color format
 */
function standardizeHexColor(color: string): string {
  // If it's already a proper hex color, just ensure it has #
  if (/^#?[0-9A-Fa-f]{6}$/.test(color)) {
    return color.startsWith('#') ? color : '#' + color;
  }
  
  // If it's a short hex, expand it
  if (/^#?[0-9A-Fa-f]{3}$/.test(color)) {
    const hex = color.startsWith('#') ? color.substring(1) : color;
    return '#' + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  
  // Try to parse RGB format - rgb(r, g, b)
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);
    return popupRgbToHex(r, g, b);
  }
  
  // Return original if we can't standardize
  return color;
}

/**
 * Convert RGB values to hex
 */
function popupRgbToHex(r: number, g: number, b: number): string {
  // Ensure values are in range
  r = Math.max(0, Math.min(255, Math.round(r)));
  g = Math.max(0, Math.min(255, Math.round(g)));
  b = Math.max(0, Math.min(255, Math.round(b)));
  
  // Convert to hex with padding
  return '#' + 
    r.toString(16).padStart(2, '0') + 
    g.toString(16).padStart(2, '0') + 
    b.toString(16).padStart(2, '0');
}

/**
 * Convert HEX color to RGB format
 */
function hexToRgb(hex: string): string {
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
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Add a color to the history
 */
function addToColorHistory(color: string): void {
  // Skip if already the most recent color
  if (colorHistoryArray.length > 0 && colorHistoryArray[0] === color) {
    return;
  }
  
  // Remove if already in history
  colorHistoryArray = colorHistoryArray.filter(c => c !== color);
  
  // Add to the beginning
  colorHistoryArray.unshift(color);
  
  // Trim to max size
  if (colorHistoryArray.length > MAX_HISTORY_ITEMS) {
    colorHistoryArray = colorHistoryArray.slice(0, MAX_HISTORY_ITEMS);
  }
  
  // Save to storage
  chrome.storage.local.set({ colorHistory: colorHistoryArray });
  
  // Update the UI
  updateColorHistory();
}

/**
 * Update the color history display
 */
function updateColorHistory(): void {
  if (!colorHistory) return;
  
  // Clear current history display
  colorHistory.innerHTML = '';
  
  // Add each color to the history
  colorHistoryArray.forEach(color => {
    const colorItem = document.createElement('div');
    colorItem.className = 'color-item';
    colorItem.style.backgroundColor = color;
    colorItem.title = color;
    colorItem.addEventListener('click', () => updateColorDisplay(color));
    
    colorHistory.appendChild(colorItem);
  });
  
  // Show or hide clear button based on history
  if (clearHistoryBtn) {
    clearHistoryBtn.style.display = colorHistoryArray.length > 0 ? 'block' : 'none';
  }
}

/**
 * Clear the color history
 */
function clearColorHistory(): void {
  colorHistoryArray = [];
  chrome.storage.local.set({ colorHistory: [] });
  updateColorHistory();
}

/**
 * Copy a value to the clipboard
 */
function copyToClipboard(text: string, description: string): void {
  navigator.clipboard.writeText(text)
    .then(() => {
      showToast(`Copied ${description} to clipboard`);
    })
    .catch(err => {
      console.error('ChromaCode: Error copying to clipboard:', err);
      showToast('Error copying to clipboard');
    });
}

/**
 * Show a toast message
 */
function showToast(message: string, duration: number = 2000): void {
  if (!toast) return;
  
  toast.textContent = message;
  toast.style.opacity = '1';
  
  // Hide after specified duration
  setTimeout(() => {
    if (toast) {
      toast.style.opacity = '0';
    }
  }, duration);
}

// Define Tailwind CSS colors
const TAILWIND_COLORS = [
  // Slate
  { name: 'slate-50', hex: '#f8fafc' },
  { name: 'slate-100', hex: '#f1f5f9' },
  { name: 'slate-200', hex: '#e2e8f0' },
  { name: 'slate-300', hex: '#cbd5e1' },
  { name: 'slate-400', hex: '#94a3b8' },
  { name: 'slate-500', hex: '#64748b' },
  { name: 'slate-600', hex: '#475569' },
  { name: 'slate-700', hex: '#334155' },
  { name: 'slate-800', hex: '#1e293b' },
  { name: 'slate-900', hex: '#0f172a' },
  { name: 'slate-950', hex: '#020617' },
  
  // Gray
  { name: 'gray-50', hex: '#f9fafb' },
  { name: 'gray-100', hex: '#f3f4f6' },
  { name: 'gray-200', hex: '#e5e7eb' },
  { name: 'gray-300', hex: '#d1d5db' },
  { name: 'gray-400', hex: '#9ca3af' },
  { name: 'gray-500', hex: '#6b7280' },
  { name: 'gray-600', hex: '#4b5563' },
  { name: 'gray-700', hex: '#374151' },
  { name: 'gray-800', hex: '#1f2937' },
  { name: 'gray-900', hex: '#111827' },
  { name: 'gray-950', hex: '#030712' },
  
  // Zinc
  { name: 'zinc-50', hex: '#fafafa' },
  { name: 'zinc-100', hex: '#f4f4f5' },
  { name: 'zinc-200', hex: '#e4e4e7' },
  { name: 'zinc-300', hex: '#d4d4d8' },
  { name: 'zinc-400', hex: '#a1a1aa' },
  { name: 'zinc-500', hex: '#71717a' },
  { name: 'zinc-600', hex: '#52525b' },
  { name: 'zinc-700', hex: '#3f3f46' },
  { name: 'zinc-800', hex: '#27272a' },
  { name: 'zinc-900', hex: '#18181b' },
  { name: 'zinc-950', hex: '#09090b' },
  
  // Neutral
  { name: 'neutral-50', hex: '#fafafa' },
  { name: 'neutral-100', hex: '#f5f5f5' },
  { name: 'neutral-200', hex: '#e5e5e5' },
  { name: 'neutral-300', hex: '#d4d4d4' },
  { name: 'neutral-400', hex: '#a3a3a3' },
  { name: 'neutral-500', hex: '#737373' },
  { name: 'neutral-600', hex: '#525252' },
  { name: 'neutral-700', hex: '#404040' },
  { name: 'neutral-800', hex: '#262626' },
  { name: 'neutral-900', hex: '#171717' },
  { name: 'neutral-950', hex: '#0a0a0a' },
  
  // Stone
  { name: 'stone-50', hex: '#fafaf9' },
  { name: 'stone-100', hex: '#f5f5f4' },
  { name: 'stone-200', hex: '#e7e5e4' },
  { name: 'stone-300', hex: '#d6d3d1' },
  { name: 'stone-400', hex: '#a8a29e' },
  { name: 'stone-500', hex: '#78716c' },
  { name: 'stone-600', hex: '#57534e' },
  { name: 'stone-700', hex: '#44403c' },
  { name: 'stone-800', hex: '#292524' },
  { name: 'stone-900', hex: '#1c1917' },
  { name: 'stone-950', hex: '#0c0a09' },
  
  // Red
  { name: 'red-50', hex: '#fef2f2' },
  { name: 'red-100', hex: '#fee2e2' },
  { name: 'red-200', hex: '#fecaca' },
  { name: 'red-300', hex: '#fca5a5' },
  { name: 'red-400', hex: '#f87171' },
  { name: 'red-500', hex: '#ef4444' },
  { name: 'red-600', hex: '#dc2626' },
  { name: 'red-700', hex: '#b91c1c' },
  { name: 'red-800', hex: '#991b1b' },
  { name: 'red-900', hex: '#7f1d1d' },
  { name: 'red-950', hex: '#450a0a' },
  
  // Orange
  { name: 'orange-50', hex: '#fff7ed' },
  { name: 'orange-100', hex: '#ffedd5' },
  { name: 'orange-200', hex: '#fed7aa' },
  { name: 'orange-300', hex: '#fdba74' },
  { name: 'orange-400', hex: '#fb923c' },
  { name: 'orange-500', hex: '#f97316' },
  { name: 'orange-600', hex: '#ea580c' },
  { name: 'orange-700', hex: '#c2410c' },
  { name: 'orange-800', hex: '#9a3412' },
  { name: 'orange-900', hex: '#7c2d12' },
  { name: 'orange-950', hex: '#431407' },
  
  // Amber
  { name: 'amber-50', hex: '#fffbeb' },
  { name: 'amber-100', hex: '#fef3c7' },
  { name: 'amber-200', hex: '#fde68a' },
  { name: 'amber-300', hex: '#fcd34d' },
  { name: 'amber-400', hex: '#fbbf24' },
  { name: 'amber-500', hex: '#f59e0b' },
  { name: 'amber-600', hex: '#d97706' },
  { name: 'amber-700', hex: '#b45309' },
  { name: 'amber-800', hex: '#92400e' },
  { name: 'amber-900', hex: '#78350f' },
  { name: 'amber-950', hex: '#451a03' },
  
  // Yellow
  { name: 'yellow-50', hex: '#fefce8' },
  { name: 'yellow-100', hex: '#fef9c3' },
  { name: 'yellow-200', hex: '#fef08a' },
  { name: 'yellow-300', hex: '#fde047' },
  { name: 'yellow-400', hex: '#facc15' },
  { name: 'yellow-500', hex: '#eab308' },
  { name: 'yellow-600', hex: '#ca8a04' },
  { name: 'yellow-700', hex: '#a16207' },
  { name: 'yellow-800', hex: '#854d0e' },
  { name: 'yellow-900', hex: '#713f12' },
  { name: 'yellow-950', hex: '#422006' },
  
  // Lime
  { name: 'lime-50', hex: '#f7fee7' },
  { name: 'lime-100', hex: '#ecfccb' },
  { name: 'lime-200', hex: '#d9f99d' },
  { name: 'lime-300', hex: '#bef264' },
  { name: 'lime-400', hex: '#a3e635' },
  { name: 'lime-500', hex: '#84cc16' },
  { name: 'lime-600', hex: '#65a30d' },
  { name: 'lime-700', hex: '#4d7c0f' },
  { name: 'lime-800', hex: '#3f6212' },
  { name: 'lime-900', hex: '#365314' },
  { name: 'lime-950', hex: '#1a2e05' },
  
  // Green
  { name: 'green-50', hex: '#f0fdf4' },
  { name: 'green-100', hex: '#dcfce7' },
  { name: 'green-200', hex: '#bbf7d0' },
  { name: 'green-300', hex: '#86efac' },
  { name: 'green-400', hex: '#4ade80' },
  { name: 'green-500', hex: '#22c55e' },
  { name: 'green-600', hex: '#16a34a' },
  { name: 'green-700', hex: '#15803d' },
  { name: 'green-800', hex: '#166534' },
  { name: 'green-900', hex: '#14532d' },
  { name: 'green-950', hex: '#052e16' },
  
  // Emerald
  { name: 'emerald-50', hex: '#ecfdf5' },
  { name: 'emerald-100', hex: '#d1fae5' },
  { name: 'emerald-200', hex: '#a7f3d0' },
  { name: 'emerald-300', hex: '#6ee7b7' },
  { name: 'emerald-400', hex: '#34d399' },
  { name: 'emerald-500', hex: '#10b981' },
  { name: 'emerald-600', hex: '#059669' },
  { name: 'emerald-700', hex: '#047857' },
  { name: 'emerald-800', hex: '#065f46' },
  { name: 'emerald-900', hex: '#064e3b' },
  { name: 'emerald-950', hex: '#022c22' },
  
  // Teal
  { name: 'teal-50', hex: '#f0fdfa' },
  { name: 'teal-100', hex: '#ccfbf1' },
  { name: 'teal-200', hex: '#99f6e4' },
  { name: 'teal-300', hex: '#5eead4' },
  { name: 'teal-400', hex: '#2dd4bf' },
  { name: 'teal-500', hex: '#14b8a6' },
  { name: 'teal-600', hex: '#0d9488' },
  { name: 'teal-700', hex: '#0f766e' },
  { name: 'teal-800', hex: '#115e59' },
  { name: 'teal-900', hex: '#134e4a' },
  { name: 'teal-950', hex: '#042f2e' },
  
  // Cyan
  { name: 'cyan-50', hex: '#ecfeff' },
  { name: 'cyan-100', hex: '#cffafe' },
  { name: 'cyan-200', hex: '#a5f3fc' },
  { name: 'cyan-300', hex: '#67e8f9' },
  { name: 'cyan-400', hex: '#22d3ee' },
  { name: 'cyan-500', hex: '#06b6d4' },
  { name: 'cyan-600', hex: '#0891b2' },
  { name: 'cyan-700', hex: '#0e7490' },
  { name: 'cyan-800', hex: '#155e75' },
  { name: 'cyan-900', hex: '#164e63' },
  { name: 'cyan-950', hex: '#083344' },
  
  // Sky
  { name: 'sky-50', hex: '#f0f9ff' },
  { name: 'sky-100', hex: '#e0f2fe' },
  { name: 'sky-200', hex: '#bae6fd' },
  { name: 'sky-300', hex: '#7dd3fc' },
  { name: 'sky-400', hex: '#38bdf8' },
  { name: 'sky-500', hex: '#0ea5e9' },
  { name: 'sky-600', hex: '#0284c7' },
  { name: 'sky-700', hex: '#0369a1' },
  { name: 'sky-800', hex: '#075985' },
  { name: 'sky-900', hex: '#0c4a6e' },
  { name: 'sky-950', hex: '#082f49' },
  
  // Blue
  { name: 'blue-50', hex: '#eff6ff' },
  { name: 'blue-100', hex: '#dbeafe' },
  { name: 'blue-200', hex: '#bfdbfe' },
  { name: 'blue-300', hex: '#93c5fd' },
  { name: 'blue-400', hex: '#60a5fa' },
  { name: 'blue-500', hex: '#3b82f6' },
  { name: 'blue-600', hex: '#2563eb' },
  { name: 'blue-700', hex: '#1d4ed8' },
  { name: 'blue-800', hex: '#1e40af' },
  { name: 'blue-900', hex: '#1e3a8a' },
  { name: 'blue-950', hex: '#172554' },
  
  // Indigo
  { name: 'indigo-50', hex: '#eef2ff' },
  { name: 'indigo-100', hex: '#e0e7ff' },
  { name: 'indigo-200', hex: '#c7d2fe' },
  { name: 'indigo-300', hex: '#a5b4fc' },
  { name: 'indigo-400', hex: '#818cf8' },
  { name: 'indigo-500', hex: '#6366f1' },
  { name: 'indigo-600', hex: '#4f46e5' },
  { name: 'indigo-700', hex: '#4338ca' },
  { name: 'indigo-800', hex: '#3730a3' },
  { name: 'indigo-900', hex: '#312e81' },
  { name: 'indigo-950', hex: '#1e1b4b' },
  
  // Violet
  { name: 'violet-50', hex: '#f5f3ff' },
  { name: 'violet-100', hex: '#ede9fe' },
  { name: 'violet-200', hex: '#ddd6fe' },
  { name: 'violet-300', hex: '#c4b5fd' },
  { name: 'violet-400', hex: '#a78bfa' },
  { name: 'violet-500', hex: '#8b5cf6' },
  { name: 'violet-600', hex: '#7c3aed' },
  { name: 'violet-700', hex: '#6d28d9' },
  { name: 'violet-800', hex: '#5b21b6' },
  { name: 'violet-900', hex: '#4c1d95' },
  { name: 'violet-950', hex: '#2e1065' },
  
  // Purple
  { name: 'purple-50', hex: '#faf5ff' },
  { name: 'purple-100', hex: '#f3e8ff' },
  { name: 'purple-200', hex: '#e9d5ff' },
  { name: 'purple-300', hex: '#d8b4fe' },
  { name: 'purple-400', hex: '#c084fc' },
  { name: 'purple-500', hex: '#a855f7' },
  { name: 'purple-600', hex: '#9333ea' },
  { name: 'purple-700', hex: '#7e22ce' },
  { name: 'purple-800', hex: '#6b21a8' },
  { name: 'purple-900', hex: '#581c87' },
  { name: 'purple-950', hex: '#3b0764' },
  
  // Fuchsia
  { name: 'fuchsia-50', hex: '#fdf4ff' },
  { name: 'fuchsia-100', hex: '#fae8ff' },
  { name: 'fuchsia-200', hex: '#f5d0fe' },
  { name: 'fuchsia-300', hex: '#f0abfc' },
  { name: 'fuchsia-400', hex: '#e879f9' },
  { name: 'fuchsia-500', hex: '#d946ef' },
  { name: 'fuchsia-600', hex: '#c026d3' },
  { name: 'fuchsia-700', hex: '#a21caf' },
  { name: 'fuchsia-800', hex: '#86198f' },
  { name: 'fuchsia-900', hex: '#701a75' },
  { name: 'fuchsia-950', hex: '#4a044e' },
  
  // Pink
  { name: 'pink-50', hex: '#fdf2f8' },
  { name: 'pink-100', hex: '#fce7f3' },
  { name: 'pink-200', hex: '#fbcfe8' },
  { name: 'pink-300', hex: '#f9a8d4' },
  { name: 'pink-400', hex: '#f472b6' },
  { name: 'pink-500', hex: '#ec4899' },
  { name: 'pink-600', hex: '#db2777' },
  { name: 'pink-700', hex: '#be185d' },
  { name: 'pink-800', hex: '#9d174d' },
  { name: 'pink-900', hex: '#831843' },
  { name: 'pink-950', hex: '#500724' },
  
  // Rose
  { name: 'rose-50', hex: '#fff1f2' },
  { name: 'rose-100', hex: '#ffe4e6' },
  { name: 'rose-200', hex: '#fecdd3' },
  { name: 'rose-300', hex: '#fda4af' },
  { name: 'rose-400', hex: '#fb7185' },
  { name: 'rose-500', hex: '#f43f5e' },
  { name: 'rose-600', hex: '#e11d48' },
  { name: 'rose-700', hex: '#be123c' },
  { name: 'rose-800', hex: '#9f1239' },
  { name: 'rose-900', hex: '#881337' },
  { name: 'rose-950', hex: '#4c0519' },
];

/**
 * Find the closest Tailwind color to a given hex color
 */
function findClosestTailwindColor(hexColor: string): { name: string, hex: string } {
  // Convert input to RGB
  const inputRgb = hexToRgbValues(hexColor);
  
  let closestColor = TAILWIND_COLORS[0];
  let smallestDistance = Number.MAX_SAFE_INTEGER;
  
  // Find closest color using color distance
  for (const tailwindColor of TAILWIND_COLORS) {
    const tailwindRgb = hexToRgbValues(tailwindColor.hex);
    const distance = calculateColorDistance(inputRgb, tailwindRgb);
    
    if (distance < smallestDistance) {
      smallestDistance = distance;
      closestColor = tailwindColor;
    }
  }
  
  return closestColor;
}

/**
 * Calculate the distance between two colors using the CIEDE2000 formula approximation
 * This is a simplified version that uses weighted RGB Euclidean distance
 */
function calculateColorDistance(rgb1: { r: number, g: number, b: number }, rgb2: { r: number, g: number, b: number }): number {
  // Human eye is more sensitive to green, then red, then blue
  // Standard weights based on human perception
  const rWeight = 0.30;
  const gWeight = 0.59;
  const bWeight = 0.11;
  
  // Calculate differences
  const rDiff = Math.pow(rgb1.r - rgb2.r, 2) * rWeight;
  const gDiff = Math.pow(rgb1.g - rgb2.g, 2) * gWeight;
  const bDiff = Math.pow(rgb1.b - rgb2.b, 2) * bWeight;
  
  // Additional weighting to make darker colors match more accurately
  // This helps with the issue of darker colors appearing lighter
  let darkColorAdjustment = 1.0;
  
  // Calculate average brightness of the input color
  const inputBrightness = (rgb1.r + rgb1.g + rgb1.b) / 3;
  
  // Adjust weight for darker colors - give more importance to darker color matching
  if (inputBrightness < 128) {
    // For darker colors, make differences more significant
    // This makes the matching more sensitive for darker colors
    darkColorAdjustment = 1.5 - (inputBrightness / 255);
  }
  
  return Math.sqrt(rDiff + gDiff + bDiff) * darkColorAdjustment;
}

/**
 * Convert hex color to RGB values object
 */
function hexToRgbValues(hex: string): { r: number, g: number, b: number } {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Handle short hex format (e.g. #FFF)
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  
  // Parse the hex values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return { r, g, b };
}

/**
 * Get contrasting text color (black or white) for a background
 */
function getContrastTextColor(hexColor: string): string {
  // Convert hex to RGB values
  const { r, g, b } = hexToRgbValues(hexColor);
  
  // Calculate luminance - weighted average method
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Use white text on dark backgrounds, black text on light backgrounds
  return luminance > 0.5 ? '#000000' : '#ffffff';
} 