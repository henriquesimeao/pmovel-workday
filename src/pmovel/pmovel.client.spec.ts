import { PmovelClient } from './pmovel.client';
import { AppConfigService } from '../config/app-config.service';
import { RestClientError } from '../common/http/rest-client.error';
import { CreateEmployeeDto } from './pmovel.types';

function makeConfig(): AppConfigService {
  return {
    pmovel: {
      baseUrl: 'https://tools.pmovel.com.br',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    },
  } as unknown as AppConfigService;
}

function mockResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as Response;
}

/** Monta um JWT fake com um claim exp (não assinado — só para o cache). */
function fakeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.signature`;
}

const sampleEmployee: CreateEmployeeDto = {
  cnpj: '00000000000000',
  matricula: '1001',
  name: 'Fulano de Tal',
  cpf: '00000000000',
  email: 'fulano@example.com',
  employeegroup_code: 'GRP',
  syndicate_code: 'SIND',
  workday_code: 'JOR',
  dt_admissao: '2021-03-01',
  country: 'BR',
  is_manager: false,
  external_id: '1001',
};

describe('PmovelClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it('faz login em /v3/auth/login e usa o JWT como Bearer', async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { access_token: jwt }))
      .mockResolvedValueOnce(mockResponse(201, { id: 1, external_id: '1001' }));

    const client = new PmovelClient(makeConfig());
    await client.createEmployee(sampleEmployee);

    // 1ª chamada: login
    const loginUrl = fetchMock.mock.calls[0][0] as string;
    const loginInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(loginUrl).toBe('https://tools.pmovel.com.br/v3/auth/login');
    expect(JSON.parse(String(loginInit.body))).toEqual({
      access_key_id: 'access-key',
      secret_access_key: 'secret-key',
    });

    // 2ª chamada: create com Bearer
    const createInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((createInit.headers as Record<string, string>).Authorization).toBe(`Bearer ${jwt}`);
  });

  it('reutiliza o token entre chamadas (login só uma vez)', async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { access_token: jwt }))
      .mockResolvedValue(mockResponse(200, []));

    const client = new PmovelClient(makeConfig());
    await client.listEmployees();
    await client.listEmployees();

    const loginCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v3/auth/login'),
    );
    expect(loginCalls).toHaveLength(1);
  });

  describe('computeExpiry', () => {
    it('usa o claim exp do JWT com margem de 60s', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const expiresAt = PmovelClient.computeExpiry(fakeJwt(exp));
      // ~ (exp - 60) em ms
      expect(expiresAt).toBeLessThanOrEqual(exp * 1000 - 60_000 + 1000);
      expect(expiresAt).toBeGreaterThan(Date.now());
    });

    it('cai para fallback de 1h em JWT sem exp', () => {
      const noExp = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.x`;
      const expiresAt = PmovelClient.computeExpiry(noExp);
      expect(expiresAt).toBeGreaterThan(Date.now());
    });
  });

  it('createEmployee envia POST /v3/employees com o corpo', async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { access_token: jwt }))
      .mockResolvedValueOnce(mockResponse(201, { id: 1, external_id: '1001' }));

    const client = new PmovelClient(makeConfig());
    await client.createEmployee(sampleEmployee);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://tools.pmovel.com.br/v3/employees');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body)).external_id).toBe('1001');
  });

  it('updateEmployeeByExternalId faz PUT na rota com external_id codificado', async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { access_token: jwt }))
      .mockResolvedValueOnce(mockResponse(200, { id: 1 }));

    const client = new PmovelClient(makeConfig());
    await client.updateEmployeeByExternalId('A/B 1', { name: 'Novo Nome' });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://tools.pmovel.com.br/v3/employees/external_id/A%2FB%201');
    expect((init as RequestInit).method).toBe('PUT');
  });

  it('inactivateEmployeeByExternalId faz POST no endpoint de inativação', async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { access_token: jwt }))
      .mockResolvedValueOnce(mockResponse(204, ''));

    const client = new PmovelClient(makeConfig());
    await client.inactivateEmployeeByExternalId('1001', { dt_demissao: '2026-01-31' });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(
      'https://tools.pmovel.com.br/v3/employees/inactivate/external_id/1001',
    );
    expect(JSON.parse(String((init as RequestInit).body)).dt_demissao).toBe('2026-01-31');
  });

  it('getEmployeeByExternalId retorna null em 404', async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { access_token: jwt }))
      .mockResolvedValueOnce(mockResponse(404, { status_code: 404, error: 'Not Found', message: [] }));

    const client = new PmovelClient(makeConfig());
    const result = await client.getEmployeeByExternalId('9999');
    expect(result).toBeNull();
  });

  it('getEmployeeByExternalId propaga erros não-404', async () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { access_token: jwt }))
      .mockResolvedValue(mockResponse(500, 'server error'));

    const client = new PmovelClient(makeConfig());
    await expect(client.getEmployeeByExternalId('1')).rejects.toBeInstanceOf(RestClientError);
  });

  it('propaga erro de login como RestClientError', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { message: 'Invalid credentials' }));

    const client = new PmovelClient(makeConfig());
    await expect(client.listEmployees()).rejects.toMatchObject({
      name: 'RestClientError',
      status: 401,
    });
  });
});
