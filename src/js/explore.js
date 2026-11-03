// Etapa 3 — exploração: Sistema Solar 3D, central de eventos, alertas e Sol/Lua/planetas no céu.
// A visualização 3D é desenhada em canvas puro (sem bibliotecas externas), para funcionar em
// qualquer hospedagem e sem depender de CDN.
import { $, $$, api, apiUrl, esc, fill, fmtNum, head, local, panelShell, plate, state, unavailable } from './core.js?v=0.3.0';
import { W } from './widgets.js?v=0.3.0';

const D2R = Math.PI / 180;
const LIGHT_MIN_PER_AU = 8.316746;
const AU_MKM = 149.5978707;
const site = () => state.config?.site || { name: 'Joinville/SC', lat: -26.3045, lon: -48.8487, tz: 'America/Sao_Paulo' };
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtIn = (iso, zone, opts = { dateStyle: 'short', timeStyle: 'short' }) => {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: zone, ...opts }).format(new Date(iso)); } catch { return iso; }
};
const NATIVE = () => window.THZNative?.isNative === true;
const nf = (v, d = 2) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));

// ================================================================== órbitas (simulação)
function keplerXYZ(base, rate, jd) {
  const t = (jd - 2451545.0) / 36525;
  const [a, e, inc, L, varpi, node] = base.map((b, i) => b + rate[i] * t);
  let m = (((L - varpi + 180) % 360) + 360) % 360 - 180;
  m *= D2R;
  let E = m + e * Math.sin(m);
  for (let k = 0; k < 30; k++) { const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
  const xp = a * (Math.cos(E) - e); const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = (varpi - node) * D2R; const o = node * D2R; const i = inc * D2R;
  const cw = Math.cos(w); const sw = Math.sin(w); const co = Math.cos(o); const so = Math.sin(o); const ci = Math.cos(i); const si = Math.sin(i);
  return [(cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
    (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
    (sw * si) * xp + (cw * si) * yp];
}
const jdOf = (date) => date.getTime() / 86400000 + 2440587.5;

// ================================================================== cena 3D em canvas
export class SolarScene {
  constructor(canvas, opts = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.yaw = opts.yaw ?? -0.6; this.pitch = opts.pitch ?? 0.95; this.zoom = 1;
    this.scale = opts.scale || 'adapted'; this.labels = opts.labels ?? true;
    this.bodies = []; this.selected = null; this.onSelect = opts.onSelect || (() => {});
    this.interactive = opts.interactive ?? true;
    this.stars = Array.from({ length: 220 }, (_, k) => {
      const r = Math.sin(k * 12.9898) * 43758.5453; const f = r - Math.floor(r);
      const g = Math.sin(k * 78.233) * 12345.678; const h = g - Math.floor(g);
      return [f, h, 0.3 + ((k * 37) % 10) / 14];
    });
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
    if (this.interactive) this.bind();
    this.resize();
  }
  destroy() { this.ro.disconnect(); this.dead = true; }
  resize() {
    const r = this.canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.draw();
  }
  setBodies(bodies) { this.bodies = bodies; this.draw(); }
  radial(v) {
    const r = Math.hypot(v[0], v[1], v[2]); if (!r) return v;
    const k = this.scale === 'adapted' ? Math.log1p(r / 0.25) / r : 1;
    return [v[0] * k, v[1] * k, v[2] * k];
  }
  extent() { // raio de enquadramento em unidades da cena
    const rs = this.bodies.filter((b) => b.pos || b.orbit).map((b) => {
      const pts = b.orbit || [b.pos]; let m = 0; for (const p of pts) m = Math.max(m, Math.hypot(...this.radial(p))); return m;
    });
    return Math.max(1.6, ...(rs.length ? rs : [1.6]));
  }
  project(v) {
    const [x0, y0, z0] = this.radial(v);
    const cy = Math.cos(this.yaw); const sy = Math.sin(this.yaw);
    const x1 = x0 * cy - y0 * sy; const y1 = x0 * sy + y0 * cy;
    const cp = Math.cos(this.pitch); const sp = Math.sin(this.pitch);
    const y2 = y1 * cp - z0 * sp; const z2 = y1 * sp + z0 * cp;
    const R = this.fitR || this.extent(); const camD = R * 3.2;
    const f = (Math.min(this.w, this.h) * 0.46 * this.zoom) / R * (camD - 0) / camD;
    const persp = camD / (camD + y2);
    return [this.w / 2 + x1 * f * persp, this.h / 2 - z2 * f * persp, y2, persp];
  }
  draw() {
    if (this.dead || !this.w) return;
    const c = this.ctx; c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = '#030816'; c.fillRect(0, 0, this.w, this.h);
    for (const [fx, fy, a] of this.stars) { c.fillStyle = `rgba(234,241,255,${a * 0.5})`; c.fillRect(fx * this.w, fy * this.h, 1.2, 1.2); }
    this.fitR = this.extent();
    // anéis de referência (UA)
    c.lineWidth = 1;
    for (const au of (this.scale === 'real' ? [1, 5, 10, 20, 30, 40] : [1, 5, 30])) {
      c.strokeStyle = 'rgba(28,46,90,.55)'; c.beginPath();
      for (let k = 0; k <= 96; k++) { const a = (k / 96) * 2 * Math.PI; const [x, y] = this.project([au * Math.cos(a), au * Math.sin(a), 0]); k ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      const [lx, ly] = this.project([au, 0, 0]); c.fillStyle = 'rgba(147,165,203,.55)'; c.font = '10px "IBM Plex Sans", sans-serif'; c.fillText(`${au} UA`, lx + 3, ly - 3);
    }
    // órbitas
    for (const b of this.bodies) {
      if (!b.orbit) continue;
      c.strokeStyle = b.id === this.selected ? 'rgba(216,178,90,.9)' : 'rgba(127,178,255,.28)'; c.lineWidth = b.id === this.selected ? 1.6 : 1;
      c.beginPath(); b.orbit.forEach((p, k) => { const [x, y] = this.project(p); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    }
    // Sol
    const [sx, sy] = this.project([0, 0, 0]);
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, 22); g.addColorStop(0, 'rgba(255,226,140,1)'); g.addColorStop(0.35, 'rgba(255,190,80,.7)'); g.addColorStop(1, 'rgba(255,170,60,0)');
    c.fillStyle = g; c.beginPath(); c.arc(sx, sy, 22, 0, 2 * Math.PI); c.fill();
    // planetas, do fundo para a frente
    this.screen = [];
    const items = this.bodies.filter((b) => b.pos).map((b) => ({ b, p: this.project(b.pos) })).sort((u, v) => v.p[2] - u.p[2]);
    for (const { b, p } of items) {
      const [x, y, , persp] = p;
      const rad = Math.max(2.5, Math.min(9, 1.4 + Math.log10(b.radius_km) * 1.35)) * Math.max(0.7, Math.min(1.3, persp));
      c.fillStyle = b.color; c.beginPath(); c.arc(x, y, rad, 0, 2 * Math.PI); c.fill();
      if (b.id === 'saturn') { c.strokeStyle = 'rgba(230,207,139,.7)'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(x, y, rad * 2, rad * 0.7, -0.35, 0, 2 * Math.PI); c.stroke(); }
      if (b.id === this.selected) { c.strokeStyle = '#D8B25A'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, rad + 5, 0, 2 * Math.PI); c.stroke(); }
      if (this.labels) { c.fillStyle = 'rgba(234,241,255,.9)'; c.font = '12px "IBM Plex Sans", sans-serif'; c.fillText(b.short || b.name, x + rad + 4, y - rad - 2); }
      this.screen.push({ id: b.id, x, y, r: rad });
    }
  }
  pick(x, y) {
    let best = null; let bd = 16;
    for (const s of this.screen || []) { const d = Math.hypot(s.x - x, s.y - y) - s.r; if (d < bd) { bd = d; best = s.id; } }
    return best;
  }
  bind() {
    const cv = this.canvas; const pts = new Map(); let moved = 0; let pinch = null;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const [px, py] = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.zoom = Math.min(40, Math.max(0.4, this.zoom * d / pinch)); pinch = d; this.draw(); return;
      }
      const dx = e.clientX - px; const dy = e.clientY - py; moved += Math.abs(dx) + Math.abs(dy);
      this.yaw += dx * 0.008; this.pitch = Math.min(Math.PI / 2, Math.max(0, this.pitch - dy * 0.008)); this.draw();
    });
    const up = (e) => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (moved < 6 && e.type === 'pointerup') { const r = cv.getBoundingClientRect(); const id = this.pick(e.clientX - r.left, e.clientY - r.top); this.selected = id; this.onSelect(id); this.draw(); }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.min(40, Math.max(0.4, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); this.draw(); }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      const k = { ArrowLeft: () => { this.yaw -= 0.1; }, ArrowRight: () => { this.yaw += 0.1; }, ArrowUp: () => { this.pitch = Math.max(0, this.pitch - 0.1); },
        ArrowDown: () => { this.pitch = Math.min(Math.PI / 2, this.pitch + 0.1); }, '+': () => { this.zoom *= 1.2; }, '=': () => { this.zoom *= 1.2; }, '-': () => { this.zoom /= 1.2; } }[e.key];
      if (k) { e.preventDefault(); k(); this.draw(); }
    });
  }
}

