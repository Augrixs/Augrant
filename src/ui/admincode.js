import { h, toast } from '../util.js';
import { me, sendEmailCode, verifyEmailCode } from '../supa.js';

// Extra lock for the Admin panel: a 6-digit code mailed to the Google account (valid 1 minute).
export function adminCodeView(onOk, onBack) {
  const email = (me.user && me.user.email) || '';
  const inp = h('input', { class: 'rb-input', type: 'text', inputmode: 'numeric', maxlength: 6, placeholder: '------', autocomplete: 'one-time-code' });
  const ok = h('button', { class: 'btn primary', type: 'button' }, 'Verify');
  const send = h('button', { class: 'btn', type: 'button' }, 'Send code');
  const info = h('p', { class: 'muted' }, 'We will email a 6-digit code to ' + email + '. It works for 1 minute.');
  let wait = 0, timer = 0;
  const tick = () => {
    send.disabled = wait > 0;
    send.textContent = wait > 0 ? 'Resend in ' + wait + 's' : 'Send code';
    if (wait > 0) { wait--; timer = setTimeout(tick, 1000); }
  };
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await sendEmailCode(email, false);
      toast('Code sent to ' + email);
      wait = 60;
      tick();
    } catch (e) {
      toast(e.message, 4500);
      send.disabled = false;
    }
  });
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      await verifyEmailCode(email, inp.value);
      clearTimeout(timer);
      onOk();
    } catch (e) {
      toast('Wrong or expired code', 3500);
      ok.disabled = false;
    }
  });
  const root = h('div', { class: 'screen verify' }, h('div', { class: 'verify-box' }, h('h1', {}, 'Admin check'), info, send, inp, ok, h('button', { class: 'small-link', type: 'button', onclick: onBack }, 'Back')));
  root.dispose = () => clearTimeout(timer);
  return root;
}
