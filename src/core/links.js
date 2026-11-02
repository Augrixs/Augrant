// Social links on a profile. Each box accepts only its own site.
export const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'], example: 'https://youtube.com/@ชื่อช่อง' },
  { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'], example: 'https://tiktok.com/@ชื่อ' },
  { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'], example: 'https://instagram.com/ชื่อ' },
  { id: 'discord', label: 'Discord', hosts: ['discord.gg', 'discord.com'], example: 'https://discord.gg/โค้ด' },
  { id: 'x', label: 'X', hosts: ['x.com', 'twitter.com'], example: 'https://x.com/ชื่อ' },
];

// Returns a clean https link, '' for an empty box, or null when the link is not from that site.
export function normalizeLink(platformId, input) {
  const p = PLATFORMS.find((x) => x.id === platformId);
  const raw = String(input || '').trim();
  if (!p) return null;
  if (!raw) return '';
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!p.hosts.some((d) => host === d || host.endsWith('.' + d))) return null;
  u.protocol = 'https:';
  const out = u.toString();
  return out.length > 200 ? null : out;
}
