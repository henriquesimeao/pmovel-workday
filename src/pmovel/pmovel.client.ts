import { Injectable } from '@nestjs/common';
import { BaseRestClient, AccessToken } from '../common/http/base-rest-client';
import { AppConfigService } from '../config/app-config.service';
import { RestClientError } from '../common/http/rest-client.error';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  FireEmployeeId,
  RehireEmployeeId,
  EmployeeResponse,
  LoginOkResponseDto,
  ListEmployeesParams,
} from './pmovel.types';

/**
 * Cliente da API Pmovel v3.
 *
 * Autenticação: `POST /v3/auth/login` com `{ access_key_id, secret_access_key }`
 * retorna um JWT (`access_token`), usado como Bearer nas demais chamadas. O
 * cache/retry em 401 vêm do BaseRestClient; aqui só implementamos a obtenção do
 * token (fetchToken) e os métodos de Employees (Fase 1).
 */
@Injectable()
export class PmovelClient extends BaseRestClient {
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(appConfig: AppConfigService) {
    const pmovel = appConfig.pmovel;
    super(pmovel.baseUrl, 'PmovelClient');
    this.accessKeyId = pmovel.accessKeyId;
    this.secretAccessKey = pmovel.secretAccessKey;
  }

  /**
   * Faz login e devolve o JWT com expiração.
   * A rota de login não é autenticada, então não usa o helper `request`.
   * A validade é extraída do claim `exp` do JWT (se presente); caso contrário,
   * assume 1h. Em ambos os casos aplica margem de 60s.
   */
  protected async fetchToken(): Promise<AccessToken> {
    const res = await fetch(this.resolveUrl('/v3/auth/login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        access_key_id: this.accessKeyId,
        secret_access_key: this.secretAccessKey,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new RestClientError(
        `Falha no login Pmovel (HTTP ${res.status})`,
        res.status,
        text,
      );
    }

    const json = JSON.parse(text) as LoginOkResponseDto;
    return {
      token: json.access_token,
      expiresAt: PmovelClient.computeExpiry(json.access_token),
    };
  }

  /**
   * Calcula o instante de expiração a partir do claim `exp` do JWT.
   * Fallback: 1h. Margem de segurança: 60s (mínimo 30s de validade).
   */
  static computeExpiry(jwt: string): number {
    const fallbackTtl = 3600;
    let ttlSeconds = fallbackTtl;

    try {
      const payload = jwt.split('.')[1];
      if (payload) {
        const decoded = JSON.parse(
          Buffer.from(payload, 'base64url').toString('utf8'),
        ) as { exp?: number; iat?: number };
        if (decoded.exp) {
          const now = Math.floor(Date.now() / 1000);
          ttlSeconds = Math.max(decoded.exp - now, 0);
        }
      }
    } catch {
      // JWT não decodificável → usa fallback
    }

    return Date.now() + Math.max(ttlSeconds - 60, 30) * 1000;
  }

  // --- Employees (Fase 1) ---

  /** POST /v3/employees. Lança RestClientError em erro (ex.: já existe). */
  createEmployee(dto: CreateEmployeeDto): Promise<EmployeeResponse> {
    return this.post<EmployeeResponse>('/v3/employees', dto);
  }

  /** PUT /v3/employees/external_id/{external_id}. */
  updateEmployeeByExternalId(
    externalId: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponse> {
    return this.put<EmployeeResponse>(
      `/v3/employees/external_id/${encodeURIComponent(externalId)}`,
      dto,
    );
  }

  /** POST /v3/employees/inactivate/external_id/{external_id} (demissão). */
  inactivateEmployeeByExternalId(
    externalId: string,
    dto: FireEmployeeId,
  ): Promise<void> {
    return this.post<void>(
      `/v3/employees/inactivate/external_id/${encodeURIComponent(externalId)}`,
      dto,
    );
  }

  /** POST /v3/employees/reactivate/external_id/{external_id} (readmissão). */
  reactivateEmployeeByExternalId(
    externalId: string,
    dto: RehireEmployeeId,
  ): Promise<void> {
    return this.post<void>(
      `/v3/employees/reactivate/external_id/${encodeURIComponent(externalId)}`,
      dto,
    );
  }

  /**
   * GET /v3/employees/external_id/{external_id}.
   * Retorna `null` em 404 (não encontrado), em vez de lançar — útil para a
   * decisão de upsert na Fase 1.
   */
  async getEmployeeByExternalId(
    externalId: string,
  ): Promise<EmployeeResponse | null> {
    try {
      return await this.get<EmployeeResponse>(
        `/v3/employees/external_id/${encodeURIComponent(externalId)}`,
      );
    } catch (e) {
      if (e instanceof RestClientError && e.status === 404) {
        return null;
      }
      throw e;
    }
  }

  /**
   * GET /v3/employees (paginado por page/limit).
   * A API responde 404 ("Employees not found") quando não há colaboradores no
   * escopo da credencial; tratamos como lista vazia, não como erro.
   */
  async listEmployees(
    params: ListEmployeesParams = {},
  ): Promise<EmployeeResponse[]> {
    try {
      return await this.get<EmployeeResponse[]>('/v3/employees', {
        limit: params.limit,
        page: params.page,
        include_inactive: params.include_inactive,
      });
    } catch (e) {
      if (e instanceof RestClientError && e.status === 404) {
        return [];
      }
      throw e;
    }
  }
}
