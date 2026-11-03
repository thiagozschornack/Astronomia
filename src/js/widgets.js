// Painéis reutilizáveis. Cada um declara as fontes de que depende ("sources"), para
// ser recarregado automaticamente quando o servidor avisa uma nova sincronização (SSE).
import {
  $, api, AX, chart, disposePanelCharts, esc, favButton, fill, fmtDate, fmtDT, fmtInt, fmtNum,
  latest, loadFavorites, loadScript, panelShell, state, timeAxis, tooltipTime, unavailable, valAxis,
} from './core.js?v=0.3.0';

export const W = {};
const def = (id, d) => { W[id] = { cls: '', sources: [], group: 'Outros', ...d }; };

export function mount(container, wid, extraCls = '') {
  const d = W[wid];
  if (!d) return null;
  const pid = `w-${wid}-${++state.seq}`;
  container.insertAdjacentHTML('beforeend', panelShell(pid, d.title, `${d.cls} ${extraCls}`));
  const panel = document.getElementById(pid);
  panel.dataset.widget = wid;
  state.mounted.push({ wid, panel });
  loadWidget(panel);
  return panel;
}
export async function loadWidget(panel) {
  const d = W[panel.dataset.widget];
  if (!d || !document.body.contains(panel)) return;
  disposePanelCharts(panel);
  try {
    await d.load(panel);
  } catch (e) {
    $('.panel-body', panel).innerHTML = unavailable({ error: `Erro ao exibir os dados: ${e.message}` }, d.title);
  }
}
export function mountedFor(sourceId) {
  state.mounted = state.mounted.filter((m) => document.body.contains(m.panel));
  return state.mounted.filter((m) => W[m.wid]?.sources.includes(sourceId)).map((m) => m.panel);
}

const reading = (value, unit, extra = '') => `<div class="reading"><span class="value">${value}</span>${unit ? `<span class="unit">${unit}</span>` : ''}${extra}</div>`;
const note = (html) => `<p class="reading-note">${html}</p>`;
const LD_AU = 0.002569555;
const fmtExp = (v) => v.toExponential(2).replace('.', ',').replace('e', '×10^').replace(/\^\+?(-?\d+)$/, (m, e) => `<sup>${e}</sup>`);

