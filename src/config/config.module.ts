import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envValidationSchema } from './env.validation';
import { AppConfigService } from './app-config.service';

/**
 * Módulo de configuração global.
 *
 * - Valida o ambiente no boot com o envValidationSchema (fail-fast).
 * - Expõe o AppConfigService (fachada tipada) para toda a aplicação.
 *
 * As variáveis são carregadas via `node --env-file=.env` (scripts npm) ou pelo
 * ambiente do processo; por isso `ignoreEnvFile: true` — não usamos o leitor de
 * .env do próprio ConfigModule, mantendo coerência com o código de referência.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
