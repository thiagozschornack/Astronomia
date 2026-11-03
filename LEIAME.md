# EmpreenderTHZ Astronomy Center — app Android (Etapa 3)

App Android feito com **Capacitor 8** a partir da interface web da Etapa 3. A interface roda dentro do app
(abre rápido e não depende da hospedagem para carregar telas); os dados continuam vindo da API em
`https://empreenderthz.com.br/astroapi`.

## O que muda em relação ao site

| Recurso | Site | App Android |
|---|---|---|
| Navegação | barra lateral | barra de atalhos inferior (Painel, Sol, Sistema, Eventos, Mais) + menu lateral deslizante |
| Botão voltar | — | fecha diálogo → sai do painel ampliado → fecha o menu → volta a tela → minimiza o app |
| Alertas de eventos | só com o site aberto | **notificações nativas, mesmo com o app fechado** (próximos 30 dias, renovadas a cada abertura) |
| Lembrete de um evento | arquivo .ics | botão **"Lembrar no celular"** em cada evento (o .ics continua disponível) |
| Tela cheia de painel | API de tela cheia do navegador | painel ampliado em tela inteira (sai com o voltar) |
| Links para NASA, JPL, CDS… | nova aba | abrem no navegador do celular (Custom Tabs), sem sair do app |
| Gráficos e fontes | CDN / Google Fonts | embutidos no app |
| Sem internet | — | aviso no topo; os painéis recarregam sozinhos quando a conexão volta |
| Voltar ao app | — | fontes, painéis e agenda de notificações são atualizados |
| Mission Control | várias janelas | uma tela por vez (abas); botões de "nova janela" ocultos |
| Tablet na horizontal | — | menu fixo à esquerda, como no site |

Arquivos alterados da interface: `index.html`, `app.js`, `config.js`, `js/core.js` (tempo-limite de 25 s nas consultas),
`js/explore.js` (notificações), `js/views.js` (copiar código, privacidade). Novos: `android.css` e `native/bridge.js`.

## 1. Ajuste na API (obrigatório)

O app faz as consultas a partir da origem `https://localhost`, então a API precisa liberá-la (CORS).
O pacote `astroapi-etapa3-android.zip` traz o `app/config.py` já ajustado: ele libera automaticamente
`https://localhost` e `capacitor://localhost`, somados ao que estiver em `CORS_ORIGINS`.

1. No cPanel, substitua a pasta `app/` da API pelos arquivos do zip (só `config.py` e o comentário de `main.py` mudaram).
2. Em **Setup Python App → astroapi → Restart**.
3. Teste no celular ou no computador: `https://empreenderthz.com.br/astroapi/api/health` deve responder `"status": "ok"`.

Se a hospedagem não segurar a conexão longa de tempo real (`/api/stream`), mude `stream: false` em `src/config.js`:
os painéis passam a recarregar a cada 10 minutos e sempre que o app volta para a frente.

## 2. Preparar o computador

- **Node.js 22** ou mais novo
- **Android Studio Otter (2025.2.1)** ou mais novo, com Android SDK 36
- (Opcional) um celular com **Depuração USB** ligada

## 3. Gerar o projeto Android

Na pasta do projeto:

```bash
npm install
npm run android:add      # cria a pasta android/ e aplica ícones, permissões e versão
npm run android:open     # abre no Android Studio
```

No Android Studio, espere o Gradle sincronizar e clique em **Run ▶** com o celular conectado.

Depois de mudar qualquer coisa em `src/`, rode `npm run android:sync` (e **Run ▶** de novo).
Para ver a interface no navegador do computador: `npm run serve` → `http://localhost:8100`
(para ter dados, inclua `http://localhost:8100` em `CORS_ORIGINS` da API).

## 4. Gerar o arquivo para a Google Play (.aab assinado)

1. Crie a chave de assinatura (uma vez só — **guarde o arquivo e as senhas; sem eles não há como atualizar o app**):
   ```bash
   keytool -genkey -v -keystore astronomy-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias astronomy
   ```