// ================================================================== Sol e clima espacial
def('kp-now', {
  title: 'Atividade geomagnética (Kp)', group: 'Clima espacial', sources: ['swpc_kp'],
  async load(p) {
    fill(p, await api('/api/space-weather/kp'), 'Índice Kp', (b, rows) => {
      const r = rows[rows.length - 1];
      b.innerHTML = reading(fmtNum(r.kp, 2), '', `<span class="scale-tag ${r.kp >= 5 ? 'storm' : ''}">${r.g_scale === 'G0' ? 'Sem tempestade (G0)' : `Tempestade ${esc(r.g_scale)}`}</span>`) +
        note(`Intervalo de 3 h iniciado em ${fmtDT(r.time)}. Escala NOAA: G1 a partir de Kp 5.`);
    });
  },
});
def('kp-chart', {
  title: 'Índice Kp — últimos dias', group: 'Clima espacial', cls: 'span-all', sources: ['swpc_kp'],
  async load(p) {
    fill(p, await api('/api/space-weather/kp'), 'Índice Kp', (b, rows) => {
      b.innerHTML = '<div class="chart"></div>';
      chart($('.chart', b), {
        xAxis: timeAxis(), yAxis: valAxis('Kp', { min: 0, max: 9, interval: 1 }), legend: { show: false },
        tooltip: { formatter: (x) => tooltipTime(x) },
        series: [{
          name: 'Kp', type: 'bar', barMaxWidth: 14, data: rows.map((r) => [r.time, r.kp]),
          itemStyle: { color: (q) => (q.value[1] >= 5 ? '#F26C5F' : q.value[1] >= 4 ? '#D8B25A' : '#4FD6EC') },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: '#F26C5F', type: 'dashed' }, label: { formatter: 'G1 (Kp 5)', color: '#F26C5F' }, data: [{ yAxis: 5 }] },
        }],
      });
    });
  },
});
def('wind-now', {
  title: 'Vento solar no ponto L1', group: 'Clima espacial', sources: ['swpc_plasma'],
  async load(p) {
    fill(p, await api('/api/space-weather/solar-wind/plasma'), 'Vento solar', (b, rows) => {
      const s = latest(rows, 'speed'); const d = latest(rows, 'density');
      if (!s) { b.innerHTML = unavailable({ error: 'A série recebida não contém velocidade válida.' }, 'Velocidade do vento solar'); return; }
      b.innerHTML = reading(fmtInt(s.speed), 'km/s') +
        note(`Densidade: ${d ? `${fmtNum(d.density, 1)} prótons/cm³` : '—'}. Medição de ${fmtDT(s.time)}; o plasma leva cerca de 1 h de L1 até a Terra.`);
    });
  },
});
def('plasma-chart', {
  title: 'Vento solar: velocidade e densidade (24 h)', group: 'Clima espacial', cls: 'span-2', sources: ['swpc_plasma'],
  async load(p) {
    fill(p, await api('/api/space-weather/solar-wind/plasma'), 'Vento solar', (b, rows) => {
      b.innerHTML = '<div class="chart"></div>';
      chart($('.chart', b), {
        xAxis: timeAxis(), yAxis: [valAxis('km/s', { scale: true }), valAxis('p/cm³', { scale: true, splitLine: { show: false } })],
        tooltip: { formatter: (x) => tooltipTime(x, 1) },
        series: [
          { name: 'Velocidade', type: 'line', showSymbol: false, data: rows.filter((r) => r.speed != null).map((r) => [r.time, r.speed]), lineStyle: { color: '#4FD6EC', width: 1.4 }, itemStyle: { color: '#4FD6EC' } },
          { name: 'Densidade', type: 'line', yAxisIndex: 1, showSymbol: false, data: rows.filter((r) => r.density != null).map((r) => [r.time, r.density]), lineStyle: { color: '#D8B25A', width: 1 }, itemStyle: { color: '#D8B25A' } },
        ],
      });
    });
  },
});
def('bz-now', {
  title: 'Campo magnético interplanetário', group: 'Clima espacial', sources: ['swpc_mag'],
  async load(p) {
    fill(p, await api('/api/space-weather/solar-wind/mag'), 'Campo magnético', (b, rows) => {
      const m = latest(rows, 'bz');
      if (!m) { b.innerHTML = unavailable({ error: 'A série recebida não contém Bz válido.' }, 'Componente Bz'); return; }
      b.innerHTML = reading(fmtNum(m.bz, 1), 'nT (Bz, GSM)') +
        note(`Intensidade total Bt: ${fmtNum(m.bt, 1)} nT. Bz negativo e persistente favorece atividade geomagnética. Medição de ${fmtDT(m.time)}.`);
    });
  },
});
def('mag-chart', {
  title: 'Campo magnético interplanetário (24 h)', group: 'Clima espacial', cls: 'span-2', sources: ['swpc_mag'],
  async load(p) {
    fill(p, await api('/api/space-weather/solar-wind/mag'), 'Campo magnético', (b, rows) => {
      b.innerHTML = '<div class="chart"></div>';
      chart($('.chart', b), {
        xAxis: timeAxis(), yAxis: valAxis('nT'), tooltip: { formatter: (x) => tooltipTime(x, 1) },
        series: [
          { name: 'Bz (GSM)', type: 'line', showSymbol: false, data: rows.filter((r) => r.bz != null).map((r) => [r.time, r.bz]), lineStyle: { color: '#4FD6EC', width: 1.2 }, itemStyle: { color: '#4FD6EC' },
            markLine: { silent: true, symbol: 'none', lineStyle: { color: '#93A5CB' }, label: { show: false }, data: [{ yAxis: 0 }] } },
          { name: 'Bt', type: 'line', showSymbol: false, data: rows.filter((r) => r.bt != null).map((r) => [r.time, r.bt]), lineStyle: { color: '#B993F5', width: 1 }, itemStyle: { color: '#B993F5' } },
        ],
      });
    });
  },
});
def('flare-now', {
  title: 'Raios X solares (GOES)', group: 'Clima espacial', sources: ['swpc_xray'],
  async load(p) {
    fill(p, await api('/api/space-weather/xray'), 'Fluxo de raios X', (b, rows) => {
      const last = latest(rows, 'long');
      if (!last) { b.innerHTML = unavailable({ error: 'Sem medições no canal 0,1–0,8 nm.' }, 'Fluxo de raios X'); return; }
      const peak = rows.reduce((a, r) => (r.long != null && (!a || r.long > a.long) ? r : a), null);
      const big = /^[MX]/.test(last.flare_class);
      b.innerHTML = reading(esc(last.flare_class), 'classe atual', big ? '<span class="scale-tag storm">Fulguração em curso</span>' : '') +
        note(`Fluxo 0,1–0,8 nm: ${fmtExp(last.long)} W/m² às ${fmtDT(last.time)}. Pico nas últimas 24 h: <b>${esc(peak.flare_class)}</b> às ${fmtDT(peak.time)}.`);
    });
  },
});
def('xray-chart', {
  title: 'Fluxo de raios X solar (24 h)', group: 'Clima espacial', cls: 'span-2', sources: ['swpc_xray'],
  async load(p) {
    fill(p, await api('/api/space-weather/xray'), 'Fluxo de raios X', (b, rows) => {
      b.innerHTML = '<div class="chart"></div>' + note('Escala logarítmica. As faixas A, B, C, M e X são as classes de fulguração NOAA (canal 0,1–0,8 nm).');
      const bands = [['A', 1e-8], ['B', 1e-7], ['C', 1e-6], ['M', 1e-5], ['X', 1e-4]];
      chart($('.chart', b), {
        xAxis: timeAxis(),
        yAxis: valAxis('W/m²', { type: 'log', min: 1e-9, max: 1e-2, axisLabel: { ...AX.axisLabel, formatter: (v) => v.toExponential(0) } }),
        tooltip: { formatter: (x) => tooltipTime(x, 2, (v) => v.toExponential(2)) },
        series: [
          { name: '0,1–0,8 nm', type: 'line', showSymbol: false, data: rows.filter((r) => r.long).map((r) => [r.time, r.long]), lineStyle: { color: '#D8B25A', width: 1.3 }, itemStyle: { color: '#D8B25A' },
            markLine: { silent: true, symbol: 'none', lineStyle: { color: 'rgba(147,165,203,.35)', type: 'dotted' }, label: { color: '#93A5CB', formatter: (q) => q.name, position: 'insideStartTop' }, data: bands.map(([n, y]) => ({ name: n, yAxis: y })) } },
          { name: '0,05–0,4 nm', type: 'line', showSymbol: false, data: rows.filter((r) => r.short).map((r) => [r.time, r.short]), lineStyle: { color: '#B993F5', width: 1 }, itemStyle: { color: '#B993F5' } },
        ],
      });
    });
  },
});
def('dst-now', {
  title: 'Índice Dst', group: 'Clima espacial', sources: ['swpc_dst'],
  async load(p) {
    fill(p, await api('/api/space-weather/dst'), 'Índice Dst', (b, rows) => {
      const r = rows[rows.length - 1];
      const recent = rows.slice(-72);
      b.innerHTML = reading(fmtInt(r.dst), 'nT', `<span class="scale-tag ${r.dst <= -50 ? 'storm' : ''}">${esc(r.level)}</span>`) +
        note(`Valor horário provisório de ${fmtDT(r.time)}. Mínimo das últimas 72 h: ${fmtInt(Math.min(...recent.map((x) => x.dst)))} nT.`) +
        '<div class="chart" style="height:150px"></div>';
      chart($('.chart', b), {
        grid: { left: 44, right: 12, top: 10, bottom: 26 }, legend: { show: false }, xAxis: timeAxis(), yAxis: valAxis(''),
        tooltip: { formatter: (x) => tooltipTime(x, 0) },
        series: [{ name: 'Dst', type: 'line', showSymbol: false, data: recent.map((x) => [x.time, x.dst]), lineStyle: { color: '#4FD6EC' }, itemStyle: { color: '#4FD6EC' },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: '#F26C5F', type: 'dashed' }, label: { show: false }, data: [{ yAxis: -50 }] } }],
      });
    });
  },
});
def('f107', {
  title: 'Fluxo solar F10.7', group: 'Clima espacial', sources: ['swpc_f107'],
  async load(p) {
    fill(p, await api('/api/space-weather/f107'), 'Fluxo F10.7', (b, rows) => {
      const last = rows[rows.length - 1];
      b.innerHTML = reading(fmtNum(last.flux, 1), 'sfu') + note(`Medição de ${fmtDT(last.time)}. 1 sfu = 10⁻²² W·m⁻²·Hz⁻¹.`) + '<div class="chart" style="height:150px"></div>';
      chart($('.chart', b), {
        grid: { left: 44, right: 12, top: 10, bottom: 26 }, legend: { show: false }, xAxis: timeAxis(), yAxis: valAxis('', { scale: true }),
        tooltip: { formatter: (x) => tooltipTime(x, 1) },
        series: [{ name: 'F10.7', type: 'line', showSymbol: false, data: rows.slice(-120).map((r) => [r.time, r.flux]), lineStyle: { color: '#4FD6EC' }, itemStyle: { color: '#4FD6EC' } }],
      });
    });
  },
});
def('sunspots', {
  title: 'Manchas solares — médias mensais', group: 'Clima espacial', cls: 'span-all', sources: ['swpc_sunspots'],
  async load(p) {
    fill(p, await api('/api/space-weather/sunspots'), 'Manchas solares', (b, rows) => {
      const recent = rows.filter((r) => r.month >= '1996-01');
      const last = latest(rows, 'ssn');
      b.innerHTML = note(`Último mês disponível: ${last ? `${esc(last.month.split('-').reverse().join('/'))}, número de manchas ${fmtNum(last.ssn, 1)}` : '—'}. Ciclos 23, 24 e 25.`) + '<div class="chart"></div>';
      chart($('.chart', b), {
        legend: { show: false }, xAxis: { type: 'category', data: recent.map((r) => r.month), ...AX, axisLabel: { ...AX.axisLabel, interval: 59 } },
        yAxis: valAxis('Manchas'),
        series: [{ name: 'Número de manchas', type: 'line', showSymbol: false, data: recent.map((r) => r.ssn), areaStyle: { color: 'rgba(216,178,90,.12)' }, lineStyle: { color: '#D8B25A' }, itemStyle: { color: '#D8B25A' } }],
      });
    });
  },
});
def('alerts-short', {
  title: 'Alertas recentes de clima espacial', group: 'Clima espacial', sources: ['swpc_alerts'],
  async load(p) {
    fill(p, await api('/api/space-weather/alerts'), 'Alertas', (b, rows) => {
      b.innerHTML = rows.length
        ? `<ul class="note-list" style="color:var(--star);padding-left:16px">${rows.slice(0, 4).map((a) => `<li>${esc(a.title)}<br><small class="reading-note">${fmtDT(a.issued)}</small></li>`).join('')}</ul>
           ${note('<a href="#space-weather">Ver todos os alertas</a> (texto original em inglês).')}`
        : note('A NOAA não tem alertas recentes na lista.');
    });
  },
});
def('alerts-full', {
  title: 'Alertas e avisos NOAA', group: 'Clima espacial', cls: 'span-all', sources: ['swpc_alerts'],
  async load(p) {
    fill(p, await api('/api/space-weather/alerts'), 'Alertas', (b, rows) => {
      if (!rows.length) { b.innerHTML = note('A NOAA não tem alertas recentes na lista.'); return; }
      b.innerHTML = rows.map((a) => `<details class="alert-item"><summary><b>${esc(a.title)}</b> <span class="reading-note">— emitido em ${fmtDT(a.issued)}</span></summary>
        <pre>${esc(a.message)}</pre></details>`).join('') + note('Texto original em inglês, como publicado pela NOAA SWPC.');
    });
  },
});
def('solar-images', {
  title: 'Observatório solar — imagens mais recentes', group: 'Clima espacial', cls: 'span-all', sources: ['solar_imagery'],
  async load(p) {
    fill(p, await api('/api/solar/imagery'), 'Imagens solares', (b, items, env) => {
      const bust = encodeURIComponent(env.fetched_at || '');
      b.innerHTML = `<div class="sun-grid">${items.map((i) => `<figure class="sun-fig">
          ${i.available
            ? `<a href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}?t=${bust}" alt="${esc(i.label)}: ${esc(i.description)}" loading="lazy"></a>`
            : `<div class="unavailable sun-missing"><strong>Indisponível.</strong>${esc(i.error || '')}</div>`}
          <figcaption><b>${esc(i.label)}</b><span>${esc(i.description)}</span>
          <small>${i.updated_at ? `Arquivo atualizado em ${fmtDT(i.updated_at)}` : 'Horário de atualização não informado'}</small></figcaption></figure>`).join('')}</div>` +
        note('Imagens periódicas dos servidores da NASA e da ESA, substituídas a cada poucos minutos — não são vídeo ao vivo. Nunca observe o Sol diretamente sem filtro solar certificado.');
    });
  },
});
def('sun-now', {
  title: 'O Sol agora (SDO/AIA 193 Å)', group: 'Clima espacial', sources: ['solar_imagery'],
  async load(p) {
    fill(p, await api('/api/solar/imagery'), 'Imagem solar', (b, items, env) => {
      const i = items.find((x) => x.id === 'aia193' && x.available) || items.find((x) => x.available);
      b.innerHTML = `<a href="#space-weather"><img class="sun-hero" src="${esc(i.url)}?t=${encodeURIComponent(env.fetched_at || '')}" alt="${esc(i.label)}"></a>` +
        note(`${esc(i.label)} — arquivo atualizado em ${fmtDT(i.updated_at)}. Imagem periódica, não ao vivo.`);
    });
  },
});

