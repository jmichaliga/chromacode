/**
 * Type definitions for ChromaCode extension
 */

declare namespace ChromaCode {
  /** 
   * Message types that can be sent between extension components
   */
  interface Message {
    action: 'pickColor' | 'colorPicked' | 'startColorPicker' | 'colorPickError';
    color?: string;
    tabId?: number;
    error?: string;
  }

  /**
   * Response format for messages
   */
  interface MessageResponse {
    success: boolean;
    error?: string;
  }

  /**
   * Color rectangle used for magnifier rendering
   */
  interface ColorRect {
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    isImage?: boolean;
    element?: HTMLImageElement;
    imageData?: ImageData;
  }

  /**
   * Image-specific color rectangle
   */
  interface ImageColorRect extends Omit<ColorRect, 'color'> {
    isImage: true;
    element: HTMLImageElement;
    imageData: ImageData;
  }

  /**
   * Position coordinates
   */
  interface Position {
    x: number;
    y: number;
  }
}

/**
 * EyeDropper API definitions
 * These make TypeScript aware of the EyeDropper API available in modern browsers
 */
interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperOptions {
  signal?: AbortSignal;
}

interface EyeDropperInterface {
  open(options?: EyeDropperOptions): Promise<EyeDropperResult>;
}

interface EyeDropperConstructor {
  new(): EyeDropperInterface;
}

// Add EyeDropper to the Window interface
interface Window {
  EyeDropper?: EyeDropperConstructor;
} 