import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

/**
 * Bootstrap da aplicação NestJS.
 *
 * A validação do ambiente acontece durante a criação do módulo (ConfigModule
 * com validationSchema): se o .env estiver incompleto, `NestFactory.create`
 * lança antes de o servidor subir.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  // SIGTERM/SIGINT disparam os hooks de desligamento: o orquestrador espera a
  // run em andamento terminar antes de encerrar.
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  const port = config.port;

  await app.listen(port);
  logger.log(`Aplicação ouvindo na porta ${port} (env: ${config.nodeEnv})`);
}

void bootstrap();
