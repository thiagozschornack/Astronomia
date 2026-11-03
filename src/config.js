// Configuração do app Android do EmpreenderTHZ Astronomy Center.
// O app roda a interface a partir do próprio aparelho (https://localhost) e busca os dados na API publicada.
window.THZ_CONFIG = {
  // Endereço público da API (Setup Python App do cPanel). Sem barra no final.
  apiBase: 'https://empreenderthz.com.br/astroapi',
  // Pasta do site web, de onde o app carrega o logotipo (brand/logo.svg) quando a API indica "/brand/...".
  siteBase: 'https://empreenderthz.com.br/Astronomia',
  // Atualização em tempo real por SSE (/api/stream). Use false se a hospedagem não mantiver conexões longas;
  // nesse caso os painéis são recarregados a cada 10 minutos e sempre que o app volta para a frente.
  stream: true,
};
