import { Injectable } from '@nestjs/common';
import { BaseRestClient, AccessToken } from '../common/http/base-rest-client';
import { AppConfigService } from '../config/app-config.service';
import { RestClientError } from '../common/http/rest-client.error';
import {
  WorkerSummary,
  WorkerDetail,
  WorkdayCollection,
} from './workday.types';
import { ConsolidatedWorker } from './consolidated-worker';
import { alpha3ToAlpha2 } from '../common/geo/iso-countries';
import {
  parseSoapResponse,
  SoapNode,
  soapEnvelope,
  WORKDAY_SOAP_VERSION,
} from './soap/workday-soap';

/** Instância do Workday como o WQL devolve (`{ id, descriptor }`). */
interface WqlInstance {
  id?: string;
  descriptor?: string;
}

/** Linha da query WQL da Fase 1 (`EMPLOYEES_WQL`). Qualquer campo pode faltar. */
export interface WqlWorkerRow {
  employeeID?: string;
  workdayID?: string;
  legalNameInGeneralDisplayFormat?: string;
  primaryWork_Email?: unknown;
  hireDate?: string | null;
  terminationDate?: string | null;
  currentlyActive?: unknown;
  company_ID?: string | null;
  company?: WqlInstance | null;
  dateOfBirth?: string;
  isManager?: unknown;
  jobTitle?: string;
  jobCode?: string;
  locationAddress_Country?: WqlInstance | null;
  nationalIdentifiers?: unknown;
}

/** Recorte do `common/v1/workers/{id}` usado na consolidação REST. */
export interface CommonWorker {
  descriptor?: string;
  dateOfBirth?: string;
  isManager?: boolean;
}

