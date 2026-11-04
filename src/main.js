import './fonts.js';
import './styles.css';
import { h, icon, lang } from './util.js';
import { startTranslator } from './i18n.js';
import { loadProfile, me, startTracking, handleAuthUrl, signOutNow, needVerify } from './supa.js';
import { loginView, setupView, verifyView } from './ui/login.js';
import { homeView, settingsView, creditsView, trashView, bannedView } from './ui/home.js';
import { activeBan } from './bans.js';
import { profileView } from './ui/profile.js';
import { adminView } from './ui/admin.js';
import { adminCodeView } from './ui/admincode.js';
import { createFlow } from './ui/create.js';
import { socialView, userView } from './ui/social.js';
import { postsView, postView } from './ui/posts.js';
import { shopView } from './ui/shop.js';
import { inboxView } from './ui/inbox.js';
import { chatListView, chatView } from './ui/chat.js';
import { badgeCounts } from './social.js';
import { installTapSounds } from './sfx.js';
import { App } from '@capacitor/app';

const app = document.getElementById('app');
startTranslator(lang);
let current = null; // the node of the screen on show, kept so we can dispose the editor
let navEl = null;
let activeTab = 'home';
let badges = { friends: 0, requests: 0, unread: 0, messages: 0, hasInbox: false };
let deepPost = null; // a shared post link waiting for the person to be signed in

function navBar(active) {
  // Home Profile Social Post, then Chat (once you have a friend), Inbox (once something arrived), Admin (admins only)
  const items = [['home', 'home', 'Home'], ['profile', 'user', 'Profile'], ['social', 'users', 'Social'], ['post', 'image', 'Post'], ['shop', 'bag', 'Shop']];
  if (badges.friends > 0) items.push(['chat', 'chat', 'Chat', badges.messages]);
  if (badges.hasInbox) items.push(['inbox', 'bell', 'Inbox', badges.unread]);
  if (me.profile && me.profile.role === 'admin') items.push(['admin', 'shield', 'Admin']);
  const bar = h('nav', { class: 'nav', 'aria-label': 'เมนูหลัก' });
  items.forEach(([id, ic, label, n]) => {
    const b = h('button', { type: 'button', class: id === active ? 'on' : '' }, h('span', { class: 'ic-wrap' }, icon(ic), n ? h('span', { class: 'badge' }, n > 99 ? '99+' : String(n)) : null), label);
    b.addEventListener('click', () => go(id));
    bar.append(b);
  });
  return bar;
}

function mount(node, active) {
  if (current && current.dispose) current.dispose();
  current = node;
  activeTab = active || null;
  navEl = active ? navBar(active) : null;
  app.replaceChildren(node, ...(navEl ? [navEl] : []));
}

async function refreshBadges() {
  if (!me.profile) return;
  checkBan();
  try {
    badges = await badgeCounts();
  } catch {
    return;
  }
  if (navEl && activeTab) {
    const fresh = navBar(activeTab);
    navEl.replaceWith(fresh);
    navEl = fresh;
  }
}

function takeDeepLink() {
  const m = (location.hash || '').match(/#\/post\/([0-9a-f-]{36})/i);
  if (m) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* ignore */
    }
    deepPost = m[1];
  }
  const id = deepPost;
  deepPost = null;
  return id;
}

let adminOk = false; // admin code entered this session
let banNow = null; // the active ban of this account, if any
async function checkBan() {
  if (!me.user) return;
  try {
    const b = await activeBan();
    const was = !!banNow;
    banNow = b;
    if (b && !was) go('banned');
    else if (!b && was) go('home');
  } catch {
    /* offline: keep what we had */
  }
}

function go(route) {
  if (banNow && me.profile && route !== 'login' && route !== 'banned') return go('banned');
  if (!me.profile && route !== 'login' && route !== 'setup') {
    takeDeepLinkLater();
    return go(me.user ? 'setup' : 'login');
  }
  const [r, arg] = String(route).split(':');
  refreshBadges();
  switch (r) {
    case 'banned':
      return mount(bannedView(banNow || { label: '', reason: '' }, () => { banNow = null; go('home'); }, async () => { await signOutNow(); banNow = null; go('login'); }));
    case 'verify':
      return mount(verifyView(() => go(me.profile ? 'home' : 'setup'), () => go('login')));
    case 'login':
      return mount(loginView(go));
    case 'setup':
      return mount(setupView(go));
    case 'home': {
      const d = takeDeepLink();
      if (d) return go('postview:' + d);
      return mount(homeView(go), 'home');
    }
    case 'settings':
      return mount(settingsView(go), 'home');
    case 'credits':
      return mount(creditsView(go), 'home');
    case 'create':
      return mount(createFlow(() => go('home'), arg));
    case 'shop':
      return mount(shopView(go), 'shop');
    case 'trash':
      return mount(trashView(go), 'home');
    case 'profile':
      return mount(profileView(go), 'profile');
    case 'social':
      return mount(socialView(go), 'social');
    case 'user':
      return mount(userView(go, arg), 'social');
    case 'post':
      return mount(postsView(go), 'post');
    case 'posts':
      return mount(postsView(go, { authorId: arg }), arg === me.user.id ? 'profile' : 'social');
    case 'postview':
      return mount(postView(go, arg), 'post');
    case 'inbox':
      return mount(inboxView(go, refreshBadges), 'inbox');
    case 'chat':
      return arg ? mount(chatView(go, arg, refreshBadges), 'chat') : mount(chatListView(go), 'chat');
    case 'admin':
      if (me.profile.role !== 'admin') return go('home');
      if (!adminOk) return mount(adminCodeView(() => { adminOk = true; go('admin'); }, () => go('home')), 'admin');
      return mount(adminView(), 'admin');
    default:
      return go('home');
  }
}

function takeDeepLinkLater() {
  const m = (location.hash || '').match(/#\/post\/([0-9a-f-]{36})/i);
  if (m) deepPost = m[1];
}

async function boot() {
  app.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  try {
    const p = await loadProfile();
    if (p) {
      startTracking();
      setInterval(refreshBadges, 20000);
      await checkBan();
      if (needVerify() && me.user) return go('verify');
      return go(banNow ? 'banned' : 'home');
    }
    if (me.user && needVerify()) return go('verify');
    if (me.user) return go('setup'); // signed up but no username yet
  } catch {
    /* offline or session expired: show login */
  }
  takeDeepLinkLater();
  go('login');
}

// a shared post link opened while the app is running
try {
  App.addListener('appUrlOpen', async ({ url }) => {
    if (await handleAuthUrl(url)) {
      const p = await loadProfile();
      if (p) startTracking();
      return go('verify');
    }
    const m = String(url || '').match(/#\/post\/([0-9a-f-]{36})/i);
    if (!m) return;
    deepPost = m[1];
    if (me.profile) go('home');
  });
} catch {
  /* running in a browser */
}
window.addEventListener('hashchange', () => {
  if (me.profile && /#\/post\//.test(location.hash)) go('home');
});

installTapSounds();
boot();
