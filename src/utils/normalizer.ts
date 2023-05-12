export const UNICODE_HOMOGLYPHS_BY_ASCII_CHARACTER = {
  '2': ['ƻ'],
  '5': ['ƽ'],
  a: ['à', 'á', 'à', 'â', 'ã', 'ä', 'å', 'ɑ', 'ạ', 'ǎ', 'ă', 'ȧ', 'ą', 'ə'],
  b: ['ʙ', 'ɓ', 'ḃ', 'ḅ', 'ḇ', 'ƅ'],
  c: ['ƈ', 'ċ', 'ć', 'ç', 'č', 'ĉ', 'ᴄ'],
  d: ['ɗ', 'đ', 'ď', 'ɖ', 'ḑ', 'ḋ', 'ḍ', 'ḏ', 'ḓ'],
  e: ['é', 'è', 'ê', 'ë', 'ē', 'ĕ', 'ě', 'ė', 'ẹ', 'ę', 'ȩ', 'ɇ', 'ḛ'],
  f: ['ƒ', 'ḟ'],
  g: ['ɢ', 'ɡ', 'ġ', 'ğ', 'ǵ', 'ģ', 'ĝ', 'ǧ', 'ǥ'],
  h: ['ĥ', 'ȟ', 'ħ', 'ɦ', 'ḧ', 'ḩ', 'ⱨ', 'ḣ', 'ḥ', 'ḫ', 'ẖ'],
  i: ['í', 'ì', 'ï', 'ı', 'ɩ', 'ǐ', 'ĭ', 'ỉ', 'ị', 'ɨ', 'ȋ', 'ī', 'ɪ'],
  j: ['ʝ', 'ǰ', 'ɉ', 'ĵ'],
  k: ['ḳ', 'ḵ', 'ⱪ', 'ķ', 'ᴋ'],
  l: ['ɫ', 'ł'],
  m: ['ṁ', 'ṃ', 'ᴍ', 'ɱ', 'ḿ'],
  n: ['ń', 'ṅ', 'ṇ', 'ṉ', 'ñ', 'ņ', 'ǹ', 'ň', 'ꞑ'],
  o: ['ȯ', 'ọ', 'ỏ', 'ơ', 'ó', 'ö', 'ᴏ'],
  p: ['ƿ', 'ƥ', 'ṕ', 'ṗ'],
  q: ['ʠ'],
  r: ['ʀ', 'ɼ', 'ɽ', 'ŕ', 'ŗ', 'ř', 'ɍ', 'ɾ', 'ȓ', 'ȑ', 'ṙ', 'ṛ', 'ṟ'],
  s: ['ʂ', 'ś', 'ṣ', 'ṡ', 'ș', 'ŝ', 'š', 'ꜱ'],
  t: ['ţ', 'ŧ', 'ṫ', 'ṭ', 'ț', 'ƫ'],
  u: ['ᴜ', 'ǔ', 'ŭ', 'ü', 'ʉ', 'ù', 'ú', 'û', 'ũ', 'ū', 'ų', 'ư', 'ů', 'ű', 'ȕ', 'ȗ', 'ụ'],
  v: ['ṿ', 'ⱱ', 'ᶌ', 'ṽ', 'ⱴ', 'ᴠ'],
  w: ['ŵ', 'ẁ', 'ẃ', 'ẅ', 'ⱳ', 'ẇ', 'ẉ', 'ẘ', 'ᴡ'],
  x: ['ẋ', 'ẍ'],
  y: ['ʏ', 'ý', 'ÿ', 'ŷ', 'ƴ', 'ȳ', 'ɏ', 'ỿ', 'ẏ', 'ỵ'],
  z: ['ʐ', 'ż', 'ź', 'ᴢ', 'ƶ', 'ẓ', 'ẕ', 'ⱬ'],
};

export const ASCII_CHARACTER_BY_UNICODE_HOMOGLYPH = Object.assign(
  {},
  ...Object.entries(UNICODE_HOMOGLYPHS_BY_ASCII_CHARACTER)
    .map(([symbol, glyphs]) =>
      glyphs.map((glyph) => ({
        [glyph]: symbol,
      })),
    )
    .flat(),
);

export const CYRILLIC_HOMOGLYPH_BY_ASCII_CHARACTER = {
  a: 'а',
  b: 'ь',
  c: 'с',
  d: 'ԁ',
  e: 'е',
  g: 'ԍ',
  h: 'һ',
  i: 'і',
  j: 'ј',
  k: 'к',
  l: 'ӏ',
  m: 'м',
  o: 'о',
  p: 'р',
  q: 'ԛ',
  s: 'ѕ',
  t: 'т',
  v: 'ѵ',
  w: 'ԝ',
  x: 'х',
  y: 'у',
};

