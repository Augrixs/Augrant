import { h, ICON, toast } from '../util.js';
import { signIn, sendEmailCode, verifyEmailCode, googleSignIn, finishSignUp, usernameFree, normUsername, validUsername, signOutNow } from '../supa.js';
import cover from '../assets/cover.png';

function pwField(placeholder, autocomplete) {
  const pw = h('input', { class: 'rb-input', type: 'password', placeholder, autocomplete, 'aria-label': placeholder });
  let shown = false;
  // Eye with a cross = password hidden (shown as dots). Plain eye = password visible.
  const eye = h('button', { class: 'eye', type: 'button', 'aria-label': 'แสดงหรือซ่อนรหัสผ่าน' });
  eye.innerHTML = ICON.eyeOff;
  eye.addEventListener('click', () => {
    shown = !shown;
    pw.type = shown ? 'text' : 'password';
    eye.innerHTML = shown ? ICON.eye : ICON.eyeOff;
  });
  return { pw, wrap: h('div', { class: 'pw-wrap' }, pw, eye) };
}

const shell = (...kids) =>
  h('div', { class: 'login' }, h('img', { class: 'logo', src: cover, alt: 'Augrixs Community' }), h('h1', {}, 'Augrant'), ...kids);

// go(route) is the app router
export function loginView(go) {
  const root = h('div', {});
  const show = (el) => root.replaceChildren(el);

  /* ---- sign in ---- */
  function signInStep() {
    const user = h('input', { class: 'rb-input', type: 'text', placeholder: 'Username หรืออีเมล', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Username หรืออีเมล' });
    const { pw, wrap } = pwField('Password', 'current-password');
    const err = h('div', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'rb-btn', type: 'submit' }, 'Sign in');
    const form = h('form', { autocomplete: 'on' }, user, wrap, err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!user.value.trim() || !pw.value) {
        err.textContent = 'กรอก Username (หรืออีเมล) และรหัสผ่านก่อน';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'กำลังเข้าสู่ระบบ...';
      try {
        const p = await signIn(user.value, pw.value);
        go(p ? 'home' : 'setup');
      } catch (ex) {
        err.textContent = ex.message || 'เข้าสู่ระบบไม่สำเร็จ';
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });
    show(
      shell(
        form,
        h('button', { class: 'link-btn', type: 'button', onclick: signUpStep }, 'ยังไม่มีบัญชี? สร้างบัญชีใหม่'),
        h('p', { class: 'notice' }, 'แอปบันทึกเวลาเข้าออกและคลิปที่คุณสร้างเพื่อให้แอดมินดูได้'),
      ),
    );
  }

  /* ---- sign up, step 1: Google or an email address ---- */
  function signUpStep() {
    const err = h('div', { class: 'err', role: 'alert' });
    const g = h('button', { class: 'google-btn', type: 'button' }, h('span', { class: 'g' }, 'G'), 'สมัครด้วย Google');
    g.addEventListener('click', async () => {
      err.textContent = '';
      try {
        await googleSignIn();
      } catch (ex) {
        err.textContent = 'เปิด Google ไม่ได้: ' + (ex.message || ex);
      }
    });
    const email = h('input', { class: 'rb-input', type: 'email', placeholder: 'อีเมล (Gmail, Hotmail หรืออื่นๆ)', autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false', inputmode: 'email', 'aria-label': 'อีเมล' });
    const send = h('button', { class: 'rb-btn', type: 'submit' }, 'ส่งรหัสยืนยัน 6 ตัว');
    const form = h('form', {}, email, err, send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const v = email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        err.textContent = 'อีเมลไม่ถูกต้อง';
        return;
      }
      send.disabled = true;
      send.textContent = 'กำลังส่ง...';
      try {
        await sendEmailCode(v);
        codeStep(v);
      } catch (ex) {
        err.textContent = ex.message;
        send.disabled = false;
        send.textContent = 'ส่งรหัสยืนยัน 6 ตัว';
      }
    });
    show(shell(h('h2', { class: 'step-title' }, 'สร้างบัญชี'), g, h('div', { class: 'or' }, h('span', {}, 'หรือ')), form, h('button', { class: 'link-btn', type: 'button', onclick: signInStep }, 'มีบัญชีแล้ว? Sign in')));
  }

  /* ---- step 2: the 6-digit code ---- */
  function codeStep(email) {
    const err = h('div', { class: 'err', role: 'alert' });
    const code = h('input', { class: 'rb-input code-input', type: 'text', inputmode: 'numeric', maxlength: 6, placeholder: '------', autocomplete: 'one-time-code', 'aria-label': 'รหัส 6 ตัว' });
    const ok = h('button', { class: 'rb-btn', type: 'submit' }, 'ยืนยัน');
    const form = h('form', {}, code, err, ok);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!/^\d{6}$/.test(code.value.trim())) {
        err.textContent = 'ใส่เลข 6 ตัวที่ส่งไปทางอีเมล';
        return;
      }
      ok.disabled = true;
      try {
        const p = await verifyEmailCode(email, code.value);
        go(p ? 'home' : 'setup');
      } catch (ex) {
        err.textContent = ex.message;
        ok.disabled = false;
      }
    });
    show(
      shell(
        h('h2', { class: 'step-title' }, 'ยืนยันอีเมล'),
        h('p', { class: 'notice' }, 'ส่งรหัส 6 ตัวไปที่ ' + email + ' แล้ว (ดูในกล่องสแปมด้วย)'),
        form,
        h('button', { class: 'link-btn', type: 'button', onclick: async () => { try { await sendEmailCode(email); toast('ส่งรหัสใหม่แล้ว'); } catch (ex) { err.textContent = ex.message; } } }, 'ส่งรหัสอีกครั้ง'),
        h('button', { class: 'link-btn', type: 'button', onclick: signUpStep }, 'เปลี่ยนอีเมล'),
      ),
    );
  }

  signInStep();
  return root;
}

