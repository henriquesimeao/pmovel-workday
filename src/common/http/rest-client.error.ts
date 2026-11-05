/**
 * Erro tipado para respostas HTTP não-2xx dos clientes REST.
 *
 * Porta o `WorkdayError` do código de referência (src/workday-rest.js),
 * generalizando para qualquer cliente que herde o BaseRestClient.
 * Expõe `status` e `body` para que o chamador decida o tratamento
 * (ex.: 409/já existe → fallback para update, na Fase 1).
 */
export class RestClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'RestClientError';
  }
}