// ================================================================== Objetos próximos
const neoQS = () => `days=${state.neo.days}&dist_ld=${state.neo.dist_ld}`;
const diam = (r) => r.diameter_km ?? (r.diameter_range_km ? (r.diameter_range_km[0] + r.diameter_range_km[1]) / 2 : null);
def('neo-next', {
  title: 'Próxima aproximação de asteroide', group: 'Objetos próximos', sources: ['jpl_cad'],
  async load(p) {
    fill(p, await api('/api/neo/close-approaches?days=30&dist_ld=10'), 'Aproximações', (b, rows) => {
      const next = rows.find((r) => new Date(r.approach_utc).getTime() >= Date.now());
      if (!next) { b.innerHTML = note('Nenhuma aproximação prevista a menos de 10 distâncias lunares nos próximos 30 dias.'); return; }
      b.innerHTML = reading(fmtNum(next.dist_ld, 2), 'distâncias lunares') +
        note(`<b>${esc(next.name)}</b> em ${fmtDT(next.approach_utc)} — ${fmtInt(next.dist_km)} km, ${fmtNum(next.v_rel_kms, 1)} km/s. ${rows.length} aproximação(ões) previstas em 30 dias até 10 LD.`);
    });
  },
});
def('neo-chart', {
  title: 'Distância × data', group: 'Objetos próximos', cls: 'span-all', sources: ['jpl_cad'],
  async load(p) {
    fill(p, await api(`/api/neo/close-approaches?${neoQS()}`), 'Aproximações', (b, rows) => {
      if (!rows.length) { b.innerHTML = note('Nenhuma aproximação prevista com esses filtros.'); return; }
      b.innerHTML = '<div class="chart tall"></div>' + note('Tamanho do ponto proporcional ao diâmetro (medido, ou ponto médio da faixa estimada pela magnitude H). Em vermelho, objetos na lista de risco Sentry.');
      chart($('.chart', b), {
        legend: { show: false }, xAxis: timeAxis(), yAxis: valAxis('LD', { min: 0 }),
        tooltip: { trigger: 'item', formatter: (q) => `<b>${esc(q.data.name)}</b><br>${fmtDT(q.data.value[0])}<br>${fmtNum(q.data.value[1], 2)} LD` },
        series: [{
          type: 'scatter', data: rows.map((r) => ({ name: r.name, value: [r.approach_utc, r.dist_ld], d: diam(r), listed: r.sentry?.listed })),
          symbolSize: (v, q) => Math.max(6, Math.min(40, 6 + Math.sqrt((q.data.d || 0.01) * 1000) * 1.2)),
          itemStyle: { color: (q) => (q.data.listed ? '#F26C5F' : '#4FD6EC'), opacity: 0.85 },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: '#D8B25A', type: 'dashed' }, label: { formatter: 'Distância da Lua', color: '#D8B25A' }, data: [{ yAxis: 1 }] },
        }],
      });
    });
  },
});
def('neo-table', {
  title: 'Aproximações previstas', group: 'Objetos próximos', cls: 'span-all', sources: ['jpl_cad', 'jpl_sentry'],
  async load(p) {
    const env = await api(`/api/neo/close-approaches?${neoQS()}`);
    fill(p, env, 'Aproximações', (b, rows) => {
      if (!rows.length) { b.innerHTML = note('Nenhuma aproximação prevista com esses filtros.'); return; }
      const sentryCell = (r) => {
        if (!r.sentry) return '<span class="reading-note">Lista Sentry indisponível</span>';
        if (!r.sentry.listed) return 'Não consta na lista de risco';
        return `<a href="https://cneos.jpl.nasa.gov/sentry/details.html#?des=${encodeURIComponent(r.designation)}" target="_blank" rel="noopener">Na lista Sentry</a><br>
          <small>Torino máx. ${esc(r.sentry.ts_max ?? '—')}; Palermo cum. ${fmtNum(r.sentry.ps_cum, 2)}</small>`;
      };
      const diamCell = (r) => (r.diameter_km != null
        ? `${fmtNum(r.diameter_km * 1000, 0)} m <small class="reading-note">(medido)</small>`
        : r.diameter_range_km ? `${fmtNum(r.diameter_range_km[0] * 1000, 0)}–${fmtNum(r.diameter_range_km[1] * 1000, 0)} m <small class="reading-note">(estimado por H)</small>` : '—');
      b.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Objeto</th><th>Máxima aproximação</th><th class="num">Distância (LD)</th><th class="num">Distância (km)</th>
        <th class="num">Faixa 3σ (LD)</th><th class="num">Vel. rel. (km/s)</th><th>Diâmetro</th><th class="num">H</th><th>Risco (Sentry)</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td><a href="https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(r.designation)}" target="_blank" rel="noopener">${esc(r.name)}</a></td>
          <td>${fmtDT(r.approach_utc)}<br><small class="reading-note">incerteza ${esc(r.time_uncertainty ?? '—')}</small></td>
          <td class="num">${fmtNum(r.dist_ld, 2)}</td><td class="num">${fmtInt(r.dist_km)}</td>
          <td class="num">${r.dist_min_au != null ? `${fmtNum(r.dist_min_au / LD_AU, 2)}–${fmtNum(r.dist_max_au / LD_AU, 2)}` : '—'}</td>
          <td class="num">${fmtNum(r.v_rel_kms, 1)}</td><td>${diamCell(r)}</td><td class="num">${fmtNum(r.h_mag, 1)}</td><td>${sentryCell(r)}</td>
          <td>${favButton('neo', String(r.designation), r.name, { approach_utc: r.approach_utc, dist_ld: r.dist_ld })}</td></tr>`).join('')}
        </tbody></table></div>` + note('Horários em hora local. LD = distância média Terra–Lua (384.399 km). A classificação de risco é a do Sentry/CNEOS.');
    });
  },
});

