import { BaseRestClient, AccessToken, RequestOptions } from './base-rest-client';
import { RestClientError } from './rest-client.error';

/**
 * Subclasse de teste que expõe os métodos protegidos e instrumenta o
 * fetchToken para contar quantas vezes um novo token foi obtido.
 */
class TestClient extends BaseRestClient {
  fetchTokenCalls = 0;
  tokenTtlMs = 60_000;

  constructor(baseUrl = 'https://api.example.com') {
    super(baseUrl, 'TestClient');
  }

  protected async fetchToken(): Promise<AccessToken> {
    this.fetchTokenCalls += 1;
    return {
      token: `token-${this.fetchTokenCalls}`,
      expiresAt: Date.now() + this.tokenTtlMs,
    };
  }

  // Expor protegidos para o teste
  pGet<T>(path: string, params?: RequestOptions['params']) {
    return this.get<T>(path, params);
  }
  pPost<T>(path: string, body?: unknown) {
    return this.post<T>(path, body);
  }
  pRequest<T>(method: string, path: string, options?: RequestOptions) {
    return this.request<T>(method, path, options);
  }
  pPaginateOffset<T>(path: string, params?: RequestOptions['params'], size?: number) {
    return this.paginateOffset<T>(path, params, size);
  }
  pPaginatePage<T>(path: string, params?: RequestOptions['params'], size?: number) {
    return this.paginatePage<T>(path, params, size);
  }
}

/** Helper: resposta fetch simulada. */
function mockResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as Response;
}

describe('BaseRestClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reutiliza o token em cache entre chamadas', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));
    const client = new TestClient();

    await client.pGet('resource');
    await client.pGet('resource');

    expect(client.fetchTokenCalls).toBe(1);
    // Authorization com o mesmo token nas duas chamadas
    const auth1 = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const auth2 = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(auth1.Authorization).toBe('Bearer token-1');
    expect(auth2.Authorization).toBe('Bearer token-1');
  });

  it('renova o token quando expira', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, {}));
    const client = new TestClient();
    client.tokenTtlMs = 60_000;

    const base = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(base);

    await client.pGet('resource'); // obtém token válido até base + 60s
    nowSpy.mockReturnValue(base + 61_000); // avança além da expiração
    await client.pGet('resource'); // deve renovar

    expect(client.fetchTokenCalls).toBe(2);
  });

  it('faz retry único em 401 renovando o token', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, 'unauthorized'))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));
    const client = new TestClient();

    const result = await client.pGet<{ ok: boolean }>('resource');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.fetchTokenCalls).toBe(2); // token inicial + renovação no 401
  });

  it('lança RestClientError em resposta não-2xx (com status e body)', async () => {
    fetchMock.mockResolvedValue(mockResponse(400, { error: 'bad request' }));
    const client = new TestClient();

    await expect(client.pGet('resource')).rejects.toMatchObject({
      name: 'RestClientError',
      status: 400,
    });
    await expect(client.pGet('resource')).rejects.toBeInstanceOf(RestClientError);
  });

  it('não repete além de uma vez em 401 persistente', async () => {
    fetchMock.mockResolvedValue(mockResponse(401, 'nope'));
    const client = new TestClient();

    await expect(client.pGet('resource')).rejects.toMatchObject({ status: 401 });
    // 1ª tentativa (401, retry) + 2ª tentativa (401, lança) = 2 chamadas
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serializa body JSON e define Content-Type no POST', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { id: 1 }));
    const client = new TestClient();

    await client.pPost('resource', { name: 'x' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('retorna undefined em 204 sem corpo', async () => {
    fetchMock.mockResolvedValue(mockResponse(204, ''));
    const client = new TestClient();

    const result = await client.pRequest('DELETE', 'resource/1');
    expect(result).toBeUndefined();
  });

  it('omite query params undefined', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, {}));
    const client = new TestClient();

    await client.pGet('resource', { a: 1, b: undefined, c: 'x' });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('a=1');
    expect(calledUrl).toContain('c=x');
    expect(calledUrl).not.toContain('b=');
  });

  describe('paginateOffset (estilo Workday)', () => {
    it('itera todas as páginas até data menor que o pageSize', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { data: [{ id: 1 }, { id: 2 }], total: 3 }))
        .mockResolvedValueOnce(mockResponse(200, { data: [{ id: 3 }], total: 3 }));
      const client = new TestClient();

      const items: Array<{ id: number }> = [];
      for await (const item of client.pPaginateOffset<{ id: number }>('workers', {}, 2)) {
        items.push(item);
      }

      expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('para quando total é atingido mesmo com página cheia', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: [{ id: 1 }, { id: 2 }], total: 2 }));
      const client = new TestClient();

      const items: Array<{ id: number }> = [];
      for await (const item of client.pPaginateOffset<{ id: number }>('workers', {}, 2)) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('paginatePage (estilo Pmovel)', () => {
    it('itera páginas até receber array menor que o limite', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, [{ id: 1 }, { id: 2 }]))
        .mockResolvedValueOnce(mockResponse(200, [{ id: 3 }]));
      const client = new TestClient();

      const items: Array<{ id: number }> = [];
      for await (const item of client.pPaginatePage<{ id: number }>('employees', {}, 2)) {
        items.push(item);
      }

      expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // confirma incremento de page
      const page1 = fetchMock.mock.calls[0][0] as string;
      const page2 = fetchMock.mock.calls[1][0] as string;
      expect(page1).toContain('page=1');
      expect(page2).toContain('page=2');
    });
  });
});
