// EmpreenderTHZ Astronomy Center — ponte entre a interface web e o Android (Capacitor).
// Empacotado pelo esbuild em www/vendor/native.js (script clássico, carregado antes dos módulos do app).
// Expõe window.THZNative. No navegador comum (npm run serve) tudo continua funcionando com recursos web.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Clipboard } from '@capacitor/clipboard';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';

const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();
const CHANNEL = 'eventos';
const AUTO_KEY = 'thz-native-auto-ids';
const ONE_KEY = 'thz-native-reminders';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

// ------------------------------------------------------------------ links externos
async function openExternal(url) {
  if (!/^https?:/i.test(url)) return;
  if (isNative) {
    try { await Browser.open({ url, toolbarColor: '#040A1A' }); return; } catch { /* cai para o navegador do sistema */ }
  }
  window.open(url, '_blank', 'noopener');
}

async function copyText(text) {
  if (isNative) { await Clipboard.write({ string: String(text) }); return; }
  await navigator.clipboard.writeText(String(text));
}

// ------------------------------------------------------------------ notificações locais
const hashId = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 1) % 2000000000 + 100000; };
const fmtWhen = (iso, tz) => {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; }
};
let channelReady = null;
function ensureChannel() {
  if (!channelReady) {
    channelReady = LocalNotifications.createChannel({
      id: CHANNEL, name: 'Eventos astronômicos', description: 'Avisos de eclipses, chuvas de meteoros, conjunções e outros eventos',
      importance: 4, visibility: 1, vibration: true, lights: true, lightColor: '#4FD6EC',
    }).catch(() => null);
  }
  return channelReady;
}
/** Pede permissão de notificação (Android 13+). Retorna true se concedida. */
async function notificationsAllowed(ask = true) {
  if (!isNative) return false;
  try {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted' && ask) p = await LocalNotifications.requestPermissions();
    if (p.display === 'granted') { await ensureChannel(); return true; }
  } catch { /* plugin indisponível */ }
  return false;
}
function buildNotification(id, e, leadMin, tz) {
  const at = new Date(new Date(e.when).getTime() - leadMin * 60000);
  return {
    id, title: e.title,
    body: `${fmtWhen(e.when, tz)} (${tz}). ${e.visibility || e.description || ''}`.trim(),
    largeBody: `${fmtWhen(e.when, tz)} (${tz}).\n${e.visibility || ''}\n${e.description || ''}`.trim(),
    schedule: { at, allowWhileIdle: true },
    channelId: CHANNEL, smallIcon: 'ic_stat_thz', iconColor: '#4FD6EC',
    extra: { route: 'events', when: e.when, type: e.type },
  };
}
/**
 * Agenda os alertas automáticos (substitui a agenda anterior).
 * events: lista da API /api/events; cfg: { lead (min), site: { tz } }.
 */
async function scheduleAlerts(events, cfg) {
  if (!isNative) return { ok: false, reason: 'web' };
  const old = store.get(AUTO_KEY, []);
  if (old.length) await LocalNotifications.cancel({ notifications: old.map((id) => ({ id })) }).catch(() => null);
  store.set(AUTO_KEY, []);
  if (!cfg || !cfg.enabled) return { ok: true, count: 0 };
  if (!(await notificationsAllowed(true))) return { ok: false, reason: 'permission' };
  const tz = cfg.site?.tz || 'America/Sao_Paulo';
  const now = Date.now() + 30000;
  const list = (events || [])
    .filter((e) => new Date(e.when).getTime() - cfg.lead * 60000 > now)
    .slice(0, 60)
    .map((e) => buildNotification(hashId(`auto|${e.type}|${e.when}`), e, cfg.lead, tz));
  if (list.length) await LocalNotifications.schedule({ notifications: list });
  store.set(AUTO_KEY, list.map((n) => n.id));
  return { ok: true, count: list.length, until: events?.length ? events[events.length - 1].when : null };
}
/** Lembrete de um único evento. */
async function remindOne(e, leadMin, tz) {
  if (!isNative) return { ok: false, reason: 'web' };
  if (!(await notificationsAllowed(true))) return { ok: false, reason: 'permission' };
  const at = new Date(e.when).getTime() - leadMin * 60000;
  if (at <= Date.now() + 30000) return { ok: false, reason: 'past' };
  const id = hashId(`one|${e.type}|${e.when}`);
  await LocalNotifications.schedule({ notifications: [buildNotification(id, e, leadMin, tz)] });
  const mine = store.get(ONE_KEY, {}); mine[`${e.type}|${e.when}`] = { id, at }; store.set(ONE_KEY, mine);
  return { ok: true, at: new Date(at).toISOString() };
}
function hasReminder(e) {
  const r = store.get(ONE_KEY, {})[`${e.type}|${e.when}`];
  return Boolean(r && r.at > Date.now());
}

