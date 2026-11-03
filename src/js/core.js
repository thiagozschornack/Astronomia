// Base compartilhada: formatação, acesso à API, componentes de painel, gráficos,
// espaço de trabalho e favoritos.
// Regra: todo dado exibido vem de um envelope com procedência; se a fonte falhar,
// o painel mostra a falha, nunca um valor substituto.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const state = {
  config: null, charts: [], timers: [], mounted: [], seq: 0,
  pendingSearch: null, favs: new Map(), neo: { days: 30, dist_ld: 10 }, streamUp: false,
};
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const tz = () => state.config?.site?.tz || 'America/Sao_Paulo';

// ------------------------------------------------------------------ formatação
export function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz(), dateStyle: 'short', timeStyle: 'short' }).format(d);
}
export function fmtUTC(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) + ' UTC';
}
export function fmtShort(v) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz(), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
}
export function fmtNum(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export const fmtInt = (v) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'));
export const fmtDate = (ymd) => (ymd ? ymd.split('-').reverse().join('/') : '—');
export function ago(s) {
  if (s == null) return '';
  if (s < 90) return `há ${Math.round(s)} s`;
  if (s < 5400) return `há ${Math.round(s / 60)} min`;
  if (s < 172800) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
}
export function hms(deg) {
  const h = ((deg / 15) % 24 + 24) % 24; const hh = Math.floor(h); const m = (h - hh) * 60; const mm = Math.floor(m); const ss = (m - mm) * 60;
  return `${hh}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(1).padStart(4, '0')}s`;
}
export function dms(deg) {
  const sign = deg < 0 ? '−' : '+'; const a = Math.abs(deg); const d = Math.floor(a); const m = (a - d) * 60; const mm = Math.floor(m); const ss = (m - mm) * 60;
  return `${sign}${d}° ${String(mm).padStart(2, '0')}′ ${ss.toFixed(0).padStart(2, '0')}″`;
}
export const sentence = (t) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
export const latest = (rows, key) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return rows[i]; return null; };

// ------------------------------------------------------------------ armazenamento local seguro
export const local = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado: segue sem salvar */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

// ------------------------------------------------------------------ espaço de trabalho
export function workspace() {
  let ws = local.get('thz-workspace');
  if (!ws || !/^[A-Za-z0-9_-]{16,64}$/.test(ws)) {
    const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
    ws = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    local.set('thz-workspace', ws);
  }
  return ws;
}

// ------------------------------------------------------------------ API
// Endereço do servidor da API (config.js). Vazio = mesmo domínio e pasta da página.
export const API_BASE = String(window.THZ_CONFIG?.apiBase || '').replace(/\/+$/, '');
export function apiUrl(path) {
  if (API_BASE) return API_BASE + path;
  return path.replace(/^\//, ''); // relativo à pasta da página, para funcionar em subpastas
}
export async function api(path, { method = 'GET', body } = {}) {
  try {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET' || /^\/api\/(favorites|layouts|workspace)/.test(path)) headers['X-Workspace'] = workspace();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Redes móveis: desiste após 25 s em vez de deixar o painel "consultando" para sempre.
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal })
      .finally(() => clearTimeout(timer));
    const data = await r.json().catch(() => null);
    if (!data) return { status: 'unavailable', error: `Resposta inválida do servidor (HTTP ${r.status})`, data: null, http: r.status };
    if (r.status >= 400 && r.status < 500 && data.detail) {
      const msg = typeof data.detail === 'string' ? data.detail : 'Parâmetros inválidos.';
      return { status: r.status === 404 && data.status === 'not_found' ? 'not_found' : 'invalid', error: data.error || msg, data: null, http: r.status };
    }
    return { ...data, http: r.status };
  } catch {
    return { status: 'unavailable', error: 'Sem conexão com o servidor da plataforma.', data: null, http: 0 };
  }
}