/** Recorte do `staffing/v6/workers/{id}` usado na consolidação e no país. */
export interface StaffingWorker {
  descriptor?: string;
  workerId?: string;
  person?: { email?: string };
  primaryJob?: {
    descriptor?: string;
    location?: { country?: Record<string, string | undefined> };
    supervisoryOrganization?: {
      descriptor?: string;
      Organization_Reference_ID?: string;
    };
  };
}

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
    const servicesHost = WorkdayClient.resolveServicesHost(
      wd.tenantUrl,
      wd.servicesUrl,
    );
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
    const host = new URL(tenantUrl).hostname.replace(
      /^([^.]+)\./,
      '$1-services1.',
    );
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
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      'base64',
    );
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

    const json = JSON.parse(text) as {
      access_token: string;
      expires_in?: number;
    };
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
    return this.paginateOffset<WorkerSummary>(
      'common/v1/{tenant}/workers',
      {},
      pageSize,
    );
  }

  /** Busca uma página única de workers (útil para testes/diagnóstico). */
  getWorkersPage(
    limit = 3,
    offset = 0,
  ): Promise<WorkdayCollection<WorkerSummary>> {
    return this.get<WorkdayCollection<WorkerSummary>>(
      'common/v1/{tenant}/workers',
      {
        limit,
        offset,
      },
    );
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

  // --- SOAP (web services) ---

  /**
   * Chama uma operação SOAP do Workday (`/ccx/service/{tenant}/{serviço}/{versão}`)
   * com o mesmo token OAuth da REST. Em 401, renova o token e repete uma vez.
   *
   * @param service serviço SOAP (ex.: `Payroll`, `Payroll_Interface`)
   * @param operation nome da operação, só para mensagens de erro
   * @param body XML do request (já com os valores escapados)
   * @returns o `Body` da resposta; lança `WorkdaySoapError` em fault
   */
  async callSoap(
    service: string,
    operation: string,
    body: string,
  ): Promise<SoapNode> {
    const url = `${this.servicesHost}/ccx/service/${this.tenant}/${service}/${WORKDAY_SOAP_VERSION}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getAccessToken(attempt > 0);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: soapEnvelope(body),
      });
      if (res.status === 401 && attempt === 0) continue;
      return parseSoapResponse(operation, res.status, await res.text());
    }
    throw new Error('callSoap: estado inesperado');
  }

  // --- WQL (Workday Query Language) ---

  /**
   * Executa uma query WQL (`GET wql/v1/{tenant}/data`) e itera todas as linhas,
   * paginando por offset (limite máximo de 100 por página imposto pela API).
   *
   * Requer: domínio "Workday Query Language (WQL)" liberado no ISSG + escopo
   * "System" no API Client (ver docs/workday-novo-cliente.md).
   */
  async *queryWql<T = Record<string, unknown>>(
    query: string,
    pageSize = 100,
  ): AsyncGenerator<T> {
    const singleLine = query.replace(/\s+/g, ' ').trim();
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.get<{ data?: T[]; total?: number }>(
        'wql/v1/{tenant}/data',
        { query: singleLine, limit: pageSize, offset },
      );
      const data = page.data ?? [];
      yield* data;
      if (
        data.length < pageSize ||
        offset + data.length >= (page.total ?? Infinity)
      ) {
        return;
      }
    }
  }

  /**
   * Query WQL padrão da Fase 1: todos os workers (ativos e terminados) com os
   * campos necessários para admissão/atualização/demissão. Os nomes dos campos
   * foram descobertos no data source `allActiveAndTerminatedWorkers`
   * (ver docs/de-para-workday-pmovel.md).
   */
  static readonly EMPLOYEES_WQL = `
    SELECT employeeID,
           workdayID,
           legalNameInGeneralDisplayFormat,
           primaryWork_Email,
           hireDate,
           terminationDate,
           currentlyActive,
           company_ID,
           company,
           dateOfBirth,
           isManager,
           jobTitle,
           jobCode,
           locationAddress_Country,
           nationalIdentifiers
    FROM allActiveAndTerminatedWorkers
  `;

  /** Tentativas, por execução, de descobrir o código ISO de um país. */
  private static readonly COUNTRY_LOOKUP_ATTEMPTS = 3;

  /** País do Workday (id interno) → ISO alpha-2. Países não mudam: vale pelo processo. */
  private readonly countryIsoCache = new Map<string, string>();

  /**
   * Itera os workers da Fase 1 já consolidados, via WQL, com o país (ISO
   * alpha-2) resolvido.
   */
  async *listConsolidatedWorkersViaWql(): AsyncGenerator<ConsolidatedWorker> {
    const attempts = new Map<string, number>();
    for await (const row of this.queryWql<WqlWorkerRow>(
      WorkdayClient.EMPLOYEES_WQL,
    )) {
      const worker = WorkdayClient.consolidateFromWql(row);
      worker.countryAlpha2 = await this.countryAlpha2For(row, attempts);
      yield worker;
    }
  }

  /**
   * Código ISO alpha-2 do país do worker.
   *
   * O WQL devolve o país só como instância (`{ id, descriptor }`), sem o código
   * ISO. O código vem do `staffing/v6` de um worker desse país
   * (`primaryJob.location.country`), uma vez por país: o resultado fica em
   * cache, então são poucas chamadas por execução (uma por país). Se o worker
   * consultado não trouxer o país (ex.: demitido sem cargo), tenta o próximo
   * worker do mesmo país, até `COUNTRY_LOOKUP_ATTEMPTS` vezes.
   */
  private async countryAlpha2For(
    row: WqlWorkerRow,
    attempts: Map<string, number>,
  ): Promise<string | undefined> {
    const country = row.locationAddress_Country;
    const countryId = country?.id;
    if (!countryId) return undefined;

    const cached = this.countryIsoCache.get(countryId);
    if (cached) return cached;

    const tried = attempts.get(countryId) ?? 0;
    if (tried >= WorkdayClient.COUNTRY_LOOKUP_ATTEMPTS || !row.workdayID) {
      return undefined;
    }
    attempts.set(countryId, tried + 1);

    try {
      const staffing = await this.getResource<StaffingWorker>(
        `staffing/v6/{tenant}/workers/${row.workdayID}`,
      );
      const iso = WorkdayClient.countryIsoFromStaffing(staffing);
      if (iso) {
        this.countryIsoCache.set(countryId, iso);
        return iso;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `país "${country?.descriptor ?? countryId}": falha ao ler o código ISO (${message})`,
      );
    }
    if (tried + 1 >= WorkdayClient.COUNTRY_LOOKUP_ATTEMPTS) {
      this.logger.warn(
        `país "${country?.descriptor ?? countryId}": código ISO não encontrado após ${WorkdayClient.COUNTRY_LOOKUP_ATTEMPTS} tentativas; os workers desse país ficam sem país`,
      );
    }
    return undefined;
  }

  /** ISO alpha-2 do país do cargo principal (aceita alpha-2 ou alpha-3). */
  static countryIsoFromStaffing(
    staffing: StaffingWorker | null | undefined,
  ): string | undefined {
    const country = staffing?.primaryJob?.location?.country;
    const alpha2 = country?.['ISO_3166-1_Alpha-2_Code'];
    if (typeof alpha2 === 'string' && /^[A-Za-z]{2}$/.test(alpha2.trim())) {
      return alpha2.trim().toUpperCase();
    }
    return alpha3ToAlpha2(country?.['ISO_3166-1_Alpha-3_Code']);
  }

  /**
   * Consolida um `ConsolidatedWorker` a partir de uma linha do WQL.
   * Lógica pura (testável sem rede). Normaliza os campos que a API devolve como
   * objeto (`company`, `locationAddress_Country`) para o descritor/id legível.
   * O código ISO do país não vem no WQL: é preenchido por
   * `listConsolidatedWorkersViaWql`.
   */
  static consolidateFromWql(row: WqlWorkerRow): ConsolidatedWorker {
    const companyObj =
      row.company && typeof row.company === 'object' ? row.company : undefined;
    const active = WorkdayClient.toBool(row.currentlyActive);
    return {
      id: String(row.employeeID ?? ''),
      descriptor: row.legalNameInGeneralDisplayFormat ?? '',
      workerId: String(row.employeeID ?? ''),
      email: WorkdayClient.extractEmail(row.primaryWork_Email),
      dateOfBirth: row.dateOfBirth ?? undefined,
      isManager: WorkdayClient.toBool(row.isManager),
      // Título legível do cargo; o código (jobCode) só quando não há título.
      jobTitle: row.jobTitle || row.jobCode || undefined,
      countryId: row.locationAddress_Country?.id ?? null,
      countryName: row.locationAddress_Country?.descriptor ?? null,
      // company_ID é o identificador legível da legal entity (ex.: "NLE USA").
      legalEntity: row.company_ID ?? companyObj?.descriptor ?? undefined,
      legalEntityId: row.company_ID ?? companyObj?.id ?? undefined,
      legalEntityName: companyObj?.descriptor ?? row.company_ID ?? undefined,
      hireDate: row.hireDate ?? null,
      terminationDate: row.terminationDate ?? null,
      active,
      cpf: WorkdayClient.extractNationalId(row.nationalIdentifiers),
    };
  }

  private static toBool(v: unknown): boolean {
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  /** primaryWork_Email pode vir string ou objeto/array; extrai a string. */
  private static extractEmail(v: unknown): string | undefined {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const first = Object.values(v as Record<string, unknown>)[0];
      return typeof first === 'string' ? first : undefined;
    }
    return undefined;
  }

  /**
   * Extrai o documento que vai no campo `cpf` do Pmovel, a partir de
   * `nationalIdentifiers`.
   *
   * Cada documento vem como `{ id, descriptor }`. O `id` é o identificador
   * interno do Workday (hash de 32 caracteres), NUNCA o número do documento. O
   * número está no `descriptor`, no formato `"<número> (<PAÍS>-<TIPO>)"`, por
   * exemplo `"000.000.000-00 (BRA-CPF)"`.
   *
   * Regra:
   * 1. Se a pessoa tem um CPF brasileiro (`BRA-CPF`), usa ele, só com dígitos.
   * 2. Senão, usa o documento principal dela (o primeiro da lista), do jeito que
   *    o Workday formata (SSN, SIN, NINO...), sem o sufixo de país/tipo.
   * 3. Sem nenhum documento legível, devolve `null`.
   */
  static extractNationalId(v: unknown): string | null {
    if (!Array.isArray(v)) return null;

    const docs: Array<{ number: string; country: string; type: string }> = [];
    for (const item of v) {
      const descriptor = (item as Record<string, unknown> | null)?.descriptor;
      if (typeof descriptor !== 'string') continue;
      const match = descriptor.match(/^(.*?)\s*\(([A-Za-z]{3})-([^)]+)\)\s*$/);
      if (!match) continue;
      const number = match[1].trim();
      if (!number) continue;
      docs.push({
        number,
        country: match[2].toUpperCase(),
        type: match[3].trim().toUpperCase(),
      });
    }

    const cpf = docs.find((d) => d.country === 'BRA' && d.type === 'CPF');
    if (cpf) return cpf.number.replace(/\D/g, '') || null;

    return docs[0]?.number ?? null;
  }

  /**
   * Monta o `ConsolidatedWorker` a partir dos endpoints disponíveis
   * (common/v1 + staffing/v6). Campos que dependem de WQL/SOAP (hireDate,
   * terminationDate, active, legalEntity, cpf) ficam ausentes até a decisão
   * registrada em docs/de-para-workday-pmovel.md.
   *
   * O parsing isola o restante da aplicação da forma crua do Workday.
   */
  async getConsolidatedWorker(id: string): Promise<ConsolidatedWorker> {
    const [common, staffing] = await Promise.all([
      this.getResource<CommonWorker>(`common/v1/{tenant}/workers/${id}`),
      this.getResource<StaffingWorker>(`staffing/v6/{tenant}/workers/${id}`),
    ]);
    return WorkdayClient.consolidate(id, common, staffing);
  }

  /** Lógica pura de consolidação (testável sem rede). */
  static consolidate(
    id: string,
    common: CommonWorker,
    staffing: StaffingWorker,
  ): ConsolidatedWorker {
    const country = staffing?.primaryJob?.location?.country ?? {};
    return {
      id,
      descriptor: staffing?.descriptor ?? common?.descriptor ?? '',
      workerId: staffing?.workerId ?? '',
      email: staffing?.person?.email,
      dateOfBirth: common?.dateOfBirth,
      isManager: Boolean(common?.isManager),
      jobTitle: staffing?.primaryJob?.descriptor,
      countryAlpha2: country['ISO_3166-1_Alpha-2_Code'],
      countryAlpha3: country['ISO_3166-1_Alpha-3_Code'],
      supervisoryOrganization:
        staffing?.primaryJob?.supervisoryOrganization?.descriptor,
      legalEntityId:
        staffing?.primaryJob?.supervisoryOrganization
          ?.Organization_Reference_ID,
      legalEntity: staffing?.primaryJob?.supervisoryOrganization?.descriptor,
      // Gaps (WQL/SOAP) — ficam undefined até a decisão do usuário:
      hireDate: undefined,
      terminationDate: undefined,
      active: undefined,
      cpf: undefined,
    };
  }
}
