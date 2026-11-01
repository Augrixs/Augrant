import './fonts.js';
import './styles.css';
import { h, icon } from './util.js';
import { loadProfile, me, startTracking } from './supa.js';
import { loginView } from './ui/login.js';
import { homeView, settingsView, creditsView } from './ui/home.js';
import { profileView } from './ui/profile.js';
import { adminView } from './ui/admin.js';
import { createFlow } from './ui/create.js';
import { installTapSounds } from './sfx.js';

const app = document.getElementById('app');
let current = null; // the node of the screen on show, kept so we can dispose the editor

function mount(node, nav) {
  if (current && current.dispose) current.dispose();
  current = node;
  app.replaceChildren(node, ...(nav ? [nav] : []));
}

function navBar(active, go) {
  const items = [['home', 'home', 'Home'], ['profile', 'user', 'Profile']];
  if (me.profile && me.profile.role === 'admin') items.push(['admin', 'shield', 'Admin']);
  const bar = h('nav', { class: 'nav', 'aria-label': 'เมนูหลัก' });
  items.forEach(([id, ic, label]) => {
    const b = h('button', { type: 'button', class: id === active ? 'on' : '' }, icon(ic), label);
    b.addEventListener('click', () => go(id));
    bar.append(b);
  });
  return bar;
}

function go(route) {
  if (!me.profile && route !== 'login') return go('login');
  switch (route) {
    case 'login':
      return mount(loginView(() => go('home')));
    case 'home':
      return mount(homeView(go), navBar('home', go));
    case 'settings':
      return mount(settingsView(go), navBar('home', go));
    case 'credits':
      return mount(creditsView(go), navBar('home', go));
    case 'create':
      return mount(createFlow(() => go('home')));
    case 'profile':
      return mount(profileView(go), navBar('profile', go));
    case 'admin':
      if (me.profile.role !== 'admin') return go('home');
      return mount(adminView(), navBar('admin', go));
    default:
      return go('home');
  }
}

async function boot() {
  app.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  try {
    const p = await loadProfile();
    if (p) {
      startTracking();
      return go('home');
    }
  } catch {
    /* offline or session expired: show login */
  }
  go('login');
}

installTapSounds();
boot();
