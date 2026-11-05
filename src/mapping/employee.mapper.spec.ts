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

/** Config de teste: cpf vem do worker (preenche o gap do default). */
const configWithCpf: EmployeeMappingConfig = {
  ...DEFAULT_EMPLOYEE_MAPPING,
  fields: {
    ...DEFAULT_EMPLOYEE_MAPPING.fields,
    cpf: { mode: 'direct', source: 'cpf' },
    employeegroup_code: { mode: 'default', value: 'GRP01' },
    syndicate_code: { mode: 'default', value: 'SIND01' },
    workday_code: { mode: 'default', value: 'JOR01' },
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
    const mapper = new EmployeeMapper(fields, fakeCnpjService({ SO01: 'X' }), configWithCpf);
    const dto = await mapper.toCreateDto(consolidatedWorkerFixture);
    expect(dto.employeegroup_code).toBe('GRP01');
  });

  it('lança MappingError quando o CNPJ não está no de/para', async () => {
    const mapper = new EmployeeMapper(fields, fakeCnpjService({}), configWithCpf);

    try {
      await mapper.toCreateDto(consolidatedWorkerFixture);
      fail('deveria lançar');
    } catch (e) {
      expect(e).toBeInstanceOf(MappingError);
      expect((e as MappingError).missingFields).toContain('cnpj');
    }
  });

  it('lança MappingError listando campos obrigatórios ausentes', async () => {
    const mapper = new EmployeeMapper(fields, fakeCnpjService({ SO01: 'X' }), configWithCpf);
    // worker sem email e sem cpf
    const incomplete: ConsolidatedWorker = {
      ...consolidatedWorkerFixture,
      email: undefined,
      cpf: null,
    };

    try {
      await mapper.toCreateDto(incomplete);
      fail('deveria lançar');
    } catch (e) {
      expect(e).toBeInstanceOf(MappingError);
      const err = e as MappingError;
      expect(err.missingFields).toEqual(expect.arrayContaining(['email', 'cpf']));
      expect(err.externalId).toBe('1001');
    }
  });

  it('com a config DEFAULT, cpf vazio e defaults placeholder geram MappingError (cpf)', async () => {
    // A config default deixa cpf como default '' (gap) → deve faltar cpf.
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({ SO01: '00000000000191' }),
      DEFAULT_EMPLOYEE_MAPPING,
    );
    try {
      await mapper.toCreateDto(consolidatedWorkerFixture);
      fail('deveria lançar');
    } catch (e) {
      expect(e).toBeInstanceOf(MappingError);
      expect((e as MappingError).missingFields).toContain('cpf');
    }
  });

  it('toUpdateDto remove cnpj e external_id e tolera faltas', async () => {
    const mapper = new EmployeeMapper(fields, fakeCnpjService({ SO01: 'X' }), configWithCpf);
    const update = await mapper.toUpdateDto(consolidatedWorkerFixture);

    expect(update).not.toHaveProperty('cnpj');
    expect(update).not.toHaveProperty('external_id');
    expect(update.name).toBe('Fulano de Tal');
  });
});
