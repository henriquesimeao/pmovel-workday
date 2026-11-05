/**
 * Fixtures ANONIMIZADAS de worker do Workday.
 *
 * A ESTRUTURA (caminhos de campos) reflete o que foi descoberto no tenant real
 * (ver docs/de-para-workday-pmovel.md), mas todos os VALORES são fictícios —
 * nenhum dado real de pessoa. Usadas nos testes das Tasks 7 (mapeamento) e 9
 * (EmployeeSyncJob).
 */

/** Forma enxuta (coleção common/v1). */
export const workerSummaryFixture = {
  id: '00000000000000000000000000000001',
  descriptor: 'Fulano de Tal',
  href: 'https://example-services1.wd119.myworkday.com/api/api/v1/tenant/workers/00000000000000000000000000000001',
};

/** Detalhe common/v1 (inclui dateOfBirth, isManager, organização). */
export const workerCommonV1Fixture = {
  id: '00000000000000000000000000000001',
  descriptor: 'Fulano de Tal',
  yearsOfService: '3',
  dateOfBirth: '1990-01-15',
  isManager: false,
  primarySupervisoryOrganization: {
    descriptor: 'Operações - Brasil',
    id: '0000000000000000000000000000000a',
  },
  location: {
    descriptor: 'São Paulo',
    id: '0000000000000000000000000000000b',
  },
};

/** Detalhe staffing/v6 (cargo, país, organização, person.email, workerId). */
export const workerStaffingV6Fixture = {
  id: '00000000000000000000000000000001',
  descriptor: 'Fulano de Tal',
  prehireId: 'P00001',
  person: {
    id: '00000000000000000000000000000002',
    email: 'fulano@example.com',
  },
  workerId: '1001',
  primaryJob: {
    id: '00000000000000000000000000000003',
    descriptor: 'Analista de Sistemas - Fulano de Tal',
    jobType: { descriptor: 'Primary', Job_Type_Name_ID: 'Primary' },
    location: {
      id: '0000000000000000000000000000000b',
      descriptor: 'São Paulo',
      Location_ID: 'Sao_Paulo',
      country: {
        descriptor: 'Brazil',
        'ISO_3166-1_Alpha-3_Code': 'BRA',
        'ISO_3166-1_Alpha-2_Code': 'BR',
      },
    },
    supervisoryOrganization: {
      id: '0000000000000000000000000000000a',
      descriptor: 'Operações - Brasil',
      Organization_Reference_ID: 'SO01',
    },
  },
  workerType: {
    descriptor: 'Employee',
    id: '0000000000000000000000000000000c',
  },
};

/**
 * "Worker consolidado" — forma que o mapeador consome, juntando os campos
 * relevantes de common/v1 e staffing/v6 num único objeto. Os campos de gap
 * (hireDate, terminationDate, active, company, cpf) ficam opcionais até a
 * decisão sobre WQL/SOAP (ver de-para).
 */
import { ConsolidatedWorker } from '../consolidated-worker';

export const consolidatedWorkerFixture: ConsolidatedWorker = {
  id: '00000000000000000000000000000001',
  descriptor: 'Fulano de Tal',
  workerId: '1001',
  email: 'fulano@example.com',
  dateOfBirth: '1990-01-15',
  isManager: false,
  jobTitle: 'Analista de Sistemas - Fulano de Tal',
  countryAlpha2: 'BR',
  countryAlpha3: 'BRA',
  supervisoryOrganization: 'Operações - Brasil',
  // Gaps (dependem de WQL/SOAP) — presentes aqui para testar o caminho feliz:
  hireDate: '2021-03-01',
  terminationDate: null,
  active: true,
  legalEntity: 'ACME Brasil LTDA',
  legalEntityId: 'SO01',
  cpf: '00000000000',
};
