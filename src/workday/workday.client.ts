import { Injectable } from '@nestjs/common';
import { BaseRestClient, AccessToken } from '../common/http/base-rest-client';
import { AppConfigService } from '../config/app-config.service';
import { RestClientError } from '../common/http/rest-client.error';
import {
  WorkerSummary,
  WorkerDetail,
  WorkdayCollection,
} from './workday.types';

/**
 * Cliente da REST API do Workday (OAuth 2.0 via refresh_token).
 *
 * Porta para TypeScript a lógica do `src/config.js` + `src/workday-rest.js`
 * de referência:
 *
 * - O host da UI (ex.: odpimpl.wd119.myworkday.com) não expõe `/ccx`; os
 *   serviços ficam em `<prefixo>-services1.<resto>`. A conversão é feita em
 *   `resolveServicesHost`, salvo `WorkdayServicesUrl` explícito no .env.
 * - Token obtido via `grant_type=refresh_token` com Basic auth
 *   (clientId:clientSecret). O cache/retry em 401 vêm do BaseRestClient.
 * - Paths REST são relativos a `/ccx/api/`, com `{tenant}` substituído.
 */
@Injectable()
export class WorkdayClient extends BaseRestClient {
  private readonly tenant: string;
  private readonly servicesHost: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;

  constructor(appConfig: AppConfigService) {
    const wd = appConfig.workday;
    const servicesHost = WorkdayClient.resolveServicesHost(wd.tenantUrl, wd.servicesUrl);
    // baseUrl = raiz dos serviços; paths REST adicionam /ccx/api/...
    super(servicesHost, 'WorkdayClient');
    this.tenant = wd.tenant;
    this.servicesHost = servicesHost;
    this.clientId = wd.clientId;
    this.clientSecret = wd.clientSecret;
    this.refreshToken = wd.refreshToken;
  }

  /**
   * Converte o host da UI para o host dos serviços.
   * Ex.: https://odpimpl.wd119.myworkday.com -> https://odpimpl-services1.wd119.myworkday.com
   * Se `servicesUrl` for informado, usa a origem dele diretamente.
   */
  static resolveServicesHost(tenantUrl: string, servicesUrl?: string): string {
    if (servicesUrl) {
      return new URL(servicesUrl).origin;
    }
    const host = new URL(tenantUrl).hostname.replace(/^([^.]+)\./, '$1-services1.');
    return `https://${host}`;
  }

  /** Endpoint de token (OAuth 2.0). */
  private get tokenEndpoint(): string {
    return `${this.servicesHost}/ccx/oauth2/${this.tenant}/token`;
  }

  /**
   * Resolve um path REST relativo a `/ccx/api/`, substituindo `{tenant}`.
   * Ex.: 'common/v1/{tenant}/workers' -> https://.../ccx/api/common/v1/<tenant>/workers
   */
  protected override resolveUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    const rel = path.replace('{tenant}', this.tenant).replace(/^\/+/, '');
    return `${this.servicesHost}/ccx/api/${rel}`;
  }

  /**
   * Obtém o access token via refresh_token (Basic auth com clientId:secret).
   * Não usa o helper `request` do BaseRestClient porque o endpoint de token
   * tem content-type e autenticação próprios (não é Bearer).
   */
  protected async fetchToken(): Promise<AccessToken> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new RestClientError(
        `Falha ao obter token Workday (HTTP ${res.status})`,
        res.status,
        text,
      );
    }

    const json = JSON.parse(text) as { access_token: string; expires_in?: number };
    const ttl = Number(json.expires_in ?? 3600);
    return {
      token: json.access_token,
      // margem de segurança: renova 60s antes (mínimo 30s de validade)
      expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000,
    };
  }

  /**
   * Itera todos os workers (forma enxuta) via common/v1, paginado.
   * Para dados ricos, use `getWorkerDetail` / `getWorkerSubresource`.
   */
  listWorkers(pageSize = 100): AsyncGenerator<WorkerSummary> {
    return this.paginateOffset<WorkerSummary>('common/v1/{tenant}/workers', {}, pageSize);
  }

  /** Busca uma página única de workers (útil para testes/diagnóstico). */
  getWorkersPage(limit = 3, offset = 0): Promise<WorkdayCollection<WorkerSummary>> {
    return this.get<WorkdayCollection<WorkerSummary>>('common/v1/{tenant}/workers', {
      limit,
      offset,
    });
  }

  /** Detalhe de um worker pela coleção common/v1. */
  getWorker(id: string): Promise<WorkerDetail> {
    return this.get<WorkerDetail>(`common/v1/{tenant}/workers/${id}`);
  }

  /**
   * Chamada genérica a sub-recursos/expansões do worker
   * (ex.: Staffing v6, dados pessoais). Usada na descoberta (Task 4) e pelos
   * mapeadores que precisam de dados além do recurso base.
   *
   * @param path path REST completo relativo a /ccx/api/ (com {tenant})
   * @param params query params (ex.: expand, limit, offset)
   */
  getResource<T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.get<T>(path, params);
  }

  /** Itera uma coleção arbitrária com paginação offset. */
  paginateResource<T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    pageSize = 100,
  ): AsyncGenerator<T> {
    return this.paginateOffset<T>(path, params, pageSize);
  }
}