// ------------------------------------------------------------------ componentes
export function head(title, text, extra = '') {
  return `<div class="view-head"><div><h1>${esc(title)}</h1>${text ? `<p>${esc(text)}</p>` : ''}</div>${extra}</div>`;
}
export function panelShell(id, title, cls = '') {
  return `<section class="panel ${cls}" id="${id}">
    <header class="panel-head"><h2>${esc(title)}</h2><div class="panel-tools">
      <button class="icon-btn" type="button" data-fs="${id}" title="Tela cheia" aria-label="Expandir ${esc(title)} em tela cheia">⤢</button></div></header>
    <div class="panel-body"><p class="loading">Consultando a fonte</p></div>
    <div class="panel-plate"></div></section>`;
}
export function plate(env) {
  if (!env || !env.source) return '';
  const s = env.source;
  const flags = [];
  if (env.status === 'stale') flags.push(`<span class="badge badge--stale">Falha na sincronização — último dado obtido ${ago(env.age_s)}</span>`);
  if (env.status === 'unavailable') flags.push('<span class="badge badge--down">Fonte temporariamente indisponível</span>');
  const inst = s.docs_url ? `<a href="${esc(s.docs_url)}" target="_blank" rel="noopener">${esc(s.institution)}</a>` : esc(s.institution);
  const times = [
    env.observed_at ? `<span><span class="plate-k">Dado de</span> ${fmtDT(env.observed_at)}</span>` : '',
    env.fetched_at ? `<span><span class="plate-k">Sincronizado</span> ${fmtDT(env.fetched_at)}</span>` : '',
  ].join('');
  return `<footer class="plate ${env.status === 'stale' ? 'plate--stale' : ''}" aria-label="Procedência do dado">
    <div class="plate-top"><span class="badge badge--${esc(env.content_type)}">${esc(env.content_label)}</span>${flags.join('')}</div>
    <p class="plate-src">${inst}</p>
    ${times ? `<p class="plate-times">${times}</p>` : ''}
    <details><summary>Procedência completa</summary><dl>
      <div><dt>Frequência</dt><dd>${esc(env.update_frequency)}</dd></div>
      <div><dt>Defasagem</dt><dd>${esc(env.latency_note)}</dd></div>
      ${s.license ? `<div><dt>Uso e crédito</dt><dd>${esc(s.license)}</dd></div>` : ''}
      ${s.url ? `<div><dt>Serviço consultado</dt><dd>${esc(s.url)}</dd></div>` : ''}
    </dl></details></footer>`;
}
export function unavailable(env, what) {
  const link = env?.source?.docs_url ? ` <a href="${esc(env.source.docs_url)}" target="_blank" rel="noopener">Consultar a fonte oficial</a>.` : '';
  return `<div class="unavailable"><strong>${esc(what)} indisponível no momento.</strong>
    ${esc(sentence(env?.error || 'A fonte não respondeu.'))} Nenhum valor substituto é exibido.${link}</div>`;
}
/** Preenche um painel com o envelope: renderiza os dados ou o estado de indisponibilidade. */
export function fill(panel, env, what, render) {
  if (!panel || !document.body.contains(panel)) return;
  const body = $('.panel-body', panel);
  if (!env || env.data == null) body.innerHTML = unavailable(env, what);
  else render(body, env.data, env);
  $('.panel-plate', panel).innerHTML = plate(env);
}

