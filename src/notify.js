// Phone notifications. Asks permission once, then shows a notification when something new arrives
// (friend request, like, comment, message) while the app is open or just went to the background.
// True push while the app is fully closed needs Firebase (FCM) and a server, which is not set up.
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

const native = Capacitor.isNativePlatform();
let last = null;

export async function askNotifyPermission() {
  if (!native) return false;
  try {
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === 'granted') return true;
    const r = await LocalNotifications.requestPermissions();
    return r.display === 'granted';
  } catch {
    return false;
  }
}

// counts: { messages, unread, requests } from badgeCounts()
export async function notifyIfNew(counts) {
  if (!native) return;
  const now = { messages: counts.messages || 0, unread: counts.unread || 0, requests: counts.requests || 0 };
  const prev = last;
  last = now;
  if (!prev) return; // first reading: do not announce what was already there
  const lines = [];
  if (now.messages > prev.messages) lines.push('New message');
  if (now.requests > prev.requests) lines.push('New friend request');
  if (now.unread > prev.unread) lines.push('New notification in Inbox');
  if (!lines.length) return;
  try {
    await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2147483000), title: 'Augrant', body: lines.join(' · '), schedule: { at: new Date(Date.now() + 300) } }] });
  } catch {
    /* permission denied */
  }
}
