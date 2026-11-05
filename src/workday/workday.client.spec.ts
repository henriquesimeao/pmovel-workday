import { WorkdayClient } from './workday.client';
import { AppConfigService } from '../config/app-config.service';

/** AppConfigService fake com credenciais fictícias (nenhum segredo real). */
function makeConfig(overrides: Partial<AppConfigService['workday']> = {}) {
  const workday = {
    tenant: 'tenant_dev',
    tenantUrl: 'https://odpimpl.wd119.myworkday.com/tenant_dev',
    servicesUrl: undefined as string | undefined,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    ...overrides,
  };
  return { workday } as unknown as AppConfigService;
}

function mockResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as Response;
}

describe('WorkdayClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('resolveServicesHost', () => {
    it('converte host da UI para -services1', () => {
      expect(
        WorkdayClient.resolveServicesHost(
          'https://odpimpl.wd119.myworkday.com/tenant_dev',
        ),
      ).toBe('https://odpimpl-services1.wd119.myworkday.com');
    });

    it('usa WorkdayServicesUrl quando informado', () => {
      expect(
        WorkdayClient.resolveServicesHost(
          'https://odpimpl.wd119.myworkday.com/tenant_dev',
          'https://custom-services.example.com/x',
        ),
      ).toBe('https://custom-services.example.com');
    });
  });

  it('monta o endpoint de token e obtém o access token', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(200, { access_token: 'abc', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(mockResponse(200, { total: 0, data: [] }));

    const client = new WorkdayClient(makeConfig());
    await client.getWorkersPage(3);

    // 1ª chamada: token
    const tokenUrl = fetchMock.mock.calls[0][0] as string;
    const tokenInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(tokenUrl).toBe(
      'https://odpimpl-services1.wd119.myworkday.com/ccx/oauth2/tenant_dev/token',
    );
    const headers = tokenInit.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String(tokenInit.body)).toContain('grant_type=refresh_token');
  });

  it('monta a URL REST com /ccx/api e substitui {tenant}', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(200, { access_token: 'abc', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        mockResponse(200, { total: 1, data: [{ id: '1', descriptor: 'Ana' }] }),
      );

    const client = new WorkdayClient(makeConfig());
    const page = await client.getWorkersPage(3);

    const restUrl = fetchMock.mock.calls[1][0] as string;
    expect(restUrl).toContain(
      'https://odpimpl-services1.wd119.myworkday.com/ccx/api/common/v1/tenant_dev/workers',
    );
    expect(restUrl).toContain('limit=3');
    expect(page.data[0].descriptor).toBe('Ana');
  });

  it('lista workers paginando a coleção', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(200, { access_token: 'abc', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          total: 3,
          data: [
            { id: '1', descriptor: 'Ana' },
            { id: '2', descriptor: 'Bruno' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          total: 3,
          data: [{ id: '3', descriptor: 'Carla' }],
        }),
      );

    const client = new WorkdayClient(makeConfig());
    const names: string[] = [];
    for await (const w of client.listWorkers(2)) {
      names.push(w.descriptor);
    }

    expect(names).toEqual(['Ana', 'Bruno', 'Carla']);
  });

  it('propaga erro de token como RestClientError', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(400, { error: 'invalid_grant' }),
    );

    const client = new WorkdayClient(makeConfig());
    await expect(client.getWorkersPage(3)).rejects.toMatchObject({
      name: 'RestClientError',
      status: 400,
    });
  });
});
