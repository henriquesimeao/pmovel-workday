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
    employeegroup_name: { mode: 'default', value: 'Grupo 01' },
    syndicate_name: { mode: 'default', value: 'Sindicato 01' },
    workday_name: { mode: 'default', value: 'Jornada 01' },
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
    // code + name juntos: o Pmovel cadastra sozinho o que não existir
    expect(dto.employeegroup_name).toBe('Grupo 01');
    expect(dto.syndicate_name).toBe('Sindicato 01');
    expect(dto.workday_name).toBe('Jornada 01');
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

  it('mensagem de CNPJ ausente informa qual empresa precisa de de/para', async () => {
    const mapper = new EmployeeMapper(
      fields,
      fakeCnpjService({}),
      configWithCpf,
    );
    const err = (await mapper
      .toCreateDto({
        ...consolidatedWorkerFixture,
        legalEntity: 'Next Level Enterprises, Ltd (Canada)',
      })
      .catch((e) => e)) as MappingError;

    expect(err.message).toContain('cnpj');
    expect(err.message).toContain('Next Level Enterprises, Ltd (Canada)');
    expect(err.message).toContain('cnpj_mapping');
  });

  describe('documento no campo cpf', () => {
    const mapper = () =>
      new EmployeeMapper(fields, fakeCnpjService({ SO01: 'X' }), configWithCpf);
    const comDoc = (cpf: string): ConsolidatedWorker => ({
      ...consolidatedWorkerFixture,
      cpf,
    });

    it('remove todos os espaços', async () => {
      expect((await mapper().toCreateDto(comDoc('AB 12 34 56 C'))).cpf).toBe(
        'AB123456C',
      );
      expect((await mapper().toCreateDto(comDoc('123 456 789'))).cpf).toBe(
        '123456789',
      );
      expect((await mapper().toCreateDto(comDoc(' 123  456\t789 '))).cpf).toBe(
        '123456789',
      );
    });

    it('mantém hífens (só espaço é removido)', async () => {
      expect((await mapper().toCreateDto(comDoc('123-45-6789'))).cpf).toBe(
        '123-45-6789',
      );
    });

    it('a atualização também envia o documento sem espaços', async () => {
      const update = await mapper().toUpdateDto(comDoc('AB 12 34 56 C'));
      expect(update.cpf).toBe('AB123456C');
    });

    it.each(['000000000', '000 000 000', '000-00-0000', ' 000.000.000 '])(
      'rejeita o documento de preenchimento "%s" na criação',
      async (doc) => {
        const err = (await mapper()
          .toCreateDto(comDoc(doc))
          .catch((e) => e)) as MappingError;
        expect(err).toBeInstanceOf(MappingError);
        expect(err.missingFields).toContain('cpf');
        expect(err.message).toContain('documento inválido');
      },
    );

    it('rejeita também na atualização', async () => {
      await expect(
        mapper().toUpdateDto(comDoc('000 000 000')),
      ).rejects.toBeInstanceOf(MappingError);
    });

    it('rejeita mesmo quando a pessoa tem e-mail real', async () => {
      const err = (await mapper()
        .toCreateDto({ ...comDoc('000000000'), email: 'a@b.com' })
        .catch((e) => e)) as MappingError;
      expect(err).toBeInstanceOf(MappingError);
      expect(err.message).toContain('documento inválido');
    });

    it('não aceita documentos parecidos que não são o recusado', async () => {
      expect((await mapper().toCreateDto(comDoc('000000001'))).cpf).toBe(
        '000000001',
      );
      expect((await mapper().toCreateDto(comDoc('00000000000'))).cpf).toBe(
        '00000000000',
      );
    });

    it('a lista de documentos recusados é configurável', async () => {
      const m = new EmployeeMapper(fields, fakeCnpjService({ SO01: 'X' }), {
        ...configWithCpf,
        invalidDocuments: ['000000000', '99999999999'],
      });
      await expect(
        m.toCreateDto(comDoc('999 999 999 99')),
      ).rejects.toBeInstanceOf(MappingError);
    });

    it('atualização não envia campos vazios (não apaga dado no Pmovel)', async () => {
      const update = await mapper().toUpdateDto({
        ...consolidatedWorkerFixture,
        cpf: null,
      });
      expect(update).not.toHaveProperty('cpf');
      for (const value of Object.values(update)) {
        expect(value).not.toBe('');
      }
    });
  });

  describe('e-mail sem cadastro no Workday', () => {
    const mapper = () =>
      new EmployeeMapper(fields, fakeCnpjService({ SO01: 'X' }), configWithCpf);

    it('monta documento@empresa.com', async () => {
      const dto = await mapper().toCreateDto({
        ...consolidatedWorkerFixture,
        email: undefined,
        cpf: '123-45-6789',
        legalEntityName: 'Next Level Enterprises (USA)',
      });
      expect(dto.email).toBe('123456789@nextlevelenterprisesusa.com');
    });

    it('limpa espaços, letras maiúsculas, vírgula, parênteses e acentos', async () => {
      const dto = await mapper().toCreateDto({
        ...consolidatedWorkerFixture,
        email: undefined,
        cpf: 'AB 12 34 56 C',
        legalEntityName: 'Operações Brasil, S.A. (São Paulo)',
      });
      expect(dto.email).toBe('ab123456c@operacoesbrasilsasaopaulo.com');
    });

    it('usa legalEntity quando não há nome legível da empresa', async () => {
      const dto = await mapper().toCreateDto({
        ...consolidatedWorkerFixture,
        email: undefined,
        cpf: '00000000000',
        legalEntityName: undefined,
        legalEntity: 'NLE USA',
      });
      expect(dto.email).toBe('00000000000@nleusa.com');
    });

    it('o e-mail real do Workday tem prioridade', async () => {
      const dto = await mapper().toCreateDto(consolidatedWorkerFixture);
      expect(dto.email).toBe('fulano@example.com');
    });

    it('sem documento não gera e-mail e aponta email como ausente', async () => {
      const err = (await mapper()
        .toCreateDto({
          ...consolidatedWorkerFixture,
          email: undefined,
          cpf: null,
        })
        .catch((e) => e)) as MappingError;
      expect(err).toBeInstanceOf(MappingError);
      expect(err.missingFields).toEqual(
        expect.arrayContaining(['email', 'cpf']),
      );
    });

    it('sem nome da empresa não gera e-mail', async () => {
      const err = (await mapper()
        .toCreateDto({
          ...consolidatedWorkerFixture,
          email: undefined,
          legalEntityName: undefined,
          legalEntity: undefined,
        })
        .catch((e) => e)) as MappingError;
      expect(err.missingFields).toContain('email');
    });

    it('na atualização, não reenvia o e-mail gerado', async () => {
      const update = await mapper().toUpdateDto({
        ...consolidatedWorkerFixture,
        email: undefined,
      });
      expect(update).not.toHaveProperty('email');
    });

    it('na atualização, reenvia o e-mail real do Workday', async () => {
      const update = await mapper().toUpdateDto(consolidatedWorkerFixture);
      expect(update.email).toBe('fulano@example.com');
    });
  });

  it('exige o name de grupo/sindicato/jornada (sem ele o Pmovel não cadastra)', async () => {
    const mapper = new EmployeeMapper(fields, fakeCnpjService({ SO01: 'X' }), {
      ...configWithCpf,
      fields: {
        ...configWithCpf.fields,
        employeegroup_name: { mode: 'default', value: '' },
      },
    });
    const err = (await mapper
      .toCreateDto(consolidatedWorkerFixture)
      .catch((e) => e)) as MappingError;
    expect(err).toBeInstanceOf(MappingError);
    expect(err.missingFields).toContain('employeegroup_name');
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
    expect(update).not.toHaveProperty('employeegroup_name');
    expect(update).not.toHaveProperty('syndicate_name');
    expect(update).not.toHaveProperty('workday_name');
    // mas o create ainda os inclui
    const create = await mapper.toCreateDto(consolidatedWorkerFixture);
    expect(create.employeegroup_code).toBe('GRP01');
  });
});
