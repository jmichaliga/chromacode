# ChromaCode

A Chrome extension for picking colors from any webpage, built with TypeScript.

## Features

- 🎨 Pick colors from any element on a webpage
- 🔍 Magnifying glass with zoom for precise pixel selection
- 📋 Copy colors in HEX and RGB formats
- 📚 Color history for quick access to previously picked colors
- 🌐 Works across websites and with images (when possible)

## Development Setup

### Prerequisites

- Node.js (v14 or newer)
- npm

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/chromacode.git
   cd chromacode
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the extension:
   ```
   npm run build
   ```

### Development

- Build once:
  ```
  npm run build
  ```

- Watch for changes:
  ```
  npm run watch
  ```

- Build for development:
  ```
  npm run dev
  ```

### Load the extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" in the top-right corner
3. Click "Load unpacked" and select the `dist` directory from this project
4. The ChromaCode extension should now be available in your browser

## Project Structure

```
chromacode/
├── dist/               # Compiled files (generated)
├── src/                # Source files
│   ├── background.ts   # Background script
│   ├── content.ts      # Content script for color picking
│   ├── popup.ts        # Popup UI script
│   ├── popup.html      # Popup HTML
│   ├── manifest.json   # Extension manifest
│   └── icons/          # Extension icons
├── types/              # TypeScript type definitions
│   └── chroma-code.d.ts  # Custom type definitions
├── tsconfig.json       # TypeScript configuration
└── package.json        # npm package configuration
```

## Technical Implementation

- **TypeScript**: Strongly typed code for better code quality
- **Chrome Extension APIs**: Uses chrome.tabs, chrome.runtime, chrome.storage, etc.
- **Canvas API**: For precise color extraction from images
- **MutationObserver**: For reliable element selection
- **Modern ES Modules**: For clean code organization

## Troubleshooting

### Cross-Origin Images

If colors from some images cannot be picked, this is likely due to cross-origin restrictions. The extension can only read pixel data from images that:

1. Are served from the same origin as the page
2. Are served with CORS headers that allow reading from canvas
3. Are not protected by content security policies

### Permission Denied

Make sure to grant the extension all required permissions when prompted.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Known Issues

- Some websites with strict Content Security Policies may prevent the color picker from functioning correctly.

## Future Improvements

- Add HSL color format
- Copy color values to clipboard
- Custom shortcut keys
- Color palettes creation and management
- Export colors in various formats
