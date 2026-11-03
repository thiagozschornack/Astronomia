// Ajusta o projeto nativo gerado por "npx cap add android" (pode rodar quantas vezes quiser):
//  - permissões (internet, localização sob demanda, notificações);
//  - ícone do app, ícone de notificação e telas de abertura da marca;
//  - cor de fundo da abertura no Android 12+;
//  - versão (versionCode / versionName) a partir do package.json;
//  - assinatura de release lendo android/keystore.properties, se existir.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'android', 'app');
if (!existsSync(app)) { console.error('✗ Pasta android/ não existe. Rode primeiro: npm run android:add'); process.exit(1); }
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const edit = (file, fn) => { const p = join(app, file); if (!existsSync(p)) { console.warn(`! ${file} não encontrado; ajuste manual necessário.`); return false; } const before = readFileSync(p, 'utf8'); const after = fn(before); if (after !== before) writeFileSync(p, after); return after !== before; };
const log = [];

// 1) permissões
edit('src/main/AndroidManifest.xml', (s) => {
  const perms = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
  ];
  for (const p of perms) {
    if (!s.includes(`"${p}"`)) { s = s.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`); log.push(`permissão ${p.split('.').pop()}`); }
  }
  // localização não é obrigatória: o app funciona em aparelhos sem GPS
  if (!s.includes('android.hardware.location.gps')) s = s.replace('</manifest>', '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>');
  return s;
});

// 2) ícones e telas de abertura
cpSync(join(root, 'resources', 'android', 'res'), join(app, 'src', 'main', 'res'), { recursive: true });
log.push('ícones, ícone de notificação e telas de abertura');

// 3) abertura no Android 12+: fundo da marca
edit('src/main/res/values/styles.xml', (s) => {
  if (s.includes('windowSplashScreenBackground')) return s;
  return s.replace(/(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)/, '$1\n        <item name="windowSplashScreenBackground">@color/thz_abyss</item>\n        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>');
});

// 4) versão
const [maj, min, pat] = pkg.version.split('.').map(Number);
const versionCode = maj * 10000 + min * 100 + pat; // 0.3.0 → 300
edit('build.gradle', (s) => s
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${pkg.version}"`));
log.push(`versão ${pkg.version} (code ${versionCode})`);

// 5) assinatura de release (opcional): android/keystore.properties
edit('build.gradle', (s) => {
  if (s.includes('THZ_SIGNING')) return s;
  const block = `
// THZ_SIGNING — assinatura de release lida de android/keystore.properties (não versionar)
def thzKeyFile = rootProject.file('keystore.properties')
def thzKeys = new Properties()
if (thzKeyFile.exists()) { thzKeys.load(new FileInputStream(thzKeyFile)) }
android {
    signingConfigs {
        if (thzKeyFile.exists()) {
            release {
                storeFile file(thzKeys['storeFile'])
                storePassword thzKeys['storePassword']
                keyAlias thzKeys['keyAlias']
                keyPassword thzKeys['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            if (thzKeyFile.exists()) { signingConfig signingConfigs.release }
        }
    }
}
`;
  return s + block;
});

console.log(`✓ Projeto Android ajustado: ${log.join('; ')}.`);
