// Monta a pasta www/ que o Capacitor empacota no app:
//  1) copia a interface (src/);  2) embute o ECharts e as fontes;  3) empacota a ponte nativa (native/bridge.js).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');
const nm = join(root, 'node_modules');
const need = (p, what) => { if (!existsSync(p)) { console.error(`\n✗ Não encontrei ${what}:\n  ${p}\n  Rode "npm install" na pasta do projeto.\n`); process.exit(1); } return p; };

rmSync(www, { recursive: true, force: true });
mkdirSync(join(www, 'vendor', 'fonts'), { recursive: true });

// 1) interface
cpSync(join(root, 'src'), www, { recursive: true });

// 2a) ECharts (mesma versão do site: 5.5.1)
cpSync(need(join(nm, 'echarts', 'dist', 'echarts.min.js'), 'o ECharts'), join(www, 'vendor', 'echarts.min.js'));

// 2b) fontes (subconjuntos latin + latin-ext, suficientes para português)
const FONTS = [
  { pkg: '@fontsource/ibm-plex-sans', id: 'ibm-plex-sans', family: 'IBM Plex Sans', faces: [[400, 'normal'], [500, 'normal'], [600, 'normal'], [400, 'italic']] },
  { pkg: '@fontsource/saira-semi-condensed', id: 'saira-semi-condensed', family: 'Saira Semi Condensed', faces: [[500, 'normal'], [600, 'normal'], [700, 'normal']] },
];
const RANGES = {
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
};
let css = '/* Fontes embutidas no app (Fontsource, licença SIL OFL 1.1). */\n';
let missing = 0;
for (const f of FONTS) {
  for (const [weight, style] of f.faces) {
    for (const subset of ['latin-ext', 'latin']) {
      const file = `${f.id}-${subset}-${weight}-${style}.woff2`;
      const src = join(nm, f.pkg, 'files', file);
      if (!existsSync(src)) { missing += 1; continue; }
      cpSync(src, join(www, 'vendor', 'fonts', file));
      css += `@font-face{font-family:'${f.family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(./${file}) format('woff2');unicode-range:${RANGES[subset]};}\n`;
    }
  }
}
writeFileSync(join(www, 'vendor', 'fonts', 'fonts.css'), css);
if (missing) console.warn(`! ${missing} arquivo(s) de fonte não encontrados; o app usa as fontes do sistema nesses casos.`);

// 3) ponte nativa (Capacitor + plugins) em um único script clássico
need(join(nm, '@capacitor', 'core'), 'o @capacitor/core');
await build({
  entryPoints: [join(root, 'native', 'bridge.js')],
  outfile: join(www, 'vendor', 'native.js'),
  bundle: true, format: 'iife', minify: true, target: ['chrome89'], legalComments: 'none', logLevel: 'warning',
});

const kb = (p) => `${Math.round(statSync(p).size / 1024)} KB`;
console.log(`✓ www/ pronta — native.js ${kb(join(www, 'vendor', 'native.js'))}, echarts ${kb(join(www, 'vendor', 'echarts.min.js'))}`);