// Step 3 of sign-up: username, password, optional birthday and gender.
export function setupView(go) {
  const user = h('input', { class: 'rb-input', type: 'text', placeholder: 'ตั้ง Username (a-z 0-9 _ . -)', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 24 });
  const hint = h('div', { class: 'small muted' }, 'ซ้ำกับคนอื่นไม่ได้');
  const { pw, wrap } = pwField('ตั้งรหัสผ่าน (อย่างน้อย 8 ตัว)', 'new-password');
  const bday = h('input', { class: 'rb-input', type: 'date', 'aria-label': 'วันเกิด (ไม่ใส่ก็ได้)' });
  let gender = '';
  const chips = h('div', { class: 'chips' });
  const paint = () =>
    chips.replaceChildren(
      ...[['', 'ไม่ระบุ'], ['male', 'ชาย'], ['female', 'หญิง']].map(([v, l]) =>
        h('button', { class: 'chip' + (gender === v ? ' on' : ''), type: 'button', onclick: () => { gender = v; paint(); } }, l),
      ),
    );
  paint();
  const err = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'rb-btn', type: 'submit' }, 'เสร็จสิ้น เข้าใช้งาน');

  let t = 0;
  let free = null;
  user.addEventListener('input', () => {
    clearTimeout(t);
    free = null;
    const u = normUsername(user.value);
    if (!u) return (hint.textContent = 'ซ้ำกับคนอื่นไม่ได้');
    if (!validUsername(u)) return (hint.textContent = 'ใช้ a-z 0-9 _ . - ยาว 3-24 ตัว');
    hint.textContent = 'กำลังเช็ก...';
    t = setTimeout(async () => {
      try {
        free = await usernameFree(u);
        hint.textContent = free ? '✓ ใช้ได้' : '✗ มีคนใช้แล้ว';
        hint.style.color = free ? 'var(--ok)' : '#ff8a8a';
      } catch {
        hint.textContent = '';
      }
    }, 400);
  });

  const form = h('form', {}, user, hint, wrap, h('label', { class: 'field' }, 'วันเกิด (ไม่ใส่ก็ได้)', bday), h('div', { class: 'field' }, 'เพศ (ไม่เลือกก็ได้)', chips), err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pw.value.length < 8) {
      err.textContent = 'รหัสผ่านอย่างน้อย 8 ตัว';
      return;
    }
    btn.disabled = true;
    try {
      await finishSignUp({ username: user.value, password: pw.value, birthday: bday.value || null, gender });
      go('home');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
  return shell(
    h('h2', { class: 'step-title' }, 'ตั้งค่าบัญชี'),
    form,
    h('button', { class: 'link-btn', type: 'button', onclick: async () => { await signOutNow(); go('login'); } }, 'ยกเลิก'),
  );
}
