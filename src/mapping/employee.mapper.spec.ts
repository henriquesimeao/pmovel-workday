import { EmployeeMapper, MappingError } from './employee.mapper';
import { FieldMappingService } from './field-mapping.service';
import { CnpjMappingService } from './cnpj-mapping.service';
import { ConsolidatedWorker } from '../workday/consolidated-worker';
import { consolidatedWorkerFixture } from '../workday/__fixtures__/worker.fixture';
import {
  DEFAULT_EMPLOYEE_MAPPING,
  EmployeeMappingConfig,
} from './mapping.config';

/** CnpjMappingService fake com um de/para em memória. */
function fakeCnpjService(map: Record<string, string> = {}): CnpjMappingService {
  return {
    resolveForWorker: async (w: ConsolidatedWorker) =>
      (w.legalEntityId && map[w.legalEntityId]) || null,
  } as unknown as CnpjMappingService;
}

/** Config de teste: cpf direto, defaults nomeados, job_position com trim. */
const configWithCpf: EmployeeMappingConfig = {
  ...DEFAULT_EMPLOYEE_MAPPING,
  fields: {
    ...DEFAULT_EMPLOYEE_MAPPING.fields,
    cpf: { mode: 'direct', source: 'cpf' },
    employeegroup_code: { mode: 'default', value: 'GRP01' },
    syndicate_code: { mode: 'default', value: 'SIND01' },
    workday_code: { mode: 'default', value: 'JOR01' },
    job_position: {
      mode: 'direct',
      source: 'jobTitle',
      transform: 'trimJobTitle',
    },
  },
};

describe('EmployeeMapper', () => {
  const fields = new FieldMappingService();

  it('monta um CreateEmployeeDto válido no caminho feliz', async () => {
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({ SO01: '00000000000191' }),
      configWithCpf,
    );

    const dto = await mapper.toCreateDto(consolidatedWorkerFixture);

    expect(dto.external_id).toBe('1001');
    expect(dto.matricula).toBe('1001');
    expect(dto.cnpj).toBe('00000000000191');
    expect(dto.name).toBe('Fulano de Tal');
    expect(dto.email).toBe('fulano@example.com');
    expect(dto.cpf).toBe('00000000000');
    expect(dto.country).toBe('BR');
    expect(dto.is_manager).toBe(false);
    expect(dto.dt_admissao).toBe('2021-03-01');
    expect(dto.dt_nascimento).toBe('1990-01-15');
    // transform trimJobTitle remove o sufixo com o nome
    expect(dto.job_position).toBe('Analista de Sistemas');
    // defaults configurados
    expect(dto.employeegroup_code).toBe('GRP01');
    expect(dto.syndicate_code).toBe('SIND01');
    expect(dto.workday_code).toBe('JOR01');
  });

  it('usa valores default para os gaps (modo default)', async () => {
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({ SO01: 'X' }),
      configWithCpf,
    );
    const dto = await mapper.toCreateDto(consolidatedWorkerFixture);
    expect(dto.employeegroup_code).toBe('GRP01');
  });

  it('lança MappingError quando o CNPJ não está no de/para', async () => {
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({}),
      configWithCpf,
    );

    await expect(
      mapper.toCreateDto(consolidatedWorkerFixture),
    ).rejects.toBeInstanceOf(MappingError);
    const err = await mapper
      .toCreateDto(consolidatedWorkerFixture)
      .catch((e) => e);
    expect((err as MappingError).missingFields).toContain('cnpj');
  });

  it('lança MappingError listando campos obrigatórios ausentes', async () => {
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({ SO01: 'X' }),
      configWithCpf,
    );
    // worker sem email e sem cpf
    const incomplete: ConsolidatedWorker = {
      ...consolidatedWorkerFixture,
      email: undefined,
      cpf: null,
    };

    const err = (await mapper
      .toCreateDto(incomplete)
      .catch((e) => e)) as MappingError;
    expect(err).toBeInstanceOf(MappingError);
    expect(err.missingFields).toEqual(expect.arrayContaining(['email', 'cpf']));
    expect(err.externalId).toBe('1001');
  });

  it('com a config DEFAULT, worker sem CPF gera MappingError (cpf)', async () => {
    // DEFAULT lê cpf direto do worker; se ausente, falta cpf.
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({ SO01: '00000000000191' }),
      DEFAULT_EMPLOYEE_MAPPING,
    );
    const semCpf: ConsolidatedWorker = {
      ...consolidatedWorkerFixture,
      cpf: null,
    };
    const err = (await mapper
      .toCreateDto(semCpf)
      .catch((e) => e)) as MappingError;
    expect(err).toBeInstanceOf(MappingError);
    expect(err.missingFields).toContain('cpf');
  });

  it('toUpdateDto remove cnpj e external_id e tolera faltas', async () => {
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({ SO01: 'X' }),
      configWithCpf,
    );
    const update = await mapper.toUpdateDto(consolidatedWorkerFixture);

    expect(update).not.toHaveProperty('cnpj');
    expect(update).not.toHaveProperty('external_id');
    expect(update.name).toBe('Fulano de Tal');
  });

  it('toUpdateDto NÃO envia campos imutáveis (employeegroup/syndicate/workday)', async () => {
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({ SO01: 'X' }),
      configWithCpf,
    );
    const update = await mapper.toUpdateDto(consolidatedWorkerFixture);

    // definidos só na admissão — não devem ser sobrescritos no update
    expect(update).not.toHaveProperty('employeegroup_code');
    expect(update).not.toHaveProperty('syndicate_code');
    expect(update).not.toHaveProperty('workday_code');
    // mas o create ainda os inclui
    const create = await mapper.toCreateDto(consolidatedWorkerFixture);
    expect(create.employeegroup_code).toBe('GRP01');
  });
});
