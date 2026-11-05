import { FieldMappingService } from './field-mapping.service';
import { ConsolidatedWorker } from '../workday/consolidated-worker';

const worker: ConsolidatedWorker = {
  id: 'wid',
  descriptor: 'Fulano de Tal',
  workerId: '1001',
  jobTitle: 'Analista de Sistemas - Fulano de Tal',
  countryAlpha2: 'BR',
  countryAlpha3: 'BRA',
  isManager: true,
};

describe('FieldMappingService', () => {
  const svc = new FieldMappingService();

  it('modo direct lê o atributo do worker', () => {
    expect(svc.resolve(worker, { mode: 'direct', source: 'descriptor' })).toBe('Fulano de Tal');
  });

  it('modo default retorna o valor fixo', () => {
    expect(svc.resolve(worker, { mode: 'default', value: 'DEFAULT' })).toBe('DEFAULT');
  });

  it('modo lookup retorna undefined (resolvido externamente)', () => {
    expect(svc.resolve(worker, { mode: 'lookup', lookup: 'cnpj' })).toBeUndefined();
  });

  it('transform trimJobTitle remove o sufixo do nome', () => {
    expect(
      svc.resolve(worker, { mode: 'direct', source: 'jobTitle', transform: 'trimJobTitle' }),
    ).toBe('Analista de Sistemas');
  });

  it('transform alpha3ToAlpha2 converte país', () => {
    expect(
      svc.resolve(worker, { mode: 'direct', source: 'countryAlpha3', transform: 'alpha3ToAlpha2' }),
    ).toBe('BR');
  });

  it('alpha3ToAlpha2 retorna vazio para país desconhecido', () => {
    const w = { ...worker, countryAlpha3: 'ZZZ' };
    expect(
      svc.resolve(w, { mode: 'direct', source: 'countryAlpha3', transform: 'alpha3ToAlpha2' }),
    ).toBe('');
  });

  it('direct retorna undefined quando a origem não existe', () => {
    expect(svc.resolve(worker, { mode: 'direct', source: 'email' })).toBeUndefined();
  });
});
