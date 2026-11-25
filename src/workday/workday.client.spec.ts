import { Logger } from '@nestjs/common';
import { WorkdayClient, WqlWorkerRow } from './workday.client';
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

describe('WorkdayClient: país (ISO alpha-2) e cargo da Fase 1', () => {
  const USA = { id: 'country-usa', descriptor: 'United States of America' };
  const GBR = { id: 'country-gbr', descriptor: 'United Kingdom' };

  function clientWith(
    rows: WqlWorkerRow[],
    staffingByWid: Record<string, unknown>,
  ) {
    const client = new WorkdayClient(makeConfig());
    jest.spyOn(client, 'queryWql').mockImplementation(async function* () {
      yield* rows as never[];
    } as never);
    const getResource = jest
      .spyOn(client, 'getResource')
      .mockImplementation(async (path: string) => {
        const wid = path.split('/').pop()!;
        const res = staffingByWid[wid];
        if (res instanceof Error) throw res;
        return res as never;
      });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    return { client, getResource };
  }

  async function collect(client: WorkdayClient) {
    const out = [];
    for await (const w of client.listConsolidatedWorkersViaWql()) out.push(w);
    return out;
  }

  const staffing = (alpha3: string) => ({
    primaryJob: {
      location: { country: { 'ISO_3166-1_Alpha-3_Code': alpha3 } },
    },
  });

  afterEach(() => jest.restoreAllMocks());

  it('consolidateFromWql usa o título do cargo e guarda o país do Workday', () => {
    const w = WorkdayClient.consolidateFromWql({
      employeeID: '21001',
      jobTitle: 'Chief Executive Officer',
      jobCode: 'Chief_Executive_Officer',
      locationAddress_Country: USA,
    });
    expect(w.jobTitle).toBe('Chief Executive Officer');
    expect(w.countryId).toBe('country-usa');
    expect(w.countryName).toBe('United States of America');
    expect(w.countryAlpha2).toBeUndefined();
  });

  it('sem título, usa o código do cargo', () => {
    const w = WorkdayClient.consolidateFromWql({
      employeeID: '1',
      jobTitle: '',
      jobCode: 'Analista_Sistemas',
    });
    expect(w.jobTitle).toBe('Analista_Sistemas');
  });

  it('countryIsoFromStaffing aceita alpha-2 ou converte alpha-3', () => {
    expect(WorkdayClient.countryIsoFromStaffing(staffing('USA'))).toBe('US');
    expect(WorkdayClient.countryIsoFromStaffing(staffing('GBR'))).toBe('GB');
    expect(
      WorkdayClient.countryIsoFromStaffing({
        primaryJob: {
          location: { country: { 'ISO_3166-1_Alpha-2_Code': 'ca' } },
        },
      }),
    ).toBe('CA');
    expect(
      WorkdayClient.countryIsoFromStaffing(staffing('ZZZ')),
    ).toBeUndefined();
    expect(WorkdayClient.countryIsoFromStaffing({})).toBeUndefined();
  });

  it('resolve o ISO uma vez por país e aplica a todos os workers desse país', async () => {
    const { client, getResource } = clientWith(
      [
        { employeeID: '1', workdayID: 'w1', locationAddress_Country: USA },
        { employeeID: '2', workdayID: 'w2', locationAddress_Country: USA },
        { employeeID: '3', workdayID: 'w3', locationAddress_Country: GBR },
        { employeeID: '4', workdayID: 'w4', locationAddress_Country: USA },
      ],
      { w1: staffing('USA'), w3: staffing('GBR') },
    );

    const workers = await collect(client);

    expect(workers.map((w) => w.countryAlpha2)).toEqual([
      'US',
      'US',
      'GB',
      'US',
    ]);
    expect(getResource).toHaveBeenCalledTimes(2);

    // Segunda execução: o cache vale pelo processo, nenhuma chamada nova.
    await collect(client);
    expect(getResource).toHaveBeenCalledTimes(2);
  });

  it('se o worker consultado não traz o país, tenta o próximo do mesmo país', async () => {
    const { client, getResource } = clientWith(
      [
        { employeeID: '1', workdayID: 'w1', locationAddress_Country: USA },
        { employeeID: '2', workdayID: 'w2', locationAddress_Country: USA },
      ],
      { w1: new Error('404 demitido'), w2: staffing('USA') },
    );

    const workers = await collect(client);

    expect(workers.map((w) => w.countryAlpha2)).toEqual([undefined, 'US']);
    expect(getResource).toHaveBeenCalledTimes(2);
  });

  it('desiste do país após 3 tentativas na mesma execução', async () => {
    const rows = ['1', '2', '3', '4', '5'].map((id) => ({
      employeeID: id,
      workdayID: `w${id}`,
      locationAddress_Country: USA,
    }));
    const { client, getResource } = clientWith(rows, {});

    const workers = await collect(client);

    expect(workers.every((w) => w.countryAlpha2 === undefined)).toBe(true);
    expect(getResource).toHaveBeenCalledTimes(3);
  });

  it('worker sem país no Workday fica sem país (sem chamada REST)', async () => {
    const { client, getResource } = clientWith(
      [{ employeeID: '1', workdayID: 'w1' }],
      {},
    );

    const [worker] = await collect(client);

    expect(worker.countryAlpha2).toBeUndefined();
    expect(getResource).not.toHaveBeenCalled();
  });
});

describe('WorkdayClient.callSoap', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => jest.restoreAllMocks());

  const soapOk =
    '<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><wd:R xmlns:wd="urn:com.workday/bsvc"><wd:ID wd:type="WID">w1</wd:ID></wd:R></env:Body></env:Envelope>';

  it('chama /ccx/service/{tenant}/{serviço}/v45.0 com Bearer e o envelope', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(200, { access_token: 'abc', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(mockResponse(200, soapOk));
    const client = new WorkdayClient(makeConfig());

    const body = await client.callSoap('Payroll', 'Op', '<wd:Op_Request/>');

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://odpimpl-services1.wd119.myworkday.com/ccx/service/tenant_dev/Payroll/v45.0',
    );
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer abc',
    );
    expect(String(init.body)).toContain(
      '<soapenv:Body><wd:Op_Request/></soapenv:Body>',
    );
    expect(body).toHaveProperty('R');
  });

  it('em 401, renova o token e repete uma vez', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(200, { access_token: 'velho', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(mockResponse(401, ''))
      .mockResolvedValueOnce(
        mockResponse(200, { access_token: 'novo', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(mockResponse(200, soapOk));
    const client = new WorkdayClient(makeConfig());
    await client.callSoap('Payroll', 'Op', '<wd:Op_Request/>');
    const last = fetchMock.mock.calls[3][1] as RequestInit;
    expect((last.headers as Record<string, string>).Authorization).toBe(
      'Bearer novo',
    );
  });
});
