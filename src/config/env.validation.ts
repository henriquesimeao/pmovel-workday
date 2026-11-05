import * as Joi from 'joi';

/**
 * Schema de validação das variáveis de ambiente.
 *
 * É aplicado no boot pelo ConfigModule (ver AppModule). Se uma variável
 * obrigatória estiver ausente ou com formato inválido, a aplicação recusa
 * subir, falhando de forma explícita em vez de quebrar em runtime.
 *
 * Os nomes das variáveis do Workday seguem o padrão do código de referência
 * (src/config.js) para reaproveitar o .env já existente do tenant de dev.
 */
export const envValidationSchema = Joi.object({
  // Ambiente de execução
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  // --- Workday (origem na Fase 1) ---
  WorkdayTenant: Joi.string().required(),
  WorkdayTenantUrl: Joi.string().uri().required(),
  // Opcional: host dos serviços, quando não segue o padrão <prefixo>-services1.<resto>
  WorkdayServicesUrl: Joi.string().uri().optional(),
  WorkdayClientId: Joi.string().required(),
  WorkdayClientSecret: Joi.string().required(),
  WorkdayRefreshToken: Joi.string().required(),

  // --- Pmovel (destino na Fase 1) ---
  PmovelBaseUrl: Joi.string().uri().required(),
  PmovelAccessKeyId: Joi.string().required(),
  PmovelSecretAccessKey: Joi.string().required(),

  // --- Banco de dados (MySQL) ---
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(3306),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),

  // --- Sincronização ---
  // Cron do disparo agendado (ver @nestjs/schedule). Default: a cada hora.
  SYNC_CRON: Joi.string().default('0 * * * *'),
  // Liga/desliga o disparo agendado sem mexer em código.
  SYNC_SCHEDULE_ENABLED: Joi.boolean().default(false),
})
  // Variáveis extras do .env de referência (ex.: WorkdayUser) são toleradas.
  .unknown(true);
