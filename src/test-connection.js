// Teste de conectividade com a REST API do Workday (OAuth 2.0 refresh_token).
import { config, endpoints } from './config.js';
import { getAccessToken, get } from './workday-rest.js';

const results = {};

console.log('=== 1) OAuth 2.0 — token (grant_type=refresh_token) ===');
console.log(`POST ${endpoints.token}`);
try {
  await getAccessToken();
  console.log('OK — access token obtido');
  results.oauth = true;
} catch (e) {
  console.log(e.message);
  results.oauth = false;
}

if (results.oauth) {
  // Tenta a API "common" atual e, se não existir no tenant, o caminho legado.
  const candidates = ['common/v1/{tenant}/workers', 'v1/{tenant}/workers'];
  for (const path of candidates) {
    console.log(`\n=== 2) REST — GET /ccx/api/${path.replace('{tenant}', config.tenant)}?limit=3 ===`);
    try {
      const json = await get(path, { limit: 3 });
      console.log(`OK — total: ${json.total ?? '?'}; amostra: ${(json.data ?? []).map((w) => w.descriptor).join(' | ') || '(vazio)'}`);
      results.workers = path;
      break;
    } catch (e) {
      console.log(e.message);
      results.workers = false;
    }
  }
}

console.log('\n=== Resumo ===');
console.table(results);
process.exitCode = results.oauth && results.workers ? 0 : 1;