// ------------------------------------------------------------------ gráficos
export const AX = {
  axisLine: { lineStyle: { color: '#1C2E5A' } },
  axisLabel: { color: '#93A5CB' },
  splitLine: { lineStyle: { color: 'rgba(28,46,90,.6)' } },
  nameTextStyle: { color: '#93A5CB' },
};
export const timeAxis = () => ({ type: 'time', ...AX, axisLabel: { ...AX.axisLabel, formatter: (v) => fmtShort(v), hideOverlap: true } });
export const valAxis = (name, extra = {}) => ({ type: 'value', name, ...AX, ...extra });
export function tooltipTime(params, digits = 2, fmt = null) {
  const list = Array.isArray(params) ? params : [params];
  if (!list.length) return '';
  return `${fmtDT(new Date(list[0].value[0]).toISOString())}<br>` +
    list.map((p) => `${p.marker}${esc(p.seriesName)}: <b>${fmt ? fmt(p.value[1]) : fmtNum(p.value[1], digits)}</b>`).join('<br>');
}
const BASE = {
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'IBM Plex Sans, sans-serif', color: '#EAF1FF' },
  grid: { left: 56, right: 56, top: 40, bottom: 36 },
  legend: { textStyle: { color: '#93A5CB' }, top: 0 },
  tooltip: { trigger: 'axis', backgroundColor: '#0B1834', borderColor: '#1C2E5A', textStyle: { color: '#EAF1FF' } },
};
// ECharts vem do cdnjs (index.html). Se não carregar, tenta jsDelivr e unpkg antes de desistir.
const ECHARTS_FALLBACKS = [
  'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
  'https://unpkg.com/echarts@5.5.1/dist/echarts.min.js',
];
let echartsLoading = null;
function ensureEcharts() {
  if (window.echarts) return Promise.resolve(true);
  if (!echartsLoading) {
    echartsLoading = new Promise((resolve) => {
      const next = (i) => {
        if (window.echarts) return resolve(true);
        if (i >= ECHARTS_FALLBACKS.length) return resolve(false);
        const s = document.createElement('script');
        s.src = ECHARTS_FALLBACKS[i];
        s.onload = () => (window.echarts ? resolve(true) : next(i + 1));
        s.onerror = () => next(i + 1);
        document.head.appendChild(s);
      };
      next(0);
    });
  }
  return echartsLoading;
}
export function chart(el, option) {
  if (!window.echarts) {
    el.innerHTML = '<p class="reading-note">Carregando gráfico…</p>';
    ensureEcharts().then((ok) => {
      if (!el.isConnected) return;
      if (ok) { el.innerHTML = ''; chart(el, option); return; }
      el.outerHTML = '<p class="reading-note">A biblioteca de gráficos não carregou (cdnjs, jsDelivr e unpkg indisponíveis neste navegador). Os valores acima continuam corretos.</p>';
    });
    return null;
  }
  const c = window.echarts.init(el);
  c.setOption({ ...BASE, ...option, tooltip: { ...BASE.tooltip, ...(option.tooltip || {}) } });
  state.charts.push(c);
  const panel = el.closest('.panel');
  if (panel) panel._charts = [...(panel._charts || []), c];
  return c;
}
export function disposePanelCharts(panel) {
  (panel._charts || []).forEach((c) => { c.dispose(); state.charts = state.charts.filter((x) => x !== c); });
  panel._charts = [];
}
export function disposeAllCharts() { state.charts.forEach((c) => c.dispose()); state.charts = []; }

// ------------------------------------------------------------------ favoritos
const favKey = (kind, ref) => `${kind}:${ref}`;
export async function loadFavorites() {
  const r = await api('/api/favorites');
  state.favs = new Map((r.items || []).map((f) => [favKey(f.kind, f.ref), f]));
  return r;
}
export function favButton(kind, ref, title, data = {}) {
  const on = state.favs.has(favKey(kind, ref));
  return `<button class="fav-btn" type="button" aria-pressed="${on}" data-fav-kind="${esc(kind)}" data-fav-ref="${esc(ref)}"
    data-fav-title="${esc(title)}" data-fav-data="${esc(JSON.stringify(data))}">${on ? '★ Nos favoritos' : '☆ Salvar nos favoritos'}</button>`;
}
export async function toggleFavorite(btn) {
  const { favKind: kind, favRef: ref, favTitle: title } = btn.dataset;
  const on = state.favs.has(favKey(kind, ref));
  btn.disabled = true;
  const r = on
    ? await api(`/api/favorites/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}`, { method: 'DELETE' })
    : await api('/api/favorites', { method: 'POST', body: { kind, ref, title, data: JSON.parse(btn.dataset.favData || '{}') } });
  btn.disabled = false;
  if (r.http >= 400 || r.http === 0) { btn.textContent = 'Não foi possível salvar — tente de novo'; return; }
  await loadFavorites();
  $$(`.fav-btn[data-fav-kind="${CSS.escape(kind)}"][data-fav-ref="${CSS.escape(ref)}"]`).forEach((b) => {
    const now = state.favs.has(favKey(kind, ref));
    b.setAttribute('aria-pressed', String(now));
    b.textContent = now ? '★ Nos favoritos' : '☆ Salvar nos favoritos';
  });
}

export function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.charset = 'utf-8';
    s.onload = res; s.onerror = () => rej(new Error(`falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}
