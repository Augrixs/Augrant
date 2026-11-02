import { h, icon, toast, t, confirmSheet, loadSettings } from '../util.js';
import { me } from '../supa.js';
import { avatar, nameOf } from '../social.js';
import { LOOKS, SLOTS, TASKS, MONTHLY, loadEconomy, equippedOf, claimDaily, claimTask, claimMonthly, buyItem, buyBundle, equipItem, unequipSlot, dailyAmount, isoWeekday, clsOf } from '../economy.js';

export const gem = (size = 18) => h('span', { class: 'gem', style: { width: size + 'px', height: size + 'px' }, 'aria-hidden': 'true' });

// A profile picture inside whatever frame is equipped.
export function framedAvatar(p, size, frameId) {
  const a = avatar(p, size);
  const box = h('div', { class: 'framed ' + clsOf(frameId), style: { width: size + 'px', height: size + 'px' } }, a);
  if (frameId === 'halloween_frame') box.append(h('span', { class: 'pump', style: { fontSize: Math.round(size * 0.34) + 'px' } }, '🎃'));
  return box;
}
// Fill in someone's bought frame / name style / background once it has loaded.
export function decorate(userId, { avBox, size, p, nameEl, bgEl }) {
  equippedOf([userId]).then((m) => {
    const eq = m[userId] || {};
    if (avBox && eq.frame) avBox.replaceChildren(framedAvatar(p, size, eq.frame));
    if (nameEl && eq.name_style) nameEl.className += ' sname ' + clsOf(eq.name_style);
    if (bgEl && eq.background) bgEl.classList.add(clsOf(eq.background));
  }).catch(() => {});
}
export const styledName = (p, nameId) => h('span', { class: 'sname ' + clsOf(nameId) }, nameOf(p));

function preview(eq) {
  return h('div', { class: 'preview ' + clsOf(eq.background) }, framedAvatar(me.profile, 84, eq.frame), h('div', {}, styledName(me.profile, eq.name_style)));
}

