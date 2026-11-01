// Masks bad words with ##### when text is shown. The stored text is never changed.
// Thai has no spaces between words, so Thai words match anywhere. English words match whole words only
// (so "class" is not caught by "ass").

const THAI = ['เหี้ย', 'สัส', 'ควย', 'หี', 'เย็ด', 'แม่ง', 'มึง', 'กู', 'ไอ้สัตว์', 'ชาติหมา', 'ระยำ', 'ห่า', 'อีดอก', 'ไอ้ควาย', 'อีควาย', 'สถุน', 'ขี้ข้า', 'หน้าด้าน', 'ปากหมา', 'แดก', 'ตอแหล', 'อีสัตว์', 'เชี่ย', 'เหี้ยม'];
const EN = ['fuck', 'fucking', 'fucker', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'cunt', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'motherfucker', 'cock', 'wtf', 'stfu'];

// short Thai words that are common inside normal words are matched only when standing alone
const THAI_ALONE = new Set(['หี', 'กู', 'มึง', 'ห่า', 'แดก']);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const enRe = new RegExp('(?<![A-Za-z])(' + EN.map(esc).join('|') + ')(?![A-Za-z])', 'gi');
const thaiLong = new RegExp(THAI.filter((w) => !THAI_ALONE.has(w)).map(esc).join('|'), 'g');
const thaiShort = new RegExp('(?<![\\u0E00-\\u0E7F])(' + [...THAI_ALONE].map(esc).join('|') + ')(?![\\u0E00-\\u0E7F])', 'g');

export function clean(text) {
  if (!text) return '';
  return String(text).replace(thaiLong, '#####').replace(thaiShort, '#####').replace(enRe, '#####');
}