// ------------------------------------------------------------------ interface: menu, tela cheia, voltar
const $ = (s) => document.querySelector(s);
function setDrawer(open) {
  document.body.classList.toggle('nav-open', open);
  const scrim = $('#nav-scrim'); if (scrim) scrim.hidden = !open;
  $('#menu-btn')?.setAttribute('aria-expanded', String(open));
  if (open) $('#sidenav a[aria-current="page"]')?.focus({ preventScroll: true });
}
function exitMax() {
  const p = document.querySelector('.panel--max');
  if (!p) return false;
  p.classList.remove('panel--max'); document.body.classList.remove('has-max');
  setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
  return true;
}
function toggleMax(panel) {
  if (!panel) return;
  if (panel.classList.contains('panel--max')) { exitMax(); return; }
  exitMax();
  panel.classList.add('panel--max'); document.body.classList.add('has-max');
  setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
}
const currentRoute = () => (location.hash.slice(1).split('?')[0] || 'overview');

function wireUI() {
  $('#menu-btn')?.addEventListener('click', () => setDrawer(!document.body.classList.contains('nav-open')));
  $('#tab-more')?.addEventListener('click', () => setDrawer(true));
  $('#nav-scrim')?.addEventListener('click', () => setDrawer(false));
  $('#sidenav')?.addEventListener('click', (e) => { if (e.target.closest('a')) setDrawer(false); });
  window.addEventListener('hashchange', () => { setDrawer(false); exitMax(); });

  // Captura antes dos ouvintes do app: tela cheia vira "painel maximizado" e links externos abrem fora do app.
  window.addEventListener('click', (e) => {
    const fs = e.target.closest?.('[data-fs]');
    if (fs) { e.stopPropagation(); e.preventDefault(); toggleMax(document.getElementById(fs.dataset.fs)); return; }
    const a = e.target.closest?.('a[href]');
    if (a && !e.defaultPrevented) {
      let url; try { url = new URL(a.getAttribute('href'), location.href); } catch { return; }
      if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) { e.preventDefault(); openExternal(url.href); }
    }
  }, true);

  if (isNative) {
    const nativeOpen = window.open;
    window.open = (url, ...rest) => {
      try {
        const u = new URL(url, location.href);
        if (u.origin !== location.origin) { openExternal(u.href); return null; }
        location.hash = u.hash; return null;
      } catch { return nativeOpen.call(window, url, ...rest); }
    };
  }
}

function wireNative() {
  App.addListener('backButton', ({ canGoBack }) => {
    const dlg = document.querySelector('dialog[open]');
    if (dlg) { dlg.close(); return; }
    if (exitMax()) return;
    if (document.body.classList.contains('nav-open')) { setDrawer(false); return; }
    if (currentRoute() !== 'overview') {
      if (canGoBack) history.back(); else location.hash = 'overview';
      return;
    }
    App.minimizeApp();
  });
  App.addListener('resume', () => window.dispatchEvent(new CustomEvent('thz:resume')));
  App.getInfo().then((i) => { const el = $('#app-version'); if (el) el.textContent = `v${i.version}`; }).catch(() => null);

  LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const route = a?.notification?.extra?.route;
    if (route) location.hash = route;
  });

  const net = (s) => {
    const box = $('#net-down'); if (!box) return;
    const wasDown = !box.hidden;
    box.hidden = s.connected;
    if (s.connected && wasDown) window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  Network.addListener('networkStatusChange', net);
  Network.getStatus().then(net).catch(() => null);
}

function ready() {
  if (isNative) SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => null);
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.toggle('native', true);
  document.body.classList.toggle(`platform-${platform}`, true);
  wireUI();
  if (isNative) wireNative();
});

window.THZNative = {
  isNative, platform, openExternal, copyText, ready,
  notificationsAllowed, scheduleAlerts, remindOne, hasReminder,
};
