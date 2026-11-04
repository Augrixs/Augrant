// Report a post / comment / user. 3 different reports hide a post or comment until an admin reviews it.
import { h, toast, sheet } from './util.js';
import { sb } from './supa.js';

export const REPORT_REASONS = ['Bullying', 'NSFW', 'Spam', 'Scam / Hacking', 'Other'];

export function reportSheet(type, id) {
  const s = sheet('Report', h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Why are you reporting this?'),
    ...REPORT_REASONS.map((r) => h('button', { class: 'btn', type: 'button', onclick: async () => {
      const { error } = await sb.rpc('report_content', { p_type: type, p_id: id, p_reason: r });
      s.close();
      toast(error ? 'Could not report' : 'Thanks, we will review it', 3500);
    } }, r))));
}

export const reportBtn = (type, id) => h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Report', onclick: (e) => { e.stopPropagation(); reportSheet(type, id); } }, '⚑ Report');