2. Copie `astronomy-release.jks` para `android/app/` e crie `android/keystore.properties`:
   ```properties
   storeFile=astronomy-release.jks
   storePassword=SUA_SENHA
   keyAlias=astronomy
   keyPassword=SUA_SENHA
   ```
3. `npm run android:sync`, depois no Android Studio: **Build → Generate Signed App Bundle or APK → Android App Bundle → release**
   (ou na pasta `android/`: `./gradlew bundleRelease`). O arquivo sai em `android/app/build/outputs/bundle/release/app-release.aab`.

Para cada nova versão, aumente `"version"` no `package.json` (ex.: `0.3.1`) e rode `npm run android:sync`:
o `versionCode` é calculado sozinho (0.3.1 → 301).

## 4b. Compilar pelo GitHub (sem Android Studio)

O projeto traz `.github/workflows/android.yml`. Depois de enviar a pasta para um repositório no GitHub:

- **A cada push na `main`:** a aba **Actions** gera um **APK de teste**. Abra a execução, baixe o artefato
  `astronomy-center-debug-apk`, descompacte e instale no celular (permita "instalar apps desconhecidos").
- **Para a Google Play:** cadastre os segredos em **Settings → Secrets and variables → Actions**:
  - `ANDROID_KEYSTORE_BASE64`: o arquivo `.jks` em base64 (`base64 -w0 astronomy-release.jks` no Linux/macOS;
    no Windows/PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("astronomy-release.jks"))`)
  - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (ex.: `astronomy`) e `ANDROID_KEY_PASSWORD`

  Depois crie uma tag (`git tag v0.3.0 && git push --tags`) ou rode o workflow manualmente marcando "release".
  O artefato `astronomy-center-release` traz o `.aab` para enviar à Play Console.
- A chave `.jks` e o `keystore.properties` **nunca** vão para o repositório (estão no `.gitignore`).
- A pasta `android/` pode ou não ser enviada: se não estiver no repositório, o workflow a gera a cada compilação.

## 5. Ficha da Play Store

Em `assets/` estão prontos: ícone 512×512 (`play-store-icon-512.png`), arte de destaque 1024×500
(`play-feature-graphic-1024x500.png`) e o ícone em 1024 px. Capturas de tela: tire no próprio celular.

- **ID do app:** `br.com.empreenderthz.astronomy` (definitivo depois da primeira publicação — troque antes, em `capacitor.config.json`, se quiser outro)
- **Nome na tela do celular:** Astronomy Center
- **Política de privacidade:** o Google exige um endereço público. Use a tela de privacidade do site
  (`https://empreenderthz.com.br/Astronomia/#privacy`) — o texto do app já cita localização sob demanda e notificações locais.
- **Segurança dos dados (Data safety):** o app não coleta dados pessoais identificáveis; a localização aproximada/exata é usada
  só quando a pessoa toca em "Usar minha localização", enviada para um cálculo e não armazenada; o código do espaço de trabalho é aleatório.
- **Permissões:** internet, estado da rede, localização (só sob demanda) e notificações (pedida ao ativar alertas).
- **Classificação de conteúdo:** livre; categoria sugerida **Educação**.

## Observações

- As notificações usam alarmes inexatos do Android (não pedem a permissão especial de "alarmes exatos", que a Play restringe):
  com o celular em economia de bateria, um aviso pode chegar alguns minutos depois do horário escolhido.
- O mapa celeste (Aladin Lite) e as imagens da NASA/ESA são carregados da internet, como no site.
- O logotipo é buscado em `https://empreenderthz.com.br/Astronomia/brand/logo.svg`; se não existir, aparece a marca desenhada.

## Estrutura

```
src/              interface (cópia adaptada da Etapa 3)
native/bridge.js  ponte com o Android: voltar, notificações, links externos, rede, área de transferência
scripts/          build.mjs (monta www/), android-setup.mjs (ajusta android/), serve.mjs (pré-visualização)
resources/        ícones, ícone de notificação e telas de abertura (copiados para android/ pelo setup)
assets/           artes para a Play Store
```