// ================================================================== Exoplanetas
def('exo-count', {
  title: 'Exoplanetas confirmados', group: 'Exoplanetas', sources: ['exoplanet_archive'],
  async load(p) {
    fill(p, await api('/api/exoplanets/summary'), 'Contagem de exoplanetas', (b, d) => {
      b.innerHTML = reading(fmtInt(d.confirmed), 'confirmados') +
        note(`Mais ${fmtInt(d.tess_candidates_pc)} candidatos do TESS ainda não confirmados (disposição PC). Candidatos não entram na contagem acima.`);
    });
  },
});
def('exo-methods', {
  title: 'Descobertas por método', group: 'Exoplanetas', cls: 'span-2', sources: ['exoplanet_archive'],
  async load(p) {
    fill(p, await api('/api/exoplanets/summary'), 'Métodos', (b, d) => {
      const m = [...d.by_method].reverse();
      b.innerHTML = '<div class="chart"></div>';
      chart($('.chart', b), {
        legend: { show: false }, grid: { left: 190, right: 50, top: 10, bottom: 30 },
        xAxis: valAxis('', { type: 'log' }), yAxis: { type: 'category', data: m.map((r) => r.method), ...AX },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        series: [{ type: 'bar', name: 'Planetas', data: m.map((r) => r.count), itemStyle: { color: '#4FD6EC' }, label: { show: true, position: 'right', color: '#EAF1FF', formatter: (q) => fmtInt(q.value) } }],
      });
    });
  },
});
def('exo-scatter', {
  title: 'Período orbital × raio (planetas confirmados)', group: 'Exoplanetas', cls: 'span-all', sources: ['exoplanet_archive'],
  async load(p) {
    fill(p, await api('/api/exoplanets/points'), 'Pontos', (b, pts) => {
      const counts = {}; pts.forEach((x) => { counts[x.method] = (counts[x.method] || 0) + 1; });
      const top = Object.entries(counts).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k]) => k);
      const colors = ['#4FD6EC', '#D8B25A', '#B993F5', '#46E08F', '#93A5CB'];
      const groups = [...top, 'Outros métodos'];
      b.innerHTML = '<div class="chart tall"></div>' + note(`${fmtInt(pts.length)} planetas com período e raio publicados. Escalas logarítmicas. Raio em raios terrestres (R⊕).`);
      chart($('.chart', b), {
        grid: { left: 60, right: 20, top: 40, bottom: 44 },
        xAxis: valAxis('Período (dias)', { type: 'log', nameLocation: 'middle', nameGap: 28 }), yAxis: valAxis('Raio (R⊕)', { type: 'log' }),
        tooltip: { trigger: 'item', formatter: (q) => `<b>${esc(q.data.n)}</b> (${esc(q.data.m)})<br>Período: ${fmtNum(q.data.value[0], 2)} d<br>Raio: ${fmtNum(q.data.value[1], 2)} R⊕${q.data.t ? `<br>Teq: ${fmtInt(q.data.t)} K` : ''}${q.data.dist ? `<br>Distância: ${fmtNum(q.data.dist, 1)} pc` : ''}` },
        series: groups.map((g, i) => ({
          name: g, type: 'scatter', symbolSize: 4, large: true, itemStyle: { color: colors[i], opacity: 0.7 },
          data: pts.filter((x) => (g === 'Outros métodos' ? !top.includes(x.method) : x.method === g))
            .map((x) => ({ value: [x.period_d, x.radius_re], n: x.name, m: x.method, t: x.teq_k, dist: x.dist_pc })),
        })),
      });
    });
  },
});
def('exo-summary', {
  title: 'Resumo do catálogo de exoplanetas', group: 'Exoplanetas', sources: ['exoplanet_archive'],
  async load(p) {
    fill(p, await api('/api/exoplanets/summary'), 'Resumo', (b, d) => {
      b.innerHTML = `<dl class="kv"><dt>Confirmados</dt><dd><b class="kv-big">${fmtInt(d.confirmed)}</b></dd>
        <dt>Candidatos TESS (PC)</dt><dd>${fmtInt(d.tess_candidates_pc)}</dd><dt>Métodos de descoberta</dt><dd>${d.by_method.length}</dd></dl>` +
        note('Candidatos são objetos de interesse do TESS ainda sem confirmação; não entram na contagem de confirmados. Pesquisa feita com o NASA Exoplanet Archive.');
    });
  },
});

