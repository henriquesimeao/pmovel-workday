import { Logger } from '@nestjs/common';
import { RestClientError } from './rest-client.error';

/**
 * Token de acesso com validade.
 * `expiresAt` é um timestamp epoch (ms); o cache considera o token válido
 * enquanto `Date.now() < expiresAt`.
 */
export interface AccessToken {
  token: string;
  expiresAt: number;
}

export interface RequestOptions {
  /** Query params. Valores `undefined` são omitidos. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Corpo JSON (serializado automaticamente). */
  body?: unknown;
  /** Headers adicionais. */
  headers?: Record<string, string>;
}

/**
 * Cliente REST base, portado e generalizado a partir do `src/workday-rest.js`
 * de referência. Fornece a mecânica comum a Workday e Pmovel:
 *
 * - **Cache de token** com renovação automática ao expirar.
 * - **Retry único em 401**: renova o token (force) e repete a chamada uma vez.
 * - **Erros tipados** (`RestClientError` com status/body).
 * - **Paginação** em dois estilos: offset-based (Workday) e page-based (Pmovel).
 *
 * A obtenção do token é um *template method*: cada subclasse implementa
 * `fetchToken()` com o seu fluxo (refresh_token no Workday, login JWT no Pmovel).
 */
export abstract class BaseRestClient {
  protected readonly logger: Logger;
  private cachedToken: AccessToken | null = null;

  /**
   * @param baseUrl Base para resolução de paths relativos (sem barra final obrigatória).
   */
  constructor(
    protected readonly baseUrl: string,
    loggerContext: string,
  ) {
    this.logger = new Logger(loggerContext);
  }

  /**
   * Obtém um novo token junto ao provedor de autenticação.
   * Implementado por cada subclasse. Deve retornar o token e o instante de
   * expiração (com alguma margem de segurança já descontada).
   */
  protected abstract fetchToken(): Promise<AccessToken>;

  /**
   * Resolve um path (relativo ou absoluto) em uma URL completa.
   * Subclasses podem sobrescrever para aplicar substituições (ex.: {tenant}).
   */
  protected resolveUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    const base = this.baseUrl.replace(/\/+$/, '');
    const rel = path.replace(/^\/+/, '');
    return `${base}/${rel}`;
  }

  /** Retorna o token válido do cache ou obtém um novo. */
  protected async getAccessToken(force = false): Promise<string> {
    if (!force && this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }
    this.cachedToken = await this.fetchToken();
    return this.cachedToken.token;
  }

  /** Invalida o token em cache (útil em testes e cenários de rotação). */
  protected clearToken(): void {
    this.cachedToken = null;
  }

  /**
   * Executa uma requisição autenticada com retry único em 401.
   *
   * Em 401 na primeira tentativa, o token é renovado (force) e a chamada é
   * repetida uma vez. Respostas não-2xx (fora o 401 da primeira tentativa)
   * lançam `RestClientError`. 204/sem corpo retornam `undefined`.
   */
  protected async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.params);

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getAccessToken(attempt > 0);
      const res = await fetch(url, {
        method,
        headers: this.buildHeaders(token, options),
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      if (res.status === 401 && attempt === 0) {
        this.logger.debug(`401 em ${method} ${url} — renovando token e repetindo`);
        continue;
      }

      const text = await res.text();
      if (!res.ok) {
        throw new RestClientError(
          `${method} ${this.safePath(url)} → HTTP ${res.status}: ${text.slice(0, 500)}`,
          res.status,
          text,
        );
      }

      return (text ? JSON.parse(text) : undefined) as T;
    }

    // Inalcançável: o loop sempre retorna ou lança. Satisfaz o compilador.
    throw new Error('request: estado inesperado');
  }

  protected get<T>(path: string, params?: RequestOptions['params']): Promise<T> {
    return this.request<T>('GET', path, { params });
  }

  protected post<T>(path: string, body?: unknown, params?: RequestOptions['params']): Promise<T> {
    return this.request<T>('POST', path, { body, params });
  }

  protected put<T>(path: string, body?: unknown, params?: RequestOptions['params']): Promise<T> {
    return this.request<T>('PUT', path, { body, params });
  }

  protected delete<T>(path: string, params?: RequestOptions['params']): Promise<T> {
    return this.request<T>('DELETE', path, { params });
  }

  /**
   * Paginação estilo **offset** (Workday): coleções `{ data, total }` com
   * `limit`/`offset`. Itera item a item por todas as páginas.
   */
  protected async *paginateOffset<T>(
    path: string,
    params: RequestOptions['params'] = {},
    pageSize = 100,
  ): AsyncGenerator<T> {
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.get<{ data?: T[]; total?: number }>(path, {
        ...params,
        limit: pageSize,
        offset,
      });
      const data = page.data ?? [];
      yield* data;
      if (data.length < pageSize || offset + data.length >= (page.total ?? Infinity)) {
        return;
      }
    }
  }

  /**
   * Paginação estilo **page** (Pmovel): endpoints que retornam um array por
   * página com `page`/`limit`. Itera até receber uma página menor que o limite.
   */
  protected async *paginatePage<T>(
    path: string,
    params: RequestOptions['params'] = {},
    pageSize = 100,
  ): AsyncGenerator<T> {
    for (let page = 1; ; page++) {
      const items = await this.get<T[]>(path, { ...params, page, limit: pageSize });
      const arr = items ?? [];
      yield* arr;
      if (arr.length < pageSize) {
        return;
      }
    }
  }

  private buildUrl(path: string, params?: RequestOptions['params']): string {
    const url = new URL(this.resolveUrl(path));
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(token: string, options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...options.headers,
    };
    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  /** Extrai só o pathname para mensagens de erro (evita vazar query/host). */
  private safePath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
}