function countdown(date) {
  const ms = date - Date.now();
  if (ms <= 0) return '';
  const d = Math.floor(ms / 86400000);
  const hr = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${d}d ${String(hr).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function shopView(go) {
  const root = h('div', { class: 'screen mc-bg shop' });
  let timer = null;
  root.dispose = () => clearInterval(timer);

  async function render() {
    let st;
    try {
      st = await loadEconomy();
    } catch (e) {
      root.replaceChildren(h('div', { class: 'pad' }, h('p', {}, t('โหลดร้านค้าไม่ได้: ', 'Could not load the shop: ') + e.message)));
      return;
    }
    const act = async (fn, okMsg) => {
      try {
        const r = await fn();
        toast(okMsg ? okMsg(r) : 'OK');
      } catch (e) {
        const m = /already/i.test(e.message) ? t('รับไปแล้ววันนี้', 'Already claimed') : /not enough|insufficient/i.test(e.message) ? t('Auru ไม่พอ', 'Not enough Auru') : e.message;
        toast(m, 4200);
      }
      render();
    };

    // --- header: balance + daily claim
    const dow = isoWeekday();
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) =>
      h('div', { class: 'day' + (d === dow ? ' now' : '') + (d < dow ? ' past' : '') }, h('small', {}, 'D' + d), h('b', {}, String(100 + 10 * (d - 1)))),
    );
    const claim = h('button', { class: 'btn primary', type: 'button', disabled: st.claimedToday }, st.claimedToday ? t('รับวันนี้แล้ว', 'Claimed today') : t(`รับ ${dailyAmount()} Auru`, `Claim ${dailyAmount()} Auru`));
    claim.addEventListener('click', () => act(claimDaily, (n) => t(`ได้รับ ${n} Auru`, `Got ${n} Auru`)));
    const monthly = h('button', { class: 'btn', type: 'button', disabled: st.monthClaimed }, st.monthClaimed ? t('รับรายเดือนแล้ว', 'Monthly claimed') : t(`รับรายเดือน ${MONTHLY} Auru`, `Monthly ${MONTHLY} Auru`));
    monthly.addEventListener('click', () => act(claimMonthly, (n) => t(`ได้รับ ${n} Auru`, `Got ${n} Auru`)));

    const tasks = TASKS.map((k) => {
      const done = st.tasksDone.has(k.id);
      const b = h('button', { class: 'btn sm', type: 'button', disabled: done }, done ? '✓' : t('รับ', 'Claim') + ' +' + k.reward);
      b.addEventListener('click', () => act(() => claimTask(k.id), () => t(`ได้รับ ${k.reward} Auru`, `Got ${k.reward} Auru`)));
      return h('div', { class: 'row task' }, h('div', { class: 'grow' }, t(k.th, k.en)), b);
    });

    // --- items
    const byId = Object.fromEntries(st.items.map((i) => [i.id, i]));
    const now = Date.now();
    const cards = Object.keys(LOOKS)
      .filter((id) => byId[id] || LOOKS[id].own)
      .map((id) => {
        const look = LOOKS[id];
        const it = byId[id] || { price: look.price };
        const isBundle = look.slot === 'bundle';
        const owned = isBundle ? look.contains.every((c) => st.owned.has(c)) : st.owned.has(id);
        const upcoming = it.startsAt && it.startsAt.getTime() > now;
        const ended = it.endsAt && it.endsAt.getTime() < now;
        const eqNow = !isBundle && st.equipped[look.slot] === id;
        const sum = isBundle ? look.contains.reduce((a, c) => a + ((byId[c] && byId[c].price) || 0), 0) : 0;
        const art = isBundle
          ? h('div', { class: 'art bundle' + (look.own ? ' ' + id : '') }, h('span', { class: 'pumpbig' }, look.own ? '' : '🎃'), look.own ? framedAvatar(me.profile, 52, look.contains[0]) : null, h('small', {}, '-' + (sum ? Math.round((1 - it.price / sum) * 100) : 30) + '%'))
          : h('div', { class: 'art ' + (look.cls || '') }, look.slot === 'frame' ? framedAvatar(me.profile, 56, id) : look.slot === 'name_style' ? styledName(me.profile, id) : null);
        let btn;
        if (upcoming) btn = h('button', { class: 'btn sm', type: 'button', disabled: true }, h('span', { class: 'cd', 'data-at': it.startsAt.getTime() }, countdown(it.startsAt)));
        else if (ended && !owned) btn = h('button', { class: 'btn sm', type: 'button', disabled: true }, t('ไม่ขายแล้ว', 'No longer sold'));
        else if (owned && isBundle) btn = h('button', { class: 'btn sm', type: 'button', disabled: true }, t('มีครบแล้ว', 'Owned'));
        else if (owned) {
          btn = h('button', { class: 'btn sm' + (eqNow ? '' : ' primary'), type: 'button' }, eqNow ? t('ถอดออก', 'Unequip') : t('ใส่', 'Equip'));
          btn.addEventListener('click', () => act(() => (eqNow ? unequipSlot(look.slot) : equipItem(id))));
        } else {
          btn = h('button', { class: 'btn sm primary', type: 'button' }, gem(14), String(it.price));
          btn.addEventListener('click', async () => {
            if (await confirmSheet(t('ซื้อไอเทม', 'Buy item'), t(`ซื้อ ${look.th} ราคา ${it.price} Auru ?`, `Buy ${look.en} for ${it.price} Auru?`), t('ซื้อ', 'Buy'))) act(() => (look.own ? buyBundle(id) : buyItem(id)), () => t('ซื้อแล้ว', 'Purchased'));
          });
        }
        const note = isBundle ? t(`รวม 3 ชิ้น (แยกซื้อ ${sum})`, `3 items (${sum} separately)`) : '';
        return h('div', { class: 'card item' }, art, h('b', {}, t(look.th, look.en)), note ? h('small', { class: 'muted' }, note) : null, btn);
      });

    const slotNames = { frame: t('กรอบ', 'Frame'), name_style: t('ชื่อ', 'Name'), background: t('พื้นหลัง', 'Background') };
    root.replaceChildren(
      h('div', { class: 'page-title' }, 'SHOP'),
      h(
        'div',
        { class: 'pad stack' },
        h('div', { class: 'wallet' }, gem(28), h('b', { class: 'bal' }, String(st.balance)), h('span', { class: 'muted' }, 'Auru')),
        preview(st.equipped),
        h('div', { class: 'card stack' }, h('b', {}, t('รับรายวัน (รีเซ็ตทุกสัปดาห์)', 'Daily reward (resets weekly)')), h('div', { class: 'days' }, ...days), h('small', { class: 'muted' }, t('วันที่พลาดไปรับย้อนหลังไม่ได้', 'Missed days cannot be claimed later')), claim, monthly),
        h('div', { class: 'card stack' }, h('b', {}, t('ภารกิจรายวัน', 'Daily tasks')), ...tasks),
        h('b', {}, t('ร้านค้า', 'Store')),
        cards.length ? h('div', { class: 'grid' }, ...cards) : h('p', { class: 'muted' }, t('ยังไม่มีสินค้า', 'Nothing for sale yet')),
        h('div', { class: 'row wrap' }, ...SLOTS.filter((s) => st.equipped[s]).map((s) => h('button', { class: 'btn sm', type: 'button', onclick: () => act(() => unequipSlot(s)) }, t('ถอด', 'Remove') + ' ' + slotNames[s]))),
      ),
    );
    clearInterval(timer);
    timer = setInterval(() => {
      const els = root.querySelectorAll('.cd');
      els.forEach((el) => {
        const left = Number(el.dataset.at) - Date.now();
        if (left <= 0) {
          clearInterval(timer);
          render();
        } else el.textContent = countdown(new Date(Number(el.dataset.at)));
      });
    }, 1000);
  }
  render();
  return root;
}