// ================================================================== Imagens
export function apodHTML(d) {
  const media = d.media_type === 'image'
    ? `<a href="${esc(d.hdurl || d.url)}" target="_blank" rel="noopener"><img src="${esc(d.url)}" alt="${esc(d.title)}" loading="lazy"></a>`
    : d.media_type === 'video' && d.url
      ? `<iframe src="${esc(d.url)}" title="${esc(d.title)}" allowfullscreen loading="lazy"></iframe>`
      : note(`Mídia do tipo "${esc(d.media_type)}". <a href="${esc(d.page_url)}" target="_blank" rel="noopener">Abrir na página da APOD</a>.`);
  return `<div class="apod"><div>${media}</div><div>
    <h3>${esc(d.title)}</h3>
    ${note(`Publicada em ${fmtDate(d.date)}${d.copyright ? ` — crédito: ${esc(d.copyright)}` : ' — crédito conforme a página da APOD'}. A APOD é uma seleção diária; a imagem normalmente é de arquivo, não uma observação ao vivo.`)}
    <p class="prose">${esc(d.explanation || '')}</p>
    <p class="row-actions"><a href="${esc(d.page_url)}" target="_blank" rel="noopener">Ver a publicação original</a>
    ${favButton('apod', d.date, d.title, { url: d.thumbnail_url || d.url, media_type: d.media_type, page_url: d.page_url })}</p></div></div>`;
}
def('apod', {
  title: 'Imagem astronômica do dia', group: 'Imagens', cls: 'span-all', sources: ['nasa_apod'],
  async load(p) { fill(p, await api('/api/images/apod'), 'Imagem do dia', (b, d) => { b.innerHTML = apodHTML(d); }); },
});

