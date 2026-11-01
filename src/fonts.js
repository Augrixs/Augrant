import '@fontsource/prompt/700.css';
import '@fontsource/kanit/700.css';
import '@fontsource/sarabun/700.css';
import '@fontsource/mitr/600.css';
import '@fontsource/noto-sans-thai/700.css';
import '@fontsource/noto-sans/700.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/bai-jamjuree/700.css';
import '@fontsource/k2d/700.css';
import '@fontsource/krub/700.css';
import '@fontsource/itim/400.css';
import '@fontsource/pridi/600.css';
import '@fontsource/press-start-2p/400.css';

// Every font here has both Thai and Latin glyphs. Other scripts fall back to Noto Sans.
export const FONTS = [
  { id: 'Prompt', w: 700 },
  { id: 'Kanit', w: 700 },
  { id: 'Sarabun', w: 700 },
  { id: 'Mitr', w: 600 },
  { id: 'Noto Sans Thai', w: 700 },
  { id: 'Noto Sans', w: 700 },
  { id: 'Chakra Petch', w: 700 },
  { id: 'Bai Jamjuree', w: 700 },
  { id: 'K2D', w: 700 },
  { id: 'Krub', w: 700 },
  { id: 'Itim', w: 400 },
  { id: 'Pridi', w: 600 },
];

export const fontWeight = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).w;
export const fontStack = (id) => `"${id}","Noto Sans","Noto Sans Thai",sans-serif`;
export const canvasFont = (id, size) => `${fontWeight(id)} ${size}px ${fontStack(id)}`;

export async function ensureFont(id) {
  const w = fontWeight(id);
  try {
    await Promise.all([document.fonts.load(`${w} 48px "${id}"`, 'Hey Aa'), document.fonts.load(`${w} 48px "${id}"`, 'สวัสดี')]);
  } catch {
    /* the browser falls back to the next family */
  }
}