export const ASCII_CHARACTER_BY_CYRILLIC_HOMOGLYPH = Object.assign(
  {},
  ...Object.entries(CYRILLIC_HOMOGLYPH_BY_ASCII_CHARACTER).map(([symbol, glyph]) => ({
    [glyph]: symbol,
  })),
);

// https://github.com/spencermountain/out-of-character/blob/main/data/characters.json
export const INVISIBLE_UNICODE_CHARACTERS = new Set([
  '\u{000A}',
  '\u{000B}',
  '\u{000C}',
  '\u{000D}',
  '\u{00A0}',
  '\u{0085}',
  '\u{2028}',
  '\u{2029}',
  '\u{0009}',
  '\u{0020}',
  '\u{00AD}',
  '\u{034F}',
  '\u{061C}',
  '\u{070F}',
  '\u{115F}',
  '\u{1160}',
  '\u{1680}',
  '\u{17B4}',
  '\u{17B5}',
  '\u{180E}',
  '\u{2000}',
  '\u{2001}',
  '\u{2002}',
  '\u{2003}',
  '\u{2004}',
  '\u{2005}',
  '\u{2006}',
  '\u{2007}',
  '\u{2008}',
  '\u{2009}',
  '\u{200A}',
  '\u{200B}',
  '\u{200C}',
  '\u{200D}',
  '\u{200E}',
  '\u{200F}',
  '\u{202F}',
  '\u{205F}',
  '\u{2060}',
  '\u{2061}',
  '\u{2062}',
  '\u{2063}',
  '\u{2064}',
  '\u{206A}',
  '\u{206B}',
  '\u{206C}',
  '\u{206D}',
  '\u{206E}',
  '\u{206F}',
  '\u{3000}',
  '\u{2800}',
  '\u{3164}',
  '\u{FEFF}',
  '\u{FFA0}',
  '\u{110B1}',
  '\u{1BCA0}',
  '\u{1BCA1}',
  '\u{1BCA2}',
  '\u{1BCA3}',
  '\u{1D159}',
  '\u{1D173}',
  '\u{1D174}',
  '\u{1D175}',
  '\u{1D176}',
  '\u{1D177}',
  '\u{1D178}',
  '\u{1D179}',
  '\u{1D17A}',
]);

export function normalizeText(text: string, preserveCase = false): string {
  const textChars = Array.from(text.toLowerCase());
  const isUpperChars = Array.from(text).map((c) => /[A-Z]/.test(c));

  // remap cyrillic glyphs with their ASCII representation
  textChars.forEach((char, i) => {
    const normalizedChar = ASCII_CHARACTER_BY_CYRILLIC_HOMOGLYPH[char];
    if (normalizedChar) {
      textChars.splice(i, 1, normalizedChar);
    }
  });

  // remap UNICODE glyphs with their ASCII representation
  textChars.forEach((char, i) => {
    const normalizedChar = ASCII_CHARACTER_BY_UNICODE_HOMOGLYPH[char];
    if (normalizedChar) {
      textChars.splice(i, 1, normalizedChar);
    }
  });

  // https://stackoverflow.com/a/71459391
  textChars.forEach((char, i) => {
    // remove separators
    char = char.replace(/\p{Separator}/gu, '');
    // remove control, unassigned, format characters etc
    char = char.replace(/\p{Other}/gu, '');
    // special characters
    char = INVISIBLE_UNICODE_CHARACTERS.has(char) ? '' : char;
    textChars.splice(i, 1, char);
  });

  // combine normalized name (char[] -> string)

  if (preserveCase) {
    return textChars
      .map((c, i) => {
        const isUpper = isUpperChars[i];
        return isUpper ? c.toUpperCase() : c;
      })
      .join('');
  }

  return textChars.join('');
}

export function normalizeName(name: string) {
  const isUpperChars = Array.from(name).map((c) => /[A-Z]/.test(c));
  const upperCharCount = isUpperChars.filter((v) => v).length;
  const lowerCharCount = isUpperChars.filter((v) => !v).length;

  // Boom -> preserve case
  // BOOM -> do not preserve case
  // boom -> do not preserve case
  // DeNYC -> do not preserve case
  // Tornado Cash -> do not preserve case
  // CryptoBank Hybrid Exchange -> do not preserve case

  const shouldPreserveCase = name.length <= 4 && upperCharCount === 1 && lowerCharCount > 1;

  return normalizeText(name, shouldPreserveCase);
}