// ================================================================== Céu (versão compacta para o Mission Control)
def('sky-atlas', {
  title: 'Atlas do céu', group: 'Céu', cls: 'span-2', sources: [],
  async load(p) {
    const id = `${p.id}-aladin`;
    $('.panel-body', p).innerHTML = `<form class="controls sky-mini"><input name="obj" value="M42" aria-label="Objeto" maxlength="80">
      <button class="btn secondary" type="submit">Ir</button><a href="#sky">Mapa completo e visibilidade</a></form>
      <div id="${id}" class="aladin-box"><p class="loading" style="padding:12px">Carregando o atlas</p></div>`;
    $('.panel-plate', p).innerHTML = '';
    let stage = 'load';
    try {
      await loadScript('https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js');
      stage = 'init';
      await window.A.init;
      document.getElementById(id).innerHTML = '';
      const al = window.A.aladin(`#${id}`, { survey: 'P/DSS2/color', fov: 2, target: 'M42', showReticle: true });
      $('form', p).addEventListener('submit', (e) => { e.preventDefault(); al.gotoObject(e.target.obj.value); });
    } catch (err) {
      console.error('[THZ] Aladin', stage, err);
      document.getElementById(id).innerHTML = unavailable({ error: aladinError(stage, err) }, 'Atlas');
    }
  },
});

