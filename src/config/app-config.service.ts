import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Configuração do cliente Workday.
 * `servicesHost` é derivado em runtime pelo WorkdayClient (host da UI -> -services1),
 * seguindo a lógica do src/config.js de referência.
 */
export interface WorkdayConfig {
  tenant: string;
  tenantUrl: string;
  servicesUrl?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface PmovelConfig {
  baseUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface SyncConfig {
  cron: string;
  scheduleEnabled: boolean;
}

/**
 * Fachada tipada sobre o ConfigService.
 *
 * Centraliza a leitura das variáveis de ambiente em getters coesos, para que o
 * resto da aplicação nunca toque em `process.env` diretamente. Como o
 * envValidationSchema já garante presença/formato no boot, os getters podem
 * assumir que as variáveis obrigatórias existem.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }

  get port(): number {
    return this.config.get<number>('PORT', 3000);
  }

  get workday(): WorkdayConfig {
    return {
      tenant: this.require('WorkdayTenant'),
      tenantUrl: this.require('WorkdayTenantUrl'),
      servicesUrl: this.config.get<string>('WorkdayServicesUrl'),
      clientId: this.require('WorkdayClientId'),
      clientSecret: this.require('WorkdayClientSecret'),
      refreshToken: this.require('WorkdayRefreshToken'),
    };
  }

  get pmovel(): PmovelConfig {
    return {
      baseUrl: this.require('PmovelBaseUrl'),
      accessKeyId: this.require('PmovelAccessKeyId'),
      secretAccessKey: this.require('PmovelSecretAccessKey'),
    };
  }

  get database(): DatabaseConfig {
    return {
      host: this.config.get<string>('DB_HOST', 'localhost'),
      port: this.config.get<number>('DB_PORT', 3306),
      user: this.require('DB_USER'),
      password: this.config.get<string>('DB_PASSWORD', ''),
      name: this.require('DB_NAME'),
    };
  }

  get sync(): SyncConfig {
    return {
      cron: this.config.get<string>('SYNC_CRON', '0 * * * *'),
      scheduleEnabled: this.config.get<boolean>('SYNC_SCHEDULE_ENABLED', false),
    };
  }

  /**
   * Lê uma variável garantidamente presente (validada no boot pelo Joi).
   * Lança se, por algum motivo, estiver ausente — fail-fast.
   */
  private require(key: string): string {
    const value = this.config.get<string>(key);
    if (value === undefined || value === null) {
      throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
    }
    return value;
  }
}
