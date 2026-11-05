import { envValidationSchema } from './env.validation';

/**
 * Conjunto mínimo de variáveis obrigatórias para o schema passar.
 * Valores fictícios — nenhum segredo real.
 */
const validEnv = {
  WorkdayTenant: 'tenant_dev',
  WorkdayTenantUrl: 'https://example.wd119.myworkday.com/tenant_dev',
  WorkdayClientId: 'client-id',
  WorkdayClientSecret: 'client-secret',
  WorkdayRefreshToken: 'refresh-token',
  PmovelBaseUrl: 'https://tools.pmovel.com.br',
  PmovelAccessKeyId: 'access-key',
  PmovelSecretAccessKey: 'secret-key',
  DB_USER: 'root',
  DB_PASSWORD: '',
  DB_NAME: 'integration',
};

describe('envValidationSchema', () => {
  it('valida um ambiente completo e aplica os defaults', () => {
    const { error, value } = envValidationSchema.validate(validEnv);

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3000);
    expect(value.DB_PORT).toBe(3306);
    expect(value.SYNC_CRON).toBe('0 * * * *');
    expect(value.SYNC_SCHEDULE_ENABLED).toBe(false);
  });

  it.each([
    'WorkdayTenant',
    'WorkdayClientId',
    'WorkdayClientSecret',
    'WorkdayRefreshToken',
    'PmovelBaseUrl',
    'PmovelAccessKeyId',
    'PmovelSecretAccessKey',
    'DB_USER',
    'DB_NAME',
  ])('falha quando a variável obrigatória %s está ausente', (missingKey) => {
    const env = { ...validEnv };
    delete (env as Record<string, unknown>)[missingKey];

    const { error } = envValidationSchema.validate(env, { abortEarly: false });

    expect(error).toBeDefined();
    expect(error?.message).toContain(missingKey);
  });

  it('aceita DB_PASSWORD vazio (bancos locais sem senha)', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      DB_PASSWORD: '',
    });

    expect(error).toBeUndefined();
  });

  it('rejeita WorkdayTenantUrl que não seja URL', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      WorkdayTenantUrl: 'nao-e-url',
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('WorkdayTenantUrl');
  });

  it('tolera variáveis extras do .env de referência (ex.: WorkdayUser)', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      WorkdayUser: 'lmcneil',
      WorkdayDevAccount: 'dev@example.com',
    });

    expect(error).toBeUndefined();
  });
});