/** Mensagem que separa falha de download do Aladin de falha ao iniciá-lo (ex.: WebGL2 desligado). */
export function aladinError(stage, err) {
  const detail = err?.message ? ` Detalhe: ${String(err.message).slice(0, 160)}` : '';
  return stage === 'load'
    ? 'Não foi possível baixar o Aladin Lite (aladin.cds.unistra.fr). Verifique a conexão ou se algum bloqueador impede esse endereço.'
    : `O Aladin Lite foi baixado, mas não iniciou neste aparelho/navegador (ele exige WebGL2).${detail}`;
}

// ================================================================== Operação
const HEALTH = {
  operational: ['Operacional', 'badge--live'], degraded: ['Degradada — servindo último dado', 'badge--stale'],
  down: ['Fora do ar', 'badge--fail'], idle: ['Aguardando primeira consulta', 'badge--down'],
};
def('ops-sources', {
  title: 'Fontes conectadas — estado atual', group: 'Operação', cls: 'span-all', sources: [],
  async load(p) {
    const rep = await api('/api/sources');
    const b = $('.panel-body', p);
    if (!rep.sources) { b.innerHTML = unavailable(rep, 'Relatório de fontes'); return; }
    b.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Fonte</th><th>Tipo de dado</th><th>Saúde</th><th>Última sincronização</th>
      <th class="num">Latência</th><th class="num">Sucessos / falhas</th><th class="num">Registros</th><th>Último erro</th></tr></thead><tbody>
      ${rep.sources.map((s) => { const [label, cls] = HEALTH[s.health] || [s.health, '']; return `<tr>
        <td><a href="${esc(s.docs_url)}" target="_blank" rel="noopener">${esc(s.label)}</a><br><small class="reading-note">${esc(s.institution)}</small></td>
        <td><span class="badge badge--${esc(s.content_type)}">${esc(s.content_label)}</span></td>
        <td><span class="badge ${cls}">${esc(label)}</span></td>
        <td>${s.last_success_at ? fmtDT(s.last_success_at) : '—'}</td>
        <td class="num">${s.last_latency_ms != null ? `${fmtInt(s.last_latency_ms)} ms` : '—'}</td>
        <td class="num">${s.ok_count} / ${s.error_count}</td><td class="num">${s.last_items ?? '—'}</td>
        <td><small>${esc(s.last_error || '—')}${s.last_error_at ? ` (${fmtDT(s.last_error_at)})` : ''}</small></td></tr>`; }).join('')}
      </tbody></table></div>` + note(`Estado desde o último reinício do servidor. O histórico persistente está no painel abaixo. Relatório de ${fmtDT(rep.generated_at)}.`);
  },
});
def('ops-history', {
  title: 'Histórico de sincronizações', group: 'Operação', cls: 'span-all', sources: [],
  async load(p) {
    const b = $('.panel-body', p);
    const [sum, sch] = await Promise.all([api('/api/sync-history/summary?hours=24'), api('/api/scheduler')]);
    if (!sum.sources) { b.innerHTML = unavailable(sum, 'Histórico'); return; }
    if (!sum.total_syncs) { b.innerHTML = note('Ainda não há sincronizações registradas nas últimas 24 h. O agendador grava cada consulta às fontes no banco de dados.'); return; }
    b.innerHTML = `<div class="chart" style="height:220px"></div>
      <div class="table-wrap"><table><thead><tr><th>Fonte</th><th class="num">Sincronizações</th><th class="num">Taxa de sucesso</th>
      <th class="num">Latência mediana</th><th class="num">Latência p95</th><th class="num">Registros processados</th><th>Última falha</th></tr></thead><tbody>
      ${sum.sources.map((s) => `<tr><td>${esc(s.source_id)}</td><td class="num">${s.total}</td>
        <td class="num ${s.success_rate < 0.9 ? 'warn-text' : ''}">${fmtNum(s.success_rate * 100, 1)}%</td>
        <td class="num">${s.latency_p50_ms != null ? `${fmtInt(s.latency_p50_ms)} ms` : '—'}</td>
        <td class="num">${s.latency_p95_ms != null ? `${fmtInt(s.latency_p95_ms)} ms` : '—'}</td>
        <td class="num">${fmtInt(s.records_processed)}</td><td>${s.last_failure_at ? fmtDT(s.last_failure_at) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` +
      note(`${fmtInt(sum.total_syncs)} sincronizações nas últimas 24 h. Agendador ${sch.enabled ? `ativo com ${sch.jobs.length} tarefas` : 'desativado (SCHEDULER_ENABLED=false)'}.`);
    chart($('.chart', b), {
      xAxis: timeAxis(), yAxis: valAxis('Sincronizações'),
      tooltip: { formatter: (x) => tooltipTime(x, 0) },
      series: [
        { name: 'Sucesso', type: 'bar', stack: 's', data: sum.hourly.map((h) => [h.hour, h.ok]), itemStyle: { color: '#46E08F' } },
        { name: 'Falha', type: 'bar', stack: 's', data: sum.hourly.map((h) => [h.hour, h.fail]), itemStyle: { color: '#F26C5F' } },
      ],
    });
  },
});
def('ops-legend', {
  title: 'Estados visuais dos dados', group: 'Operação', cls: 'span-all', sources: [],
  async load(p) {
    $('.panel-body', p).innerHTML = `<div class="legend">
      <span class="badge badge--live">Transmissão ao vivo confirmada</span><span class="badge badge--near_real_time">Quase tempo real</span>
      <span class="badge badge--periodic">Atualização periódica</span><span class="badge badge--archive">Arquivo / catálogo / referência</span>
      <span class="badge badge--simulation">Simulação ou cálculo local</span><span class="badge badge--down">Fonte temporariamente indisponível</span>
      <span class="badge badge--stale">Falha de sincronização (último dado)</span></div>` +
      note('Nenhuma fonte integrada até aqui é uma transmissão ao vivo; o selo verde só será usado quando a fonte confirmar transmissão em tempo real.');
  },
});

// ================================================================== Favoritos
def('favorites', {
  title: 'Meus favoritos', group: 'Pesquisa', cls: 'span-all', sources: [],
  async load(p) {
    const r = await loadFavorites();
    const b = $('.panel-body', p);
    if (!r.items) { b.innerHTML = unavailable(r, 'Favoritos'); return; }
    if (!r.items.length) { b.innerHTML = note('Nenhum favorito ainda. Use "Salvar nos favoritos" nas imagens, na imagem do dia, nos objetos do mapa celeste, nos asteroides e nos telescópios.'); return; }
    const kindLabel = { nasa_image: 'Imagem NASA', apod: 'Imagem do dia', sky_object: 'Objeto celeste', neo: 'Asteroide', telescope: 'Telescópio' };
    const link = (f) => ({
      nasa_image: f.data.page_url, apod: f.data.page_url, telescope: f.data.portal,
      sky_object: `#sky?obj=${encodeURIComponent(f.ref)}`,
      neo: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(f.ref)}`,
    }[f.kind]);
    b.innerHTML = `<div class="fav-list">${r.items.map((f) => {
      const href = link(f); const ext = href && !href.startsWith('#');
      const thumb = (f.kind === 'nasa_image' && f.data.preview) || (f.kind === 'apod' && f.data.media_type === 'image' && f.data.url);
      return `<article class="fav-card">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : '<div class="fav-ph" aria-hidden="true"></div>'}
        <div><small>${esc(kindLabel[f.kind] || f.kind)}</small>
        <h3>${href ? `<a href="${esc(href)}" ${ext ? 'target="_blank" rel="noopener"' : ''}>${esc(f.title)}</a>` : esc(f.title)}</h3>
        <small>Salvo em ${fmtDT(f.created_at)}</small>
        ${favButton(f.kind, f.ref, f.title, f.data)}</div></article>`;
    }).join('')}</div>`;
  },
});
