// Lê e valida as variáveis do .env (carregado via `node --env-file=.env`).
const required = ['WorkdayTenant', 'WorkdayTenantUrl', 'WorkdayClientId', 'WorkdayClientSecret', 'WorkdayRefreshToken'];

const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  const hint = missing.includes('WorkdayRefreshToken')
    ? '\nGere o refresh token no tenant: View API Clients > API Clients for Integrations > Manage Refresh Tokens for Integrations.'
    : '';
  throw new Error(`Variáveis ausentes no .env: ${missing.join(', ')}${hint}`);
}

const tenantUrl = new URL(process.env.WorkdayTenantUrl);
// O host da UI (ex.: odpimpl.wd119.myworkday.com) não expõe /ccx; os serviços ficam em <prefixo>-services1.<resto>.
const servicesHost = process.env.WorkdayServicesUrl
  ? new URL(process.env.WorkdayServicesUrl).origin
  : `https://${tenantUrl.hostname.replace(/^([^.]+)\./, '$1-services1.')}`;

export const config = {
  tenant: process.env.WorkdayTenant,
  host: servicesHost, // ex.: https://odpimpl-services1.wd119.myworkday.com
  clientId: process.env.WorkdayClientId,
  clientSecret: process.env.WorkdayClientSecret,
  refreshToken: process.env.WorkdayRefreshToken,
};

export const endpoints = {
  token: `${config.host}/ccx/oauth2/${config.tenant}/token`,
  // path relativo a /ccx/api/, com {tenant} substituído. Ex.: 'common/v1/{tenant}/workers'
  rest: (path) => `${config.host}/ccx/api/${path.replace('{tenant}', config.tenant)}`,
};
