import fs from 'fs';

const candidates = [
  {
    normal: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    bold: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    italics: '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
    bolditalics: '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf',
  },
  {
    normal: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    italics: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
    bolditalics: '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf',
  },
];

let cached = null;

export function getFontPaths() {
  if (cached) return cached;
  for (const set of candidates) {
    if (fs.existsSync(set.normal)) {
      cached = set;
      return set;
    }
  }
  cached = {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  };
  return cached;
}
