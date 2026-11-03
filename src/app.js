// EmpreenderTHZ Astronomy Center — inicialização, rotas e atualização em tempo real (Etapa 3, app Android).
import { $, $$, api, apiUrl, disposeAllCharts, loadFavorites, state, toggleFavorite, tz } from './js/core.js?v=0.3.0';
import { loadWidget, mountedFor } from './js/widgets.js?v=0.3.0';
import {
  viewExo, viewFavorites, viewImages, viewMission, viewNeo, viewOps, viewOverview, viewPrivacy, viewSky,
  viewSpaceWeather, viewTelescopes,
} from './js/views.js?v=0.3.0';
import { refreshNativeAlerts, startAlerts, viewEvents, viewSolarSystem } from './js/explore.js?v=0.3.0';

const ROUTES = {
  overview: viewOverview, mission: viewMission, 'space-weather': viewSpaceWeather, neo: viewNeo, exoplanets: viewExo,
  images: viewImages, sky: viewSky, telescopes: viewTelescopes, favorites: viewFavorites, ops: viewOps, privacy: viewPrivacy,
  'solar-system': viewSolarSystem, events: viewEvents,
};

function parseHash() {
  const raw = location.hash.slice(1);
  const [name, query = ''] = raw.split('?');
  return { name: ROUTES[name] ? name : 'overview', params: new URLSearchParams(query) };
}

function route() {
  const { name, params } = parseHash();
  disposeAllCharts();
  state.timers.forEach(clearInterval); state.timers = [];
  state.mounted = [];
  document.body.classList.remove('kiosk');
  $$('.sidenav a, .tabbar a').forEach((a) => { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const root = $('#view');
  const keepScroll = name === 'mission' && params.get('editar') === '1';
  const y = window.scrollY;
  ROUTES[name](root, params);
  root.focus({ preventScroll: true });
  window.scrollTo(0, keepScroll ? y : 0);
}

// ------------------------------------------------------------------ tempo real (SSE)
let pending = new Set(); let flushTimer = null; let ledTimer = null;
function onSync(ev) {
  if (ev.ok) mountedFor(ev.source_id).forEach((p) => pending.add(p));
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { const list = [...pending]; pending = new Set(); list.forEach(loadWidget); }, 1500);
  clearTimeout(ledTimer); ledTimer = setTimeout(refreshLed, 2000);
}
const STREAM_OFF = window.THZ_CONFIG?.stream === false; // hospedagem sem suporte a SSE
function connectStream() {
  if (!window.EventSource || STREAM_OFF) return;
  const es = new EventSource(apiUrl('/api/stream'));
  es.addEventListener('sync', (e) => { try { onSync(JSON.parse(e.data)); } catch { /* evento malformado: ignora */ } });
  es.onopen = () => { state.streamUp = true; refreshLed(); };
  es.onerror = () => { state.streamUp = false; refreshLed(); }; // o navegador reconecta sozinho
}
// Rede de segurança caso o fluxo SSE esteja bloqueado por proxy: recarrega painéis a cada 10 min.
setInterval(() => { if (!state.streamUp) state.mounted.forEach((m) => loadWidget(m.panel)); }, 600000);

async function refreshLed() {
  const rep = await api('/api/sources');
  const led = $('#sources-led .led'); const text = $('#sources-led-text');
  const live = STREAM_OFF ? 'painéis recarregados a cada 10 minutos' : state.streamUp ? 'atualização automática ativa' : 'atualização automática desconectada';
  if (!rep.sources) { led.className = 'led bad'; text.textContent = 'Servidor sem resposta'; return; }
  const tried = rep.sources.filter((s) => s.health !== 'idle');
  const ok = tried.filter((s) => s.health === 'operational').length;
  const down = tried.filter((s) => s.health === 'down').length;
  if (!tried.length) { led.className = 'led'; text.textContent = `Fontes aguardando; ${live}`; return; }
  led.className = `led ${down ? 'bad' : ok === tried.length ? 'ok' : 'warn'}`;
  text.textContent = `${ok}/${tried.length} fontes operacionais`;
  $('#sources-led').title = `Estado das fontes científicas; ${live}`;
  $('#stream-state').textContent = STREAM_OFF ? 'Atualização a cada 10 minutos' : state.streamUp ? 'Atualização automática ativa' : 'Atualização automática desconectada';
  $('#stream-state').dataset.up = String(state.streamUp);
}

function tickClocks() {
  const now = new Date();
  const f = (zone) => new Intl.DateTimeFormat('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
  $('#clock-utc').textContent = f('UTC');
  $('#clock-local').textContent = f(tz());
}

async function init() {
  const cfg = await api('/api/config');
  state.config = cfg && cfg.brand ? cfg : null;
  if (state.config) {
    $('#clock-local-label').textContent = state.config.site.name;
    const img = $('#brand-logo');
    img.onload = () => { img.hidden = false; $('.brand').classList.add('has-logo'); };
    const logo = String(state.config.brand.logo_url || '');
    // No app, a pasta brand/ fica no site web (config.js → siteBase).
    const siteBase = String(window.THZ_CONFIG?.siteBase || '').replace(/\/+$/, '');
    img.src = logo.startsWith('/brand/') ? (siteBase ? siteBase + logo : logo.slice(1)) : logo;
  } else {
    const box = $('#api-down');
    box.innerHTML = '<strong>O servidor de dados da plataforma não respondeu.</strong> Os painéis dependem dele para buscar as fontes científicas. '
      + 'Verifique a conexão do celular e tente de novo. <button class="btn secondary" type="button" id="api-retry">Tentar de novo</button>';
    $('#api-retry').addEventListener('click', () => location.reload());
    box.hidden = false;
  }
  tickClocks(); setInterval(tickClocks, 1000);
  setInterval(refreshLed, 60000);
  document.addEventListener('click', (e) => {
    const fs = e.target.closest('[data-fs]');
    if (fs) { const p = document.getElementById(fs.dataset.fs); if (document.fullscreenElement) document.exitFullscreen(); else p?.requestFullscreen?.(); }
    const fav = e.target.closest('.fav-btn');
    if (fav) toggleFavorite(fav);
  });
  document.addEventListener('fullscreenchange', () => setTimeout(() => state.charts.forEach((c) => c.resize()), 120));
  window.addEventListener('resize', () => state.charts.forEach((c) => c.resize()));
  // Outra janela do Mission Control mudou o layout: redesenha esta.
  window.addEventListener('storage', (e) => { if (e.key === 'thz-mission-layout' && parseHash().name === 'mission') route(); });
  $('.dialog-close').addEventListener('click', () => $('#detail').close());
  $('#detail').addEventListener('click', (e) => { if (e.target.id === 'detail') $('#detail').close(); });
  window.addEventListener('hashchange', route);
  // App voltou para a frente: atualiza fontes, painéis e renova a agenda de notificações.
  window.addEventListener('thz:resume', () => {
    refreshLed();
    state.mounted.forEach((m) => loadWidget(m.panel));
    refreshNativeAlerts();
  });
  await loadFavorites();
  route();
  window.THZNative?.ready();
  connectStream();
  startAlerts();
  setTimeout(refreshLed, 3000);
}

init();
