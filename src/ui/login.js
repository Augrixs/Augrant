import { h, ICON } from '../util.js';
import { signIn } from '../supa.js';
import cover from '../assets/cover.png';

export function loginView(onDone) {
  const user = h('input', { class: 'rb-input', type: 'text', placeholder: 'Username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Username' });
  const pw = h('input', { class: 'rb-input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const err = h('div', { class: 'err', role: 'alert' });

  // Eye with a cross = password hidden (shown as dots). Plain eye = password visible.
  let shown = false;
  const eye = h('button', { class: 'eye', type: 'button', 'aria-label': 'แสดงหรือซ่อนรหัสผ่าน' });
  eye.innerHTML = ICON.eyeOff;
  eye.addEventListener('click', () => {
    shown = !shown;
    pw.type = shown ? 'text' : 'password';
    eye.innerHTML = shown ? ICON.eye : ICON.eyeOff;
  });

  const btn = h('button', { class: 'rb-btn', type: 'submit' }, 'Log in');
  const form = h('form', { autocomplete: 'on' }, user, h('div', { class: 'pw-wrap' }, pw, eye), err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!user.value.trim() || !pw.value) {
      err.textContent = 'กรอก Username และรหัสผ่านก่อน';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'กำลังเข้าสู่ระบบ...';
    try {
      await signIn(user.value, pw.value);
      onDone();
    } catch (ex) {
      err.textContent = ex.message || 'เข้าสู่ระบบไม่สำเร็จ';
      btn.disabled = false;
      btn.textContent = 'Log in';
    }
  });

  return h(
    'div',
    { class: 'login' },
    h('img', { class: 'logo', src: cover, alt: 'Augrixs Community' }),
    h('h1', {}, 'Augrant'),
    form,
    h('p', { class: 'notice' }, 'บัญชีสร้างโดยแอดมินเท่านั้น แอปบันทึกเวลาเข้าออกและคลิปที่คุณสร้างเพื่อให้แอดมินดูได้'),
  );
}
