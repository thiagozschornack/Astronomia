// Telas da plataforma. Os módulos montam painéis do registro (widgets.js);
// imagens, mapa celeste e telescópios têm interação própria.
import {
  $, $$, api, dms, esc, favButton, fill, fmtDT, fmtUTC, fmtInt, head, hms, loadScript, local, panelShell, plate,
  state, unavailable, workspace,
} from './core.js?v=0.3.0';
import { W, apodHTML, mount } from './widgets.js?v=0.3.0';
import { addMarkers, mountSkyBodies, resetMarkers } from './explore.js?v=0.3.0';

const grid = (root) => { root.insertAdjacentHTML('beforeend', '<div class="grid"></div>'); return root.lastElementChild; };
const mountAll = (g, ids) => ids.forEach((id) => mount(g, id));

// ------------------------------------------------------------------ módulos
export function viewOverview(root) {
  const demo = state.config?.nasa_demo_key
    ? '<p class="notice">A chave da NASA em uso é a de demonstração (DEMO_KEY), com limite baixo de consultas. Defina NASA_API_KEY no arquivo .env do servidor.</p>' : '';
  root.innerHTML = head('Painel geral', 'Leituras mais recentes das fontes conectadas. Os painéis se atualizam sozinhos quando o servidor sincroniza uma fonte.') + demo;
  mountAll(grid(root), ['kp-now', 'flare-now', 'dst-now', 'wind-now', 'bz-now', 'sun-now', 'neo-next', 'exo-count', 'alerts-short', 'apod']);
}
export function viewSpaceWeather(root) {
  root.innerHTML = head('Sol e clima espacial', 'Imagens solares recentes, raios X do GOES, vento solar em L1, índices Kp e Dst, fluxo F10.7, manchas solares e alertas da NOAA.');
  mountAll(grid(root), ['solar-images', 'kp-chart', 'xray-chart', 'flare-now', 'plasma-chart', 'dst-now', 'mag-chart', 'f107', 'sunspots', 'alerts-full']);
}
export function viewNeo(root) {
  const opt = (vals, cur, unit) => vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v} ${unit}</option>`).join('');
  root.innerHTML = head('Objetos próximos à Terra', 'Aproximações previstas pelo JPL, cruzadas com a lista de monitoramento de risco Sentry.') +
    `<form class="controls" id="neo-form">
      <label class="field">Período<select name="days">${opt([7, 14, 30, 60], state.neo.days, 'dias')}</select></label>
      <label class="field">Distância máxima<select name="dist_ld">${opt([1, 5, 10, 20, 50], state.neo.dist_ld, 'distâncias lunares')}</select></label>
      <button class="btn" type="submit">Atualizar consulta</button></form>`;
  const g = grid(root);
  mountAll(g, ['neo-chart', 'neo-table']);
  $('#neo-form').addEventListener('submit', (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    state.neo = { days: Number(f.get('days')), dist_ld: Number(f.get('dist_ld')) };
    viewNeo(root);
  });
}
export function viewExo(root) {
  root.innerHTML = head('Exoplanetas', 'Catálogo de planetas confirmados do NASA Exoplanet Archive (tabela PSCompPars) e candidatos do TESS, sempre separados.');
  mountAll(grid(root), ['exo-summary', 'exo-methods', 'exo-scatter']);
}
export function viewOps(root) {
  root.innerHTML = head('Operação da plataforma', 'Saúde das integrações, histórico de sincronizações, latência e falhas.',
    '<button class="btn" type="button" id="probe">Testar todas as fontes agora</button>');
  if (state.config?.nasa_demo_key) root.insertAdjacentHTML('beforeend', '<p class="notice">NASA_API_KEY não configurada: usando DEMO_KEY (limite baixo). Gere uma chave gratuita em api.nasa.gov.</p>');
  mountAll(grid(root), ['ops-sources', 'ops-history', 'ops-legend']);
  $('#probe').addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Testando…';
    const probes = ['/api/space-weather/kp', '/api/space-weather/solar-wind/plasma', '/api/space-weather/solar-wind/mag', '/api/space-weather/xray',
      '/api/space-weather/dst', '/api/space-weather/f107', '/api/space-weather/sunspots', '/api/space-weather/alerts', '/api/solar/imagery',
      '/api/neo/close-approaches', '/api/exoplanets/summary', '/api/images/apod', '/api/images/search?q=nebula', '/api/sky/resolve?name=M42'];
    await Promise.all(probes.map((p) => api(p)));
    viewOps(root);
  });
}

// ------------------------------------------------------------------ imagens
export function viewImages(root) {
  const quick = ['James Webb', 'Hubble', 'Chandra', 'Solar Dynamics Observatory', 'Carina Nebula', 'Pillars of Creation', 'Andromeda'];
  const today = new Date().toISOString().slice(0, 10);
  root.innerHTML = head('Imagens espaciais', 'Imagem astronômica do dia e busca no acervo de imagens da NASA, com créditos e metadados.') +
    `<div class="grid">
      <section class="panel span-all" id="im-apod"><header class="panel-head"><h2>Imagem astronômica do dia (APOD)</h2>
        <form id="apod-form" class="controls" style="margin:0"><label class="field">Data<input type="date" name="date" min="1995-06-16" max="${today}" value="${today}"></label>
        <button class="btn secondary" type="submit">Abrir data</button></form></header>
        <div class="panel-body"><p class="loading">Consultando a fonte</p></div><div class="panel-plate"></div></section>
      <section class="panel span-all" id="im-search"><header class="panel-head"><h2>NASA Image and Video Library</h2></header>
        <div class="panel-body">
          <form id="search-form" class="controls">
            <label class="field" style="flex:1;min-width:220px">Objeto, missão ou telescópio<input name="q" required minlength="2" maxlength="100" placeholder="Ex.: Carina Nebula, Webb, Saturn"></label>
            <label class="field">Ano inicial<input name="year_start" type="number" min="1920" max="2100" style="width:110px"></label>
            <label class="field">Ano final<input name="year_end" type="number" min="1920" max="2100" style="width:110px"></label>
            <button class="btn" type="submit">Buscar imagens</button></form>
          <div class="chips">${quick.map((q) => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
          <div id="results" style="margin-top:14px"><p class="reading-note">Os termos de busca funcionam melhor em inglês, idioma dos metadados da NASA.</p></div>
        </div><div class="panel-plate"></div></section></div>`;

  const loadApod = async (date) => {
    const env = await api(`/api/images/apod${date && date !== today ? `?date=${date}` : ''}`);
    fill($('#im-apod'), env, 'Imagem do dia', (b, d) => { b.innerHTML = apodHTML(d); });
  };
  $('#apod-form').addEventListener('submit', (e) => { e.preventDefault(); loadApod(new FormData(e.target).get('date')); });
  loadApod(today);

  let last = null;
  const search = async (q, page = 1, ys = '', ye = '') => {
    last = { q, ys, ye };
    $('#results').innerHTML = '<p class="loading">Buscando no acervo da NASA</p>';
    const qs = new URLSearchParams({ q, page }); if (ys) qs.set('year_start', ys); if (ye) qs.set('year_end', ye);
    const env = await api(`/api/images/search?${qs}`);
    $('#im-search .panel-plate').innerHTML = plate(env);
    if (!env.data) { $('#results').innerHTML = unavailable(env, 'Busca de imagens'); return; }
    const { items, total_hits: total } = env.data;
    if (!items.length) { $('#results').innerHTML = `<p class="reading-note">Nenhuma imagem para "${esc(q)}". Tente termos em inglês ou o nome do telescópio.</p>`; return; }
    $('#results').innerHTML = `<div class="gallery">${items.map((it, i) => `<button class="thumb" type="button" data-i="${i}">
        ${it.preview ? `<img src="${esc(it.preview)}" alt="${esc(it.title)}" loading="lazy">` : ''}
        <span>${esc(it.title)}<small>${it.date_created ? fmtDT(it.date_created).split(' ')[0] : ''} — ${esc(it.center || 'NASA')}</small></span></button>`).join('')}</div>
      <div class="pager">${page > 1 ? '<button class="btn secondary" type="button" data-page="-1">Página anterior</button>' : ''}
        <span>Página ${page} de resultados (${fmtInt(total)} no total)</span>
        ${page * 100 < total && items.length >= 100 ? '<button class="btn secondary" type="button" data-page="1">Próxima página</button>' : ''}</div>`;
    $$('#results .thumb').forEach((btn) => btn.addEventListener('click', () => showImage(items[Number(btn.dataset.i)])));
    $$('#results [data-page]').forEach((btn) => btn.addEventListener('click', () => search(last.q, page + Number(btn.dataset.page), last.ys, last.ye)));
  };
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    search(String(f.get('q')).trim(), 1, f.get('year_start'), f.get('year_end'));
  });
  $$('[data-q]', root).forEach((c) => c.addEventListener('click', () => { $('#search-form [name=q]').value = c.dataset.q; search(c.dataset.q); }));
  if (state.pendingSearch) { const q = state.pendingSearch; state.pendingSearch = null; $('#search-form [name=q]').value = q; search(q); }
}

function showImage(it) {
  const medium = it.preview ? it.preview.replace('~thumb', '~medium') : null;
  $('#detail-body').innerHTML = `<h2 id="detail-title" style="font-size:24px;padding-right:30px">${esc(it.title)}</h2>
    ${medium ? `<img src="${esc(medium)}" alt="${esc(it.title)}" data-fallback="${esc(it.preview)}">` : ''}
    <dl class="kv"><dt>Identificador NASA</dt><dd>${esc(it.nasa_id)}</dd><dt>Data</dt><dd>${it.date_created ? fmtUTC(it.date_created) : '—'}</dd>
      <dt>Centro</dt><dd>${esc(it.center || '—')}</dd><dt>Crédito</dt><dd>${esc(it.creator || 'NASA — ver página original')}</dd>
      <dt>Palavras-chave</dt><dd>${esc((it.keywords || []).join(', ') || '—')}</dd></dl>
    <p class="prose">${esc(it.description || '')}</p>
    <p class="row-actions"><a href="${esc(it.page_url)}" target="_blank" rel="noopener">Abrir na NASA Image Library — arquivos originais e créditos</a>
      ${favButton('nasa_image', it.nasa_id, it.title, { preview: it.preview, page_url: it.page_url, center: it.center })}</p>
    <p class="notice">Imagem de arquivo. Antes de reutilizar, confira o crédito e as diretrizes de uso de mídia da NASA.</p>`;
  const img = $('#detail-body img[data-fallback]');
  if (img) img.addEventListener('error', () => { img.src = img.dataset.fallback; }, { once: true });
  $('#detail').showModal();
}

// ------------------------------------------------------------------ mapa celeste
export function viewSky(root, params) {
  const site = state.config?.site || { name: 'Joinville/SC', lat: -26.3045, lon: -48.8487, tz: 'America/Sao_Paulo' };
  const quick = ['M42', 'Sirius', 'Eta Car', 'omega Cen', 'LMC', '47 Tuc', 'M104', 'Antares'];
  const start = params.get('obj') || 'M42';
  root.innerHTML = head('Mapa celeste', `Atlas do céu em levantamentos HiPS (Aladin Lite, CDS) e cálculo de visibilidade para ${site.name} ou qualquer local.`) +
    `<div class="sky-layout">
      <section class="panel" id="sky-map"><header class="panel-head"><h2>Atlas do céu</h2>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px">Levantamento
          <select id="survey"><option value="P/DSS2/color">DSS2 (óptico)</option><option value="P/2MASS/color">2MASS (infravermelho próximo)</option>
          <option value="P/allWISE/color">AllWISE (infravermelho médio)</option><option value="P/Mellinger/color">Mellinger (céu inteiro, óptico)</option></select></label></header>
        <div class="panel-body"><div id="aladin" role="application" aria-label="Atlas celeste interativo"><p class="loading" style="padding:16px">Carregando o atlas</p></div></div>
        <div class="panel-plate">${plate({ source: { institution: 'CDS Strasbourg — Aladin Lite e HiPS', docs_url: 'https://aladin.cds.unistra.fr/AladinLite/', license: 'Citar Aladin (Bonnarel et al. 2000) e o levantamento exibido' }, content_type: 'archive', content_label: 'Arquivo', update_frequency: 'Levantamentos de céu completos, já publicados', latency_note: 'Imagens de arquivo; não é visão ao vivo do céu' })}</div></section>
      <div class="sky-side">
        <section class="panel"><header class="panel-head"><h2>Objeto e local</h2></header><div class="panel-body">
          <form id="sky-form" class="controls" style="flex-direction:column;align-items:stretch">
            <label class="field">Nome do objeto (SIMBAD)<input name="name" value="${esc(start)}" required maxlength="80"></label>
            <div class="controls" style="margin:0">
              <label class="field">Latitude<input name="lat" type="number" step="0.0001" min="-90" max="90" value="${site.lat}" style="width:120px"></label>
              <label class="field">Longitude<input name="lon" type="number" step="0.0001" min="-180" max="180" value="${site.lon}" style="width:120px"></label></div>
            <div class="controls" style="margin:0">
              <label class="field">Fuso horário<input name="tz" value="${esc(site.tz)}" style="width:190px"></label>
              <label class="field">Data<input name="date" type="date"></label></div>
            <div class="controls" style="margin:0"><button class="btn" type="submit">Localizar e calcular</button>
              <button class="btn secondary" type="button" id="geo">Usar minha localização</button></div>
          </form>
          <div class="chips">${quick.map((q) => `<button class="chip" type="button" data-obj="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        </div></section>
        ${panelShell('sky-obj', 'Identificação')}
        ${panelShell('sky-vis', 'Visibilidade')}
        ${panelShell('sky-ss', 'Sol, Lua e planetas agora')}
      </div></div>`;

  let aladin = null; let ssData = null;
  resetMarkers();
  const formSite = () => { const fd = new FormData($('#sky-form')); return { lat: Number(fd.get('lat')), lon: Number(fd.get('lon')), tz: String(fd.get('tz')).trim() }; };
  const loadSS = async () => { const env = await mountSkyBodies($('#sky-ss'), formSite, () => aladin); ssData = env.data; };
  loadScript('https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js').then(() => window.A.init).then(() => {
    $('#aladin').innerHTML = '';
    aladin = window.A.aladin('#aladin', { survey: 'P/DSS2/color', fov: 1.5, target: start, cooFrame: 'ICRS', showReticle: true, showFullscreenControl: true, showLayersControl: true });
    if (ssData) addMarkers(aladin, ssData);
  }).catch(() => {
    $('#aladin').innerHTML = '<div class="unavailable" style="margin:16px"><strong>Atlas indisponível.</strong> Não foi possível carregar o Aladin Lite (aladin.cds.unistra.fr). O cálculo de visibilidade continua funcionando.</div>';
  });
  $('#survey').addEventListener('change', (e) => { if (aladin) (aladin.setImageSurvey || aladin.setBaseImageLayer).call(aladin, e.target.value); });
  $('#geo').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const f = $('#sky-form');
      f.lat.value = pos.coords.latitude.toFixed(4); f.lon.value = pos.coords.longitude.toFixed(4);
      f.tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }, () => { $('#geo').textContent = 'Localização não autorizada'; });
  });

  const run = async () => {
    const f = new FormData($('#sky-form'));
    const name = String(f.get('name')).trim();
    const objP = $('#sky-obj'); const visP = $('#sky-vis');
    [objP, visP].forEach((p) => { $('.panel-body', p).innerHTML = '<p class="loading">Consultando</p>'; $('.panel-plate', p).innerHTML = ''; });
    const obj = await api(`/api/sky/resolve?name=${encodeURIComponent(name)}`);
    if (obj.status === 'not_found') {
      $('.panel-body', objP).innerHTML = `<div class="unavailable"><strong>Objeto não encontrado.</strong>${esc(obj.error)} Tente a designação de catálogo (ex.: M42, NGC 3372).</div>`;
      $('.panel-body', visP).innerHTML = '';
      return;
    }
    fill(objP, obj, 'Resolução de nomes', (b, d) => {
      b.innerHTML = `<dl class="kv"><dt>Designação</dt><dd>${esc(d.name || name)}</dd><dt>Tipo (SIMBAD)</dt><dd>${esc(d.otype || '—')}</dd>
        <dt>Ascensão reta</dt><dd>${hms(d.ra_deg)}</dd><dt>Declinação</dt><dd>${dms(d.dec_deg)}</dd><dt>Sistema</dt><dd>ICRS, J2000</dd></dl>
        <p class="row-actions"><a href="https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${d.ra_deg}%20${d.dec_deg}&Radius=2&Radius.unit=arcmin" target="_blank" rel="noopener">Abrir no SIMBAD</a>
        ${favButton('sky_object', name, d.name ? `${d.name.replace(/\s+/g, ' ')} (${name})` : name, { ra: d.ra_deg, dec: d.dec_deg, otype: d.otype })}</p>`;
    });
    if (!obj.data) return;
    if (aladin) aladin.gotoRaDec(obj.data.ra_deg, obj.data.dec_deg);
    const qs = new URLSearchParams({ ra: obj.data.ra_deg, dec: obj.data.dec_deg, lat: f.get('lat'), lon: f.get('lon'), tz: f.get('tz') });
    if (f.get('date')) qs.set('date', f.get('date'));
    const vis = await api(`/api/sky/visibility?${qs}`);
    if (vis.status === 'invalid') { $('.panel-body', visP).innerHTML = `<div class="unavailable"><strong>Verifique os dados do local.</strong>${esc(vis.error)}</div>`; return; }
    fill(visP, vis, 'Cálculo', (b, v) => {
      const t = (s) => (s ? s.slice(11, 16) : '—');
      const status = { circumpolar: 'Circumpolar: não se põe neste local', nunca_nasce: 'Nunca nasce neste local', nasce_e_se_poe: '' }[v.visibility];
      b.innerHTML = `<dl class="kv">
        <dt>Agora</dt><dd>${v.above_horizon ? 'Acima do horizonte' : 'Abaixo do horizonte'} — altitude ${v.altitude_deg.toLocaleString('pt-BR')}°, azimute ${v.azimuth_deg.toLocaleString('pt-BR')}°</dd>
        <dt>Céu</dt><dd>${esc(v.sky_condition)} (Sol a ${v.sun_altitude_deg.toLocaleString('pt-BR')}°)</dd>
        <dt>Data local</dt><dd>${esc(v.date_local.split('-').reverse().join('/'))} (${esc(v.timezone)})</dd>
        ${status ? `<dt>Situação</dt><dd>${status}</dd>` : `<dt>Nascer</dt><dd>${t(v.rise_local)}</dd>`}
        <dt>Culminação</dt><dd>${t(v.transit_local)} — altitude máx. ${v.max_altitude_deg.toLocaleString('pt-BR')}°</dd>
        ${status ? '' : `<dt>Ocaso</dt><dd>${t(v.set_local)}</dd>`}</dl>
        <ul class="note-list">${v.simplifications.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
    });
  };
  $('#sky-form').addEventListener('submit', (e) => { e.preventDefault(); run(); loadSS(); });
  loadSS();
  $$('[data-obj]', root).forEach((c) => c.addEventListener('click', () => { $('#sky-form').name.value = c.dataset.obj; run(); }));
  run();
}

// ------------------------------------------------------------------ telescópios
export async function viewTelescopes(root) {
  root.innerHTML = head('Telescópios e observatórios', 'Instrumentos espaciais e terrestres, com o estado de cada integração nesta plataforma.') +
    '<p class="notice">A plataforma consome apenas dados públicos. Nenhuma tela comanda ou aponta telescópios reais.</p>' +
    `<div class="grid">${panelShell('tel-list', 'Catálogo', 'span-all')}${panelShell('tel-detail', 'Detalhes', 'span-all')}</div>`;
  const env = await api('/api/telescopes');
  const statusLabel = { operacional: 'Integrado', prevista: 'Integração prevista', link: 'Somente link oficial' };
  const showDetail = (t) => {
    const b = $('#tel-detail .panel-body');
    b.innerHTML = `<h3 style="font-size:24px;margin-bottom:10px">${esc(t.name)}</h3>
      <dl class="kv"><dt>Instituição</dt><dd>${esc(t.institution)}</dd><dt>${t.kind === 'espacial' ? 'Órbita' : 'Localização'}</dt><dd>${esc(t.location)}</dd>
        ${t.launched ? `<dt>Lançamento</dt><dd>${esc(t.launched.split('-').reverse().join('/'))}</dd>` : ''}
        <dt>Instrumentação</dt><dd>${esc(t.aperture)}</dd><dt>Faixa observada</dt><dd>${esc(t.wavelengths)}</dd><dt>Objetivos</dt><dd>${esc(t.goals)}</dd>
        <dt>Portal oficial</dt><dd><a href="${esc(t.portal)}" target="_blank" rel="noopener">${esc(t.portal)}</a></dd>
        <dt>Arquivo científico</dt><dd><a href="${esc(t.archive)}" target="_blank" rel="noopener">${esc(t.archive)}</a></dd></dl>
      <h3 style="font-size:17px;margin:16px 0 6px">Integrações</h3>
      ${t.integrations.map((i) => `<div class="integration"><span class="badge st-${esc(i.status)}">${esc(statusLabel[i.status] || i.status)}</span>${esc(i.name)}</div>`).join('')}
      <p class="row-actions" style="margin-top:14px">${t.image_query ? '<button class="btn" type="button" id="tel-images">Ver imagens na NASA Image Library</button>' : ''}
      ${favButton('telescope', t.id, t.name, { portal: t.portal })}</p>`;
    $('#tel-detail .panel-plate').innerHTML = plate(env);
    const btn = $('#tel-images');
    if (btn) btn.addEventListener('click', () => { state.pendingSearch = t.image_query; location.hash = 'images'; });
  };
  fill($('#tel-list'), env, 'Catálogo', (b, list) => {
    const group = (kind, title) => `<h3 class="sub">${title}</h3><div class="scope-list">
      ${list.filter((t) => t.kind === kind).map((t) => `<button class="scope" type="button" data-id="${esc(t.id)}" aria-pressed="false"><strong>${esc(t.name)}</strong><small>${esc(t.institution)}</small></button>`).join('')}</div>`;
    b.innerHTML = group('espacial', 'Espaciais') + group('terrestre', 'Terrestres');
    $$('.scope', b).forEach((btn) => btn.addEventListener('click', () => {
      $$('.scope', b).forEach((x) => x.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      showDetail(list.find((t) => t.id === btn.dataset.id));
      $('#tel-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    showDetail(list[0]);
    $('.scope', b).setAttribute('aria-pressed', 'true');
  });
  $('#tel-list .panel-plate').innerHTML = '';
}

// ------------------------------------------------------------------ Mission Control
const LAYOUT_KEY = 'thz-mission-layout';
export const PRESET = {
  screens: [
    { name: 'Observação', widgets: ['apod', 'sun-now', 'sky-atlas', 'solar-images'] },
    { name: 'Monitoramento', widgets: ['kp-now', 'flare-now', 'dst-now', 'wind-now', 'bz-now', 'alerts-short', 'xray-chart', 'neo-next', 'plasma-chart', 'neo-table'] },
    { name: 'Pesquisa', widgets: ['exo-summary', 'exo-methods', 'exo-scatter', 'favorites'] },
    { name: 'Exploração', widgets: ['solar-mini', 'events-next', 'sky-bodies', 'neo-chart', 'exo-count'] },
  ],
};
const validLayout = (l) => l && Array.isArray(l.screens) && l.screens.length >= 1 && l.screens.length <= 6 &&
  l.screens.every((s) => typeof s.name === 'string' && Array.isArray(s.widgets));
export const getLayout = () => { const l = local.get(LAYOUT_KEY); return validLayout(l) ? l : structuredClone(PRESET); };
const setLayout = (l) => local.set(LAYOUT_KEY, l);

export function viewMission(root, params) {
  const layout = getLayout();
  const idx = Math.min(layout.screens.length, Math.max(1, Number(params.get('tela')) || 1)) - 1;
  const kiosk = params.get('janela') === '1';
  const editing = params.get('editar') === '1';
  document.body.classList.toggle('kiosk', kiosk);
  const screen = layout.screens[idx];
  const go = (q) => { location.hash = `mission?${new URLSearchParams({ tela: idx + 1, ...(kiosk ? { janela: 1 } : {}), ...q })}`; };

  const groups = {};
  Object.entries(W).forEach(([id, d]) => { (groups[d.group] = groups[d.group] || []).push([id, d.title]); });
  root.innerHTML = `<div class="mission-head">
      <div class="mission-tabs" role="tablist" aria-label="Telas do Mission Control">
        ${layout.screens.map((s, i) => `<button role="tab" type="button" aria-selected="${i === idx}" data-tela="${i + 1}">Tela ${i + 1} — ${esc(s.name)}</button>`).join('')}
      </div>
      <div class="mission-actions">
        <button class="btn secondary" type="button" id="m-edit">${editing ? 'Concluir edição' : 'Editar painéis'}</button>
        ${kiosk || window.THZNative?.isNative ? '' : `<button class="btn secondary" type="button" id="m-window">Abrir esta tela em nova janela</button>
        <button class="btn secondary" type="button" id="m-all">Abrir todas as telas</button>`}
      </div></div>
    ${editing ? `<div class="mission-edit">
      <label class="field">Nome da tela<input id="m-name" value="${esc(screen.name)}" maxlength="40"></label>
      <label class="field">Adicionar painel<select id="m-add"><option value="">Escolha um painel</option>
        ${Object.entries(groups).map(([g, items]) => `<optgroup label="${esc(g)}">${items.map(([id, t]) => `<option value="${id}">${esc(t)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
      <div class="controls" style="margin:0">
        <button class="btn" type="button" id="m-save">Salvar layout com nome</button>
        <select id="m-saved" aria-label="Layouts salvos"><option value="">Layouts salvos</option></select>
        <button class="btn secondary" type="button" id="m-load">Carregar</button>
        <button class="btn secondary" type="button" id="m-del">Excluir</button>
        <button class="btn secondary" type="button" id="m-reset">Restaurar padrão</button></div>
      <p class="reading-note" id="m-msg" role="status">As mudanças valem para todas as janelas abertas deste navegador.</p></div>` : ''}
    ${idx === 3 && !screen.widgets.includes('solar-mini') ? '<p class="notice">Novos painéis da Etapa 3: "Sistema Solar hoje", "Próximos eventos astronômicos" e "Sol, Lua e planetas agora". Use "Editar painéis" para adicioná-los, ou "Restaurar padrão".</p>' : ''}`;
  const g = grid(root);
  g.classList.add('mission-grid');
  if (!screen.widgets.length) g.innerHTML = '<p class="reading-note">Tela vazia. Use "Editar painéis" para adicionar painéis.</p>';
  screen.widgets.forEach((wid, pos) => {
    const p = mount(g, wid);
    if (!p || !editing) return;
    $('.panel-tools', p).insertAdjacentHTML('afterbegin', `
      <button class="icon-btn" type="button" data-move="-1" data-pos="${pos}" aria-label="Mover ${esc(W[wid].title)} para antes" title="Mover para antes">↑</button>
      <button class="icon-btn" type="button" data-move="1" data-pos="${pos}" aria-label="Mover ${esc(W[wid].title)} para depois" title="Mover para depois">↓</button>
      <button class="icon-btn" type="button" data-remove="${pos}" aria-label="Remover ${esc(W[wid].title)}" title="Remover">✕</button>`);
  });

  $$('[data-tela]', root).forEach((b) => b.addEventListener('click', () => {
    location.hash = `mission?${new URLSearchParams({ tela: b.dataset.tela, ...(kiosk ? { janela: 1 } : {}), ...(editing ? { editar: 1 } : {}) })}`;
  }));
  $('#m-edit').addEventListener('click', () => go(editing ? {} : { editar: 1 }));
  const openWin = (n) => window.open(`${location.pathname}#mission?tela=${n}&janela=1`, `thz-tela-${n}`, 'popup,width=1600,height=950');
  $('#m-window')?.addEventListener('click', () => openWin(idx + 1));
  $('#m-all')?.addEventListener('click', () => {
    const blocked = layout.screens.map((_, i) => openWin(i + 1)).filter((w) => !w).length;
    if (blocked) alert(`O navegador bloqueou ${blocked} janela(s). Permita pop-ups para este site e tente de novo.`);
  });
  if (!editing) return;

  const commit = () => { setLayout(layout); window.dispatchEvent(new HashChangeEvent('hashchange')); };
  $$('[data-move]', root).forEach((b) => b.addEventListener('click', () => {
    const pos = Number(b.dataset.pos); const to = pos + Number(b.dataset.move);
    if (to < 0 || to >= screen.widgets.length) return;
    [screen.widgets[pos], screen.widgets[to]] = [screen.widgets[to], screen.widgets[pos]];
    commit();
  }));
  $$('[data-remove]', root).forEach((b) => b.addEventListener('click', () => { screen.widgets.splice(Number(b.dataset.remove), 1); commit(); }));
  $('#m-add').addEventListener('change', (e) => { if (e.target.value) { screen.widgets.push(e.target.value); commit(); } });
  $('#m-name').addEventListener('change', (e) => { screen.name = e.target.value.trim() || `Tela ${idx + 1}`; commit(); });
  $('#m-reset').addEventListener('click', () => { if (confirm('Restaurar as quatro telas padrão? O layout atual não salvo será perdido.')) { setLayout(structuredClone(PRESET)); commit(); } });

  const msg = (t) => { $('#m-msg').textContent = t; };
  const refreshSaved = async () => {
    const r = await api('/api/layouts');
    $('#m-saved').innerHTML = '<option value="">Layouts salvos</option>' + (r.items || []).map((l) => `<option value="${esc(l.name)}">${esc(l.name)} (${fmtDT(l.updated_at)})</option>`).join('');
    return r.items || [];
  };
  let saved = [];
  refreshSaved().then((x) => { saved = x; });
  $('#m-save').addEventListener('click', async () => {
    const name = prompt('Nome do layout (até 60 caracteres):', 'Minha sala de controle');
    if (!name) return;
    const r = await api(`/api/layouts/${encodeURIComponent(name.trim())}`, { method: 'PUT', body: { data: layout } });
    msg(r.saved ? `Layout "${name}" salvo no servidor.` : `Não foi possível salvar: ${r.error || 'erro desconhecido'}.`);
    saved = await refreshSaved();
  });
  $('#m-load').addEventListener('click', () => {
    const l = saved.find((x) => x.name === $('#m-saved').value);
    if (!l) { msg('Escolha um layout salvo.'); return; }
    if (!validLayout(l.data)) { msg('Esse layout está em formato inválido.'); return; }
    setLayout(l.data); location.hash = 'mission?tela=1&editar=1';
  });
  $('#m-del').addEventListener('click', async () => {
    const name = $('#m-saved').value;
    if (!name || !confirm(`Excluir o layout "${name}"?`)) return;
    const r = await api(`/api/layouts/${encodeURIComponent(name)}`, { method: 'DELETE' });
    msg(r.removed ? `Layout "${name}" excluído.` : `Não foi possível excluir: ${r.error || 'erro desconhecido'}.`);
    saved = await refreshSaved();
  });
}

// ------------------------------------------------------------------ favoritos e privacidade
export function viewFavorites(root) {
  const ws = workspace();
  root.innerHTML = head('Favoritos', 'Imagens, objetos celestes, asteroides e telescópios que você salvou.');
  const g = grid(root);
  mount(g, 'favorites');
  g.insertAdjacentHTML('beforeend', `<section class="panel span-all" id="ws-panel"><header class="panel-head"><h2>Seu espaço de trabalho</h2></header>
    <div class="panel-body">
      <p class="prose">Favoritos e layouts ficam ligados a um código aleatório gerado neste aparelho, sem cadastro. Para usar os mesmos dados
      em outro dispositivo, copie o código e cole lá. Guarde-o como uma senha: quem tiver o código vê e altera seus favoritos.</p>
      <div class="controls"><label class="field" style="flex:1;min-width:min(260px,100%)">Código deste aparelho
        <input id="ws-code" type="password" value="${esc(ws)}" readonly></label>
        <button class="btn secondary" type="button" id="ws-show">Mostrar</button>
        <button class="btn secondary" type="button" id="ws-copy">Copiar</button></div>
      <form class="controls" id="ws-use"><label class="field" style="flex:1;min-width:min(260px,100%)">Usar o código de outro dispositivo
        <input name="code" pattern="[A-Za-z0-9_\\-]{16,64}" required autocomplete="off"></label>
        <button class="btn secondary" type="submit">Usar este código</button></form>
      <p class="row-actions"><button class="btn danger" type="button" id="ws-delete">Apagar todos os meus dados do servidor</button>
        <a href="#privacy">Política de privacidade</a></p>
      <p class="reading-note" id="ws-msg" role="status"></p></div></section>`);
  const msg = (t) => { $('#ws-msg').textContent = t; };
  $('#ws-show').addEventListener('click', (e) => { const i = $('#ws-code'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; e.target.textContent = show ? 'Ocultar' : 'Mostrar'; });
  $('#ws-copy').addEventListener('click', async () => { try { await (window.THZNative ? window.THZNative.copyText(ws) : navigator.clipboard.writeText(ws)); msg('Código copiado.'); } catch { msg('Não foi possível copiar; use Mostrar e copie manualmente.'); } });
  $('#ws-use').addEventListener('submit', (e) => {
    e.preventDefault();
    local.set('thz-workspace', e.target.code.value.trim());
    msg('Código trocado. Carregando os favoritos desse espaço de trabalho.');
    viewFavorites(root);
  });
  $('#ws-delete').addEventListener('click', async () => {
    if (!confirm('Apagar do servidor todos os favoritos e layouts deste código? Não há como desfazer.')) return;
    const r = await api('/api/workspace', { method: 'DELETE' });
    if (r.http !== 200) { msg(`Não foi possível apagar: ${r.error || 'erro desconhecido'}.`); return; }
    local.del('thz-mission-layout');
    viewFavorites(root);
    setTimeout(() => { $('#ws-msg').textContent = `${r.removed_records} registro(s) apagado(s) do servidor.`; }, 50);
  });
}

export function viewPrivacy(root) {
  root.innerHTML = head('Privacidade e proteção de dados', 'Como a plataforma trata dados pessoais, conforme a LGPD (Lei 13.709/2018).') +
    `<section class="panel"><div class="panel-body prose privacy">
      <h2>Quais dados guardamos</h2>
      <p>A plataforma não pede cadastro, nome ou e-mail. Para guardar favoritos e layouts, o navegador gera um código aleatório.
      O servidor armazena somente uma impressão criptográfica (SHA-256) desse código, junto com os itens que você salvou.</p>
      <p>Para limitar abusos, o servidor mantém o endereço IP de cada requisição na memória por até 1 minuto, sem gravá-lo em banco de dados.
      Os registros de acesso do servidor web (endereço IP, horário e página) são mantidos pelo prazo de rotação de logs da hospedagem,
      apenas para segurança e diagnóstico. O histórico de sincronizações com as fontes científicas não contém dados de pessoas.</p>
      <h2>Localização</h2>
      <p>O botão "Usar minha localização" só preenche os campos de latitude e longitude no aparelho, e o app só pede a permissão de localização
      quando você toca nele. A posição é enviada ao servidor apenas para o cálculo de visibilidade daquela consulta e não é armazenada.</p>
      <h2>Notificações</h2>
      <p>Os alertas e lembretes de eventos são agendados no próprio celular (notificações locais). Nenhum identificador de notificação é enviado
      ao servidor, e você pode desativá-los a qualquer momento na central de eventos ou nas configurações do Android.</p>
      <h2>Serviços de terceiros</h2>
      <p>O app traz a biblioteca de gráficos e as fontes tipográficas embutidas. Algumas partes são carregadas diretamente de serviços externos,
      que recebem o seu endereço IP: Aladin Lite e imagens do céu (CDS, Universidade de Estrasburgo) e imagens da NASA e da ESA.
      Links para portais oficiais abrem no navegador do aparelho.</p>
      <h2>Seus direitos</h2>
      <p>Você pode apagar a qualquer momento todos os dados ligados ao seu código, na tela Favoritos, em "Apagar todos os meus dados do servidor".
      Registros de auditoria e de operação são eliminados automaticamente após o prazo de retenção configurado (padrão de 30 dias).</p>
      <h2>Controlador e contato</h2>
      <p>EmpreenderTHZ. Para dúvidas ou solicitações sobre dados pessoais, use o canal de contato informado no site institucional.</p>
    </div></section>`;
}
