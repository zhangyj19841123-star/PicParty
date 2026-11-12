export interface RGBColor { r: number; g: number; b: number }

/** Canonical six-digit sRGB values keep project files and saved swatches stable. */
export function normalizedColor(value: string): string | null {
  const text = value.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(text)) return `#${text.split('').map(char => char + char).join('').toLowerCase()}`;
  if (/^[\da-f]{6}$/i.test(text)) return `#${text.toLowerCase()}`;
  return null;
}

export function hexToRGB(value: string): RGBColor | null {
  const color = normalizedColor(value);
  if (!color) return null;
  return { r: parseInt(color.slice(1, 3), 16), g: parseInt(color.slice(3, 5), 16), b: parseInt(color.slice(5, 7), 16) };
}

export function rgbToHex(color: RGBColor): string | null {
  const channels = [color.r, color.g, color.b];
  if (channels.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export function readableColor(color: string): string {
  const rgb = hexToRGB(color);
  return rgb && (rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722) < 140 ? '#ffffff' : '#40534a';
}