const SHORT = { pluto: 'Plutão' };
function sceneBodies(model, positions) {
  const pos = new Map((positions || []).map((b) => [b.id, [b.x, b.y, b.z]]));
  return model.map((m) => ({ ...m, short: SHORT[m.id], pos: pos.get(m.id) || null }));
}

// ================================================================== tela: Sistema Solar 3D
export function viewSolarSystem(root) {
  root.innerHTML = head('Sistema Solar 3D', 'Posições oficiais do JPL Horizons para a data escolhida. A animação, quando ligada, usa elementos orbitais médios e aparece rotulada como simulação.') +
    `<form class="controls" id="ss-form">
      <label class="field">Data (0 h UTC)<input type="date" name="date" value="${todayISO()}" min="1950-01-01" max="2050-12-31" required></label>
      <button class="btn" type="submit">Ver posições do JPL</button>
      <fieldset class="seg" aria-label="Escala das distâncias"><legend class="sr-only">Escala</legend>
        <label><input type="radio" name="scale" value="adapted" checked> Distâncias adaptadas</label>
        <label><input type="radio" name="scale" value="real"> Distâncias reais</label></fieldset>
      <label class="check"><input type="checkbox" name="labels" checked> Nomes</label>
    </form>
    <div class="solar-layout"><div class="solar-main">
      <section class="panel solar-stage" id="ss-stage">
        <header class="panel-head"><h2 id="ss-title">Posições em ${todayISO().split('-').reverse().join('/')}</h2>
          <div class="panel-tools"><button class="icon-btn" type="button" data-fs="ss-stage" aria-label="Expandir o Sistema Solar em tela cheia" title="Tela cheia">⤢</button></div></header>
        <div class="panel-body">
          <div class="solar-canvas-wrap"><canvas id="ss-canvas" tabindex="0" aria-label="Sistema Solar em 3D. Arraste para girar, use a roda do mouse ou as teclas + e − para aproximar, e clique em um planeta para ver os dados."></canvas>
            <p class="solar-status" id="ss-status" role="status">Carregando as efemérides do JPL Horizons</p></div>
          <div class="sim-bar">
            <button class="btn secondary" type="button" id="ss-play" aria-pressed="false">▶ Animar (simulação)</button>
            <label class="field">Velocidade<select id="ss-speed"><option value="1">1 dia por segundo</option><option value="7" selected>1 semana por segundo</option><option value="30">1 mês por segundo</option><option value="365">1 ano por segundo</option></select></label>
            <button class="btn secondary" type="button" id="ss-back" hidden>Voltar às posições do JPL</button>
            <span class="reading-note" id="ss-simdate"></span>
          </div>
          <p class="reading-note">Arraste para girar, use a roda do mouse (ou pinça no celular) para aproximar e clique em um planeta. Os tamanhos dos planetas não estão em escala. Em "distâncias adaptadas" a distância ao Sol segue uma escala logarítmica, para caber tudo na tela; em "distâncias reais" a proporção é verdadeira.</p>
        </div>
        <div class="panel-plate" id="ss-plate"></div>
      </section>
      ${panelShell('ss-table', 'Distâncias na data')}
      </div>
      <div class="sky-side">
        ${panelShell('ss-info', 'Planeta selecionado')}
      </div>
    </div>`;

  const scene = new SolarScene($('#ss-canvas'), { onSelect: (id) => showInfo(id) });
  let model = null; let modelEnv = null; let posEnv = null; let positions = null;
  let sim = null; let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  const setPlate = (env) => { $('#ss-plate').innerHTML = plate(env); };
  const info = $('#ss-info'); const table = $('#ss-table');

  function current() { // posições exibidas agora (JPL ou simulação)
    if (sim) {
      const jd = jdOf(sim.date);
      return model.map((m) => {
        const [x, y, z] = keplerXYZ(m.elements_j2000, m.rates_per_century, jd);
        return { ...m, x, y, z };
      });
    }
    return positions;
  }
  function distances(list) {
    const earth = list.find((b) => b.id === 'earth');
    return list.map((b) => {
      const r = Math.hypot(b.x, b.y, b.z);
      const de = earth && b.id !== 'earth' ? Math.hypot(b.x - earth.x, b.y - earth.y, b.z - earth.z) : null;
      return { ...b, r, de };
    });
  }
  function showInfo(id) {
    const list = current();
    if (!id || !list) { $('.panel-body', info).innerHTML = '<p class="reading-note">Clique em um planeta na cena para ver distâncias e dados orbitais.</p>'; $('.panel-plate', info).innerHTML = ''; return; }
    const b = distances(list).find((x) => x.id === id); const m = model.find((x) => x.id === id);
    if (!b) return;
    $('.panel-body', info).innerHTML = `<h3 class="sub" style="color:${esc(m.color)}">${esc(m.name)}</h3><dl class="kv">
      <dt>Distância ao Sol</dt><dd>${nf(b.r, 3)} UA (${fmtNum(b.r * AU_MKM, 1)} milhões de km)</dd>
      ${b.de != null ? `<dt>Distância à Terra</dt><dd>${nf(b.de, 3)} UA — a luz leva ${fmtNum(b.de * LIGHT_MIN_PER_AU, 1)} min</dd>` : ''}
      <dt>Período orbital</dt><dd>${fmtNum(m.period_days, 1)} dias${m.period_days > 400 ? ` (${fmtNum(m.period_days / 365.25, 1)} anos)` : ''}</dd>
      <dt>Raio médio</dt><dd>${Math.round(m.radius_km).toLocaleString('pt-BR')} km</dd>
      <dt>Semieixo maior</dt><dd>${nf(m.elements_j2000[0], 3)} UA; excentricidade ${nf(m.elements_j2000[1], 4)}</dd></dl>
      <p class="reading-note">${sim ? 'Valores da simulação (elementos orbitais médios).' : 'Distâncias calculadas a partir das posições do JPL Horizons.'}</p>`;
    $('.panel-plate', info).innerHTML = plate(sim ? modelEnv : posEnv);
  }
  function showTable() {
    const list = current();
    if (!list) { $('.panel-body', table).innerHTML = unavailable(posEnv, 'Posições do JPL'); $('.panel-plate', table).innerHTML = plate(posEnv); return; }
    $('.panel-body', table).innerHTML = `<div class="table-wrap"><table><thead><tr><th>Corpo</th><th class="num">Ao Sol (UA)</th><th class="num">À Terra (UA)</th><th class="num">Luz até a Terra</th></tr></thead><tbody>
      ${distances(list).map((b) => `<tr><td class="nowrap"><span class="dot" style="background:${esc(b.color)}"></span>${esc(b.name)}</td><td class="num">${nf(b.r, 3)}</td>
        <td class="num">${b.de != null ? nf(b.de, 3) : '—'}</td><td class="num">${b.de != null ? `${fmtNum(b.de * LIGHT_MIN_PER_AU, 1)} min` : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('.panel-plate', table).innerHTML = plate(sim ? modelEnv : posEnv);
  }
  function render() {
    const list = current();
    scene.setBodies(sceneBodies(model, list));
    $('#ss-status').hidden = !!list;
    showTable(); if (scene.selected) showInfo(scene.selected); else showInfo(null);
  }

  async function load(date) {
    stop(); sim = null; $('#ss-back').hidden = true; $('#ss-play').setAttribute('aria-pressed', 'false'); $('#ss-play').textContent = '▶ Animar (simulação)'; $('#ss-simdate').textContent = '';
    $('#ss-status').hidden = false; $('#ss-status').textContent = 'Consultando o JPL Horizons';
    $('#ss-title').textContent = `Posições em ${date.split('-').reverse().join('/')}`;
    const [m, p] = await Promise.all([api(`/api/solar-system/model?date=${date}`), api(`/api/solar-system/positions?date=${date}`)]);
    if (!m.data) { $('#ss-status').innerHTML = unavailable(m, 'Modelo do Sistema Solar'); return; }
    model = m.data.bodies; modelEnv = m; posEnv = p;
    positions = p.data ? p.data.bodies : null;
    if (!positions) $('#ss-status').innerHTML = `<span>As posições oficiais do JPL Horizons não estão disponíveis agora (${esc(p.error || 'sem resposta')}). As órbitas aparecem; use "Animar (simulação)" para ver posições calculadas e rotuladas como simulação.</span>`;
    setPlate(positions ? p : m);
    render();
  }

  $('#ss-form').addEventListener('submit', (e) => { e.preventDefault(); load(e.target.date.value); });
  $$('input[name="scale"]', root).forEach((r) => r.addEventListener('change', () => { scene.scale = r.value; scene.zoom = 1; scene.draw(); }));
  $('#ss-form').elements.namedItem('labels').addEventListener('change', (e) => { scene.labels = e.target.checked; scene.draw(); });
  $('#ss-play').addEventListener('click', () => {
    if (!model) return;
    if (raf) { stop(); $('#ss-play').textContent = '▶ Continuar animação'; $('#ss-play').setAttribute('aria-pressed', 'false'); return; }
    if (!sim) sim = { date: new Date(`${$('#ss-form').date.value}T00:00:00Z`) };
    $('#ss-back').hidden = false; $('#ss-play').textContent = '⏸ Pausar'; $('#ss-play').setAttribute('aria-pressed', 'true');
    setPlate(modelEnv);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = performance.now();
    const step = (t) => {
      if (!document.body.contains(scene.canvas)) { stop(); scene.destroy(); return; }
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      sim.date = new Date(sim.date.getTime() + dt * Number($('#ss-speed').value) * 86400000);
      $('#ss-simdate').innerHTML = `<span class="badge badge--simulation">Simulação</span> ${sim.date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`;
      scene.setBodies(sceneBodies(model, current()));
      if (scene.selected) showInfo(scene.selected);
      raf = reduce ? 0 : requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    state.timers.push(setInterval(() => { if (sim) showTable(); }, 1000));
  });
  $('#ss-back').addEventListener('click', () => { load($('#ss-form').date.value); });
  load(todayISO());
}

// ================================================================== tela: eventos
const ALERT_KEY = 'thz-alerts';
const TYPE_CLASS = { moon_phase: 'moon', eclipse: 'eclipse', meteor_shower: 'meteor', conjunction: 'conj', opposition: 'opp', elongation: 'elong', season: 'season' };
const DEFAULT_TYPES = ['eclipse', 'meteor_shower', 'conjunction', 'opposition', 'elongation', 'season', 'moon_phase'];

function eventQS(f) {
  const q = new URLSearchParams({ days: f.days, lat: f.lat, lon: f.lon, tz: f.tz });
  if (f.types?.length) q.set('types', f.types.join(','));
  return q;
}

export function viewEvents(root) {
  const s = site();
  const saved = local.get('thz-events-filter') || {};
  const f = { lat: saved.lat ?? s.lat, lon: saved.lon ?? s.lon, tz: saved.tz ?? s.tz, days: saved.days ?? 90, types: saved.types ?? DEFAULT_TYPES };
  const labels = { moon_phase: 'Fases da Lua', eclipse: 'Eclipses', meteor_shower: 'Chuvas de meteoros', conjunction: 'Conjunções', opposition: 'Oposições', elongation: 'Elongações máximas', season: 'Equinócios e solstícios' };
  root.innerHTML = head('Eventos astronômicos', 'Fases da Lua, eclipses, chuvas de meteoros, conjunções, oposições e estações, com a visibilidade calculada para o seu local.') +
    `<form class="controls" id="ev-form">
      <label class="field">Latitude<input name="lat" type="number" step="0.0001" min="-90" max="90" value="${f.lat}" style="width:120px" required></label>
      <label class="field">Longitude<input name="lon" type="number" step="0.0001" min="-180" max="180" value="${f.lon}" style="width:120px" required></label>
      <label class="field">Fuso horário<input name="tz" value="${esc(f.tz)}" style="width:190px" required></label>
      <label class="field">Período<select name="days">${[30, 90, 180, 365].map((d) => `<option value="${d}" ${d === Number(f.days) ? 'selected' : ''}>Próximos ${d} dias</option>`).join('')}</select></label>
      <button class="btn" type="submit">Atualizar</button>
      <button class="btn secondary" type="button" id="ev-geo">Usar minha localização</button>
    </form>
    <div class="chips" id="ev-types" role="group" aria-label="Tipos de evento">${Object.entries(labels).map(([k, l]) => `<button class="chip type-chip t-${TYPE_CLASS[k]}" type="button" data-type="${k}" aria-pressed="${f.types.includes(k)}">${l}</button>`).join('')}</div>
    <div class="events-layout">
      <section class="panel" id="ev-list-panel"><header class="panel-head"><h2>Calendário</h2>
        <div class="panel-tools ev-export"><label class="field inline">Lembrete<select id="ev-alarm"><option value="">sem lembrete</option><option value="60" selected>1 h antes</option><option value="1440">1 dia antes</option></select></label>
          <a class="btn secondary" id="ev-ics" href="#" download>Baixar calendário (.ics)</a></div></header>
        <div class="panel-body" id="ev-list"><p class="loading">Calculando os eventos</p></div><div class="panel-plate" id="ev-plate"></div></section>
      <div class="sky-side">
        <section class="panel" id="ev-highlights"><header class="panel-head"><h2>Próximos destaques</h2></header><div class="panel-body"><p class="loading">Calculando</p></div></section>
        ${alertsPanel()}
      </div></div>`;

  const form = $('#ev-form');
  const read = () => {
    const d = new FormData(form);
    return { lat: Number(d.get('lat')), lon: Number(d.get('lon')), tz: String(d.get('tz')).trim(), days: Number(d.get('days')),
      types: $$('#ev-types [data-type]').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.type) };
  };
  const icsHref = (q, extra = {}) => {
    const qs = new URLSearchParams(q); const alarm = $('#ev-alarm').value; if (alarm) qs.set('alarm', alarm);
    Object.entries(extra).forEach(([k, v]) => qs.set(k, v));
    return apiUrl(`/api/events.ics?${qs}`);
  };
  async function run() {
    const q = read(); local.set('thz-events-filter', q);
    const list = $('#ev-list'); list.innerHTML = '<p class="loading">Calculando os eventos</p>';
    if (!q.types.length) { list.innerHTML = '<p class="reading-note">Escolha pelo menos um tipo de evento.</p>'; return; }
    const env = await api(`/api/events?${eventQS(q)}`);
    $('#ev-plate').innerHTML = plate(env);
    if (env.status === 'invalid') { list.innerHTML = `<div class="unavailable"><strong>Verifique os dados.</strong>${esc(env.error)}</div>`; return; }
    if (!env.data) { list.innerHTML = unavailable(env, 'Central de eventos'); return; }
    const evs = env.data.events; const zone = q.tz;
    $('#ev-ics').href = icsHref(eventQS(q)); $('#ev-ics').textContent = `Baixar calendário (.ics) — ${evs.length} eventos`;
    $('#ev-alarm').onchange = () => { $('#ev-ics').href = icsHref(eventQS(q)); };
    if (!evs.length) { list.innerHTML = '<p class="reading-note">Nenhum evento dos tipos escolhidos no período.</p>'; }
    else {
      let month = '';
      list.innerHTML = `<ol class="event-list">${evs.map((e) => {
        const m = fmtIn(e.when, zone, { month: 'long', year: 'numeric' });
        const sep = m !== month ? `<li class="event-month">${esc(m.charAt(0).toUpperCase() + m.slice(1))}</li>` : ''; month = m;
        return `${sep}<li class="event-item imp-${e.importance}">
          <div class="event-when"><span class="event-day">${fmtIn(e.when, zone, { day: '2-digit' })}</span><span>${fmtIn(e.when, zone, { weekday: 'short' })}</span><span>${fmtIn(e.when, zone, { hour: '2-digit', minute: '2-digit' })}</span></div>
          <div class="event-body"><span class="type-tag t-${TYPE_CLASS[e.type]}">${esc(e.type_label)}</span>
            <h3>${esc(e.title)}</h3><p>${esc(e.description)}</p>${e.visibility ? `<p class="event-vis">${esc(e.visibility)}</p>` : ''}
            <p class="row-actions">${NATIVE() && new Date(e.when).getTime() > Date.now() ? `<button class="chip remind-btn" type="button" data-remind="${esc(JSON.stringify({ type: e.type, when: e.when, title: e.title, description: e.description, visibility: e.visibility || '' }))}" aria-pressed="${window.THZNative.hasReminder(e)}">${window.THZNative.hasReminder(e) ? '🔔 Lembrete agendado' : '🔔 Lembrar no celular'}</button>` : ''}<a href="${esc(icsHref(eventQS(q), { only: e.when }))}" download>Adicionar ao calendário</a>${e.link ? ` <a href="${esc(e.link)}" target="_blank" rel="noopener">Mais informações</a>` : ''}</p></div></li>`;
      }).join('')}</ol>
      <ul class="note-list">${env.data.simplifications.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    }
    const hl = evs.filter((e) => e.importance >= 2 && e.type !== 'moon_phase').slice(0, 5);
    $('#ev-highlights .panel-body').innerHTML = hl.length ? `<ul class="highlights">${hl.map((e) => `<li><span class="type-tag t-${TYPE_CLASS[e.type]}">${esc(e.type_label)}</span>
      <strong>${esc(e.title)}</strong><span class="reading-note">${fmtIn(e.when, zone, { dateStyle: 'medium', timeStyle: 'short' })} (${esc(zone)})</span></li>`).join('')}</ul>` : '<p class="reading-note">Sem destaques no período.</p>';
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  // App Android: lembrete nativo de um evento (funciona com o app fechado).
  $('#ev-list').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-remind]'); if (!b || !NATIVE()) return;
    const e = JSON.parse(b.dataset.remind); const lead = Number($('#ev-alarm').value || 60);
    b.disabled = true;
    const r = await window.THZNative.remindOne(e, lead, read().tz);
    b.disabled = false;
    if (r.ok) { b.setAttribute('aria-pressed', 'true'); b.textContent = '🔔 Lembrete agendado'; }
    else b.textContent = r.reason === 'permission' ? 'Permita as notificações do app' : r.reason === 'past' ? 'Horário do lembrete já passou' : 'Não foi possível agendar';
  });
  $$('#ev-types [data-type]').forEach((b) => b.addEventListener('click', () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); run(); }));
  $('#ev-geo').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      form.lat.value = pos.coords.latitude.toFixed(4); form.lon.value = pos.coords.longitude.toFixed(4);
      form.tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone; run();
    }, () => { $('#ev-geo').textContent = 'Localização não autorizada'; });
  });
  bindAlertsPanel(read);
  run();
}

// ================================================================== alertas no navegador
function alertCfg() { return local.get(ALERT_KEY) || { enabled: false, types: ['eclipse', 'meteor_shower', 'opposition', 'conjunction'], lead: 60 }; }
function alertsPanel() {
  const c = alertCfg();
  const opts = { eclipse: 'Eclipses', meteor_shower: 'Chuvas de meteoros', opposition: 'Oposições', conjunction: 'Conjunções', elongation: 'Elongações', season: 'Estações', moon_phase: 'Fases da Lua' };
  return `<section class="panel" id="ev-alerts"><header class="panel-head"><h2>Alertas</h2></header><div class="panel-body">
    <p class="reading-note">${NATIVE() ? 'Notificações no celular, mesmo com o app fechado, para os eventos dos próximos 30 dias. A agenda é renovada sempre que você abre o app.' : 'Avisos neste navegador enquanto o site estiver aberto. Para lembretes garantidos no celular, use "Baixar calendário (.ics)" com lembrete.'}</p>
    <div class="alert-types">${Object.entries(opts).map(([k, l]) => `<label class="check"><input type="checkbox" name="al-type" value="${k}" ${c.types.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <label class="field">Avisar<select id="al-lead">${[[15, '15 min antes'], [60, '1 h antes'], [180, '3 h antes'], [1440, '1 dia antes']].map(([v, l]) => `<option value="${v}" ${v === c.lead ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="controls" style="margin:10px 0 0"><button class="btn" type="button" id="al-on">${c.enabled ? 'Salvar alertas' : 'Ativar alertas'}</button>
      <button class="btn secondary" type="button" id="al-off" ${c.enabled ? '' : 'hidden'}>Desativar</button></div>
    <p class="reading-note" id="al-msg" role="status">${c.enabled ? 'Alertas ativos.' : 'Alertas desativados.'}</p></div></section>`;
}
function bindAlertsPanel(readSite) {
  const save = async (enabled) => {
    const s = readSite();
    const cfg = { enabled, types: $$('input[name="al-type"]:checked').map((i) => i.value), lead: Number($('#al-lead').value), site: { lat: s.lat, lon: s.lon, tz: s.tz } };
    local.set(ALERT_KEY, cfg); alertCache = null;
    let note = enabled ? 'Alertas ativos neste navegador.' : 'Alertas desativados.';
    if (NATIVE()) {
      $('#al-msg').textContent = enabled ? 'Agendando as notificações…' : 'Desativando…';
      const r = await refreshNativeAlerts();
      note = !enabled ? 'Alertas desativados. Nenhuma notificação agendada.'
        : r?.ok ? `Alertas ativos: ${r.count} notificação(ões) agendada(s) para os próximos 30 dias.`
          : r?.reason === 'permission' ? 'Sem permissão de notificação. Libere em Configurações > Apps > Astronomy Center > Notificações; os avisos aparecem só dentro do app.'
            : 'Não foi possível consultar os eventos agora. A agenda será feita na próxima abertura do app.';
    } else if (enabled && 'Notification' in window && Notification.permission === 'default') {
      try { const p = await Notification.requestPermission(); if (p !== 'granted') note += ' Sem permissão de notificação: os avisos aparecem só dentro da página.'; } catch { /* navegador sem suporte */ }
    } else if (enabled && !('Notification' in window)) note += ' Este navegador não tem notificações: os avisos aparecem só dentro da página.';
    $('#al-msg').textContent = note; $('#al-off').hidden = !enabled; $('#al-on').textContent = enabled ? 'Salvar alertas' : 'Ativar alertas';
    checkAlerts();
  };
  $('#al-on').addEventListener('click', () => save(true));
  $('#al-off').addEventListener('click', () => save(false));
}
let alertCache = null;
async function checkAlerts() {
  const c = alertCfg(); if (!c.enabled || !c.types.length) return;
  const s = c.site || site();
  if (!alertCache || Date.now() - alertCache.at > 6 * 3600 * 1000) {
    const env = await api(`/api/events?${eventQS({ ...s, days: 3, types: c.types })}`);
    if (!env.data) return;
    alertCache = { at: Date.now(), events: env.data.events };
  }
  const fired = new Set(local.get('thz-alerts-fired') || []);
  const now = Date.now();
  for (const e of alertCache.events) {
    const t = new Date(e.when).getTime(); const key = `${e.type}|${e.when}`;
    if (now >= t - c.lead * 60000 && now < t + 3600000 && !fired.has(key)) {
      fired.add(key);
      const when = fmtIn(e.when, s.tz, { dateStyle: 'short', timeStyle: 'short' });
      toast(`${e.title} — ${when}`, e.visibility || e.description);
      if (!NATIVE() && 'Notification' in window && Notification.permission === 'granted') { try { new Notification(e.title, { body: `${when}. ${e.visibility || e.description}` }); } catch { /* ignora */ } }
    }
  }
  local.set('thz-alerts-fired', [...fired].slice(-200));
}
function toast(title, body) {
  let box = $('#toasts'); if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="toasts" class="toasts" aria-live="polite"></div>'); box = $('#toasts'); }
  box.insertAdjacentHTML('beforeend', `<div class="toast"><strong>${esc(title)}</strong><p>${esc(body)}</p><button class="icon-btn" type="button" aria-label="Fechar aviso">✕</button></div>`);
  const t = box.lastElementChild; $('button', t).addEventListener('click', () => t.remove());
}
export function startAlerts() { checkAlerts(); setInterval(checkAlerts, 60000); refreshNativeAlerts(); }

/** App Android: agenda (ou cancela) as notificações nativas conforme a configuração dos alertas. */
let nativeBusy = null;
export function refreshNativeAlerts() {
  if (!NATIVE()) return Promise.resolve(null);
  if (nativeBusy) return nativeBusy;
  nativeBusy = (async () => {
    const c = alertCfg();
    if (!c.enabled || !c.types.length) return window.THZNative.scheduleAlerts([], { enabled: false });
    const s = c.site || site();
    const env = await api(`/api/events?${eventQS({ ...s, days: 30, types: c.types })}`);
    if (!env.data) return { ok: false, reason: 'unavailable' };
    return window.THZNative.scheduleAlerts(env.data.events, { ...c, site: s });
  })().catch(() => ({ ok: false, reason: 'error' })).finally(() => { nativeBusy = null; });
  return nativeBusy;
}

// ================================================================== Sol, Lua e planetas no céu
export function skyBodiesHTML(d) {
  const t = (s) => (s ? s.slice(11, 16) : '—');
  return `<p class="reading-note">${esc(d.sky_condition)}. Lua ${Math.round(d.moon.illumination * 100)}% iluminada (${esc(d.moon.phase.toLowerCase())}).</p>
    <div class="table-wrap"><table class="bodies"><thead><tr><th>Corpo</th><th class="num">Altitude</th><th class="num">Azimute</th><th>Nasce</th><th>Põe-se</th><th><span class="sr-only">Ação</span></th></tr></thead><tbody>
    ${d.bodies.map((b) => `<tr class="${b.above_horizon ? 'up' : 'down'}"><td><span class="dot" style="background:${esc(b.color)}"></span>${esc(b.name)}</td>
      <td class="num">${nf(b.altitude_deg, 1)}°</td><td class="num">${nf(b.azimuth_deg, 0)}°</td>
      <td>${b.visibility === 'circumpolar' ? 'sempre acima' : b.visibility === 'nunca_nasce' ? 'não nasce' : t(b.rise_local)}</td><td>${b.visibility === 'nasce_e_se_poe' ? t(b.set_local) : '—'}</td>
      <td>${b.id === 'sun' ? '' : `<button class="chip" type="button" data-goto="${b.ra},${b.dec}" data-name="${esc(b.name)}">Ver no atlas</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <ul class="note-list">${d.simplifications.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="reading-note"><strong>Nunca aponte binóculos ou telescópios para o Sol sem filtro solar certificado.</strong></p>`;
}
/** Painel "Sol, Lua e planetas agora" na tela do mapa celeste, com marcadores no Aladin. */
export async function mountSkyBodies(panel, getSite, getAladin) {
  const s = getSite();
  const env = await api(`/api/sky/solar-system?${new URLSearchParams({ lat: s.lat, lon: s.lon, tz: s.tz })}`);
  fill(panel, env, 'Posições de Sol, Lua e planetas', (b, d) => {
    b.innerHTML = skyBodiesHTML(d);
    $$('[data-goto]', b).forEach((btn) => btn.addEventListener('click', () => {
      const al = getAladin(); const [ra, dec] = btn.dataset.goto.split(',').map(Number);
      if (al) { al.gotoRaDec(ra, dec); al.setFoV(btn.dataset.name === 'Lua' ? 2 : 0.5); }
    }));
    addMarkers(getAladin(), d);
  });
  return env;
}
let markerCatalog = null;
export function addMarkers(al, d) {
  if (!al || !d || !window.A?.catalog) return;
  try {
    if (markerCatalog) { markerCatalog.removeAll?.(); } else { markerCatalog = window.A.catalog({ name: 'Sol, Lua e planetas (JPL Horizons)', sourceSize: 18, color: '#D8B25A' }); al.addCatalog(markerCatalog); }
    markerCatalog.addSources(d.bodies.map((b) => window.A.marker(b.ra, b.dec, { popupTitle: b.name, popupDesc: `Altitude ${nf(b.altitude_deg, 1)}° agora no seu local. Posição geocêntrica do JPL Horizons.` })));
  } catch { /* versão do Aladin sem suporte a marcadores: a tabela continua disponível */ }
}
export const resetMarkers = () => { markerCatalog = null; };

// ================================================================== painéis do Mission Control
const wdef = (id, d) => { W[id] = { cls: '', sources: [], group: 'Outros', ...d }; };
wdef('solar-mini', {
  title: 'Sistema Solar hoje', group: 'Sistema Solar', cls: 'span-2', sources: ['jpl_horizons_3d'],
  async load(p) {
    const [m, pos] = await Promise.all([api('/api/solar-system/model'), api('/api/solar-system/positions')]);
    fill(p, pos, 'Posições do JPL', (b, d) => {
      if (!m.data) { b.innerHTML = unavailable(m, 'Modelo do Sistema Solar'); return; }
      b.innerHTML = `<div class="solar-canvas-wrap mini"><canvas aria-label="Vista do Sistema Solar hoje, com posições do JPL Horizons. Arraste para girar."></canvas></div>
        <p class="row-actions"><a href="#solar-system">Abrir o Sistema Solar 3D</a></p>`;
      const sc = new SolarScene($('canvas', b), { pitch: 1.2, yaw: -0.3 });
      sc.setBodies(sceneBodies(m.data.bodies, d.bodies));
    });
  },
});
wdef('events-next', {
  title: 'Próximos eventos astronômicos', group: 'Eventos', sources: [],
  async load(p) {
    const s = site();
    const env = await api(`/api/events?${eventQS({ ...s, days: 45, types: ['eclipse', 'meteor_shower', 'conjunction', 'opposition', 'elongation', 'season', 'moon_phase'] })}`);
    fill(p, env, 'Central de eventos', (b, d) => {
      const evs = d.events.filter((e) => e.type !== 'moon_phase' || e.importance >= 2).slice(0, 7);
      b.innerHTML = evs.length ? `<ul class="highlights">${evs.map((e) => `<li><span class="type-tag t-${TYPE_CLASS[e.type]}">${esc(e.type_label)}</span>
        <strong>${esc(e.title)}</strong><span class="reading-note">${fmtIn(e.when, s.tz, { dateStyle: 'short', timeStyle: 'short' })}</span></li>`).join('')}</ul>
        <p class="row-actions"><a href="#events">Abrir a central de eventos</a></p>` : '<p class="reading-note">Nenhum evento nos próximos 45 dias.</p>';
    });
  },
});
wdef('sky-bodies', {
  title: 'Sol, Lua e planetas agora', group: 'Céu', sources: ['jpl_horizons_sky'],
  async load(p) {
    const s = site();
    const env = await api(`/api/sky/solar-system?${new URLSearchParams({ lat: s.lat, lon: s.lon, tz: s.tz })}`);
    fill(p, env, 'Posições de Sol, Lua e planetas', (b, d) => { b.innerHTML = skyBodiesHTML(d).replace(/<button class="chip"[^>]*>Ver no atlas<\/button>/g, ''); });
  },
});
