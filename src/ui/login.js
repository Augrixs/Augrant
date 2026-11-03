import { h, ICON, toast, lang, loadSettings, saveSettings } from '../util.js';
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

// Thai / English switch, available before signing in
function langToggle() {
  const en = lang() === 'en';
  return h(
    'button',
    {
      class: 'link-btn lang-toggle',
      type: 'button',
      'data-keep': '',
      onclick: () => {
        const s = loadSettings();
        s.lang = en ? 'th' : 'en';
        saveSettings(s);
        window.location.reload();
      },
    },
    en ? 'ไทย' : 'English',
  );
}
const shell = (...kids) =>
  h('div', { class: 'login' }, langToggle(), h('img', { class: 'logo', src: cover, alt: 'Augrixs Community' }), h('h1', {}, 'Augrant'), ...kids);

// go(route) is the app router
export function loginView(go) {
  const root = h('div', {});
  const show = (el) => root.replaceChildren(el);

  /* ---- the one screen: continue with Google ---- */
  function mainStep() {
    const err = h('div', { class: 'err', role: 'alert' });
    const g = h('button', { class: 'google-btn', type: 'button' }, h('span', { class: 'g' }, 'G'), 'ดำเนินการต่อด้วย Google');
    g.addEventListener('click', async () => {
      err.textContent = '';
      try {
        await googleSignIn();
      } catch (ex) {
        err.textContent = 'เปิด Google ไม่ได้: ' + (ex.message || ex);
      }
    });
    show(
      shell(
        g,
        err,
        h('p', { class: 'notice' }, 'ใช้บัญชี Google เข้าใช้งาน ถ้ายังไม่มีบัญชีใน Augrant จะให้ตั้ง username ต่อ'),
        h('button', { class: 'link-btn small-link', type: 'button', onclick: signInStep }, 'บัญชีเก่า? เข้าด้วย Username'),
      ),
    );
  }

  /* ---- old accounts: username and password ---- */
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
    const gIn = h('button', { class: 'google-btn', type: 'button' }, h('span', { class: 'g' }, 'G'), 'เข้าสู่ระบบด้วย Google');
    gIn.addEventListener('click', async () => {
      err.textContent = '';
      try {
        await googleSignIn();
      } catch (ex) {
        err.textContent = 'เปิด Google ไม่ได้: ' + (ex.message || ex);
      }
    });
    show(
      shell(
        form,
        h('button', { class: 'link-btn', type: 'button', onclick: mainStep }, 'กลับ'),
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
    show(shell(h('h2', { class: 'step-title' }, 'สร้างบัญชี'), g, err, h('p', { class: 'notice' }, 'สมัครได้ด้วยบัญชี Google เท่านั้น ไม่ต้องตั้งรหัสผ่าน'), h('button', { class: 'link-btn', type: 'button', onclick: signInStep }, 'มีบัญชีแล้ว? Sign in')));
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

  mainStep();
  return root;
}

// Step 3 of sign-up: username, password, optional birthday and gender.
export function setupView(go) {
  const user = h('input', { class: 'rb-input', type: 'text', placeholder: 'ตั้ง Username (a-z 0-9 _ . -)', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 24 });
  const dname = h('input', { class: 'rb-input', type: 'text', placeholder: 'ชื่อที่แสดง (Display name) ไม่ใส่ก็ได้', maxlength: 30, autocomplete: 'nickname' });
  const hint = h('div', { class: 'small muted' }, 'ซ้ำกับคนอื่นไม่ได้');
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

  const form = h('form', {}, user, hint, dname, h('label', { class: 'field' }, 'วันเกิด (ไม่ใส่ก็ได้)', bday), h('div', { class: 'field' }, 'เพศ (ไม่เลือกก็ได้)', chips), err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      await finishSignUp({ username: user.value, displayName: dname.value, password: '', birthday: bday.value || null, gender });
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
