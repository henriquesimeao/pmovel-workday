import { DataSource } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SyncRun, SyncItem, CnpjMapping, SyncCursor } from '../entities';
import { CnpjMappingRepository } from '../cnpj-mapping.repository';
import {
  applyCnpjMappingSeed,
  CnpjMappingSeedError,
  parseCnpjMappingSeed,
} from './cnpj-mapping.seed';

describe('seed do de/para de CNPJ', () => {
  let ds: DataSource;
  let repo: CnpjMappingRepository;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [SyncRun, SyncItem, CnpjMapping, SyncCursor],
    });
    await ds.initialize();
    repo = new CnpjMappingRepository(ds.getRepository(CnpjMapping));
  });

  afterEach(() => ds.destroy());

  const usa = {
    legalEntityId: 'NLE USA',
    legalEntityName: 'Next Level Enterprises (USA)',
    cnpj: '00111111000100',
  };

  describe('parseCnpjMappingSeed', () => {
    it('normaliza o CNPJ (tira a máscara) e assume active = true', () => {
      const [entry] = parseCnpjMappingSeed([
        { ...usa, cnpj: '00.111.111/0001-00' },
      ]);
      expect(entry).toEqual({ ...usa, active: true, currency: null });
    });

    it('aceita empresa sem legalEntityId (chave pelo nome)', () => {
      const [entry] = parseCnpjMappingSeed([
        { legalEntityName: 'Empresa X', cnpj: '12ABC34501DE35' },
      ]);
      expect(entry.legalEntityId).toBeNull();
      expect(entry.cnpj).toBe('12ABC34501DE35');
    });

    it('junta todos os problemas do arquivo numa única mensagem', () => {
      const err = (() => {
        try {
          parseCnpjMappingSeed([
            { legalEntityId: 'A', cnpj: '123' },
            { ...usa, active: 'sim' },
            usa,
          ]);
        } catch (e) {
          return e as CnpjMappingSeedError;
        }
      })();
      expect(err).toBeInstanceOf(CnpjMappingSeedError);
      expect(err!.problems).toEqual([
        'item 1: legalEntityName é obrigatório',
        'item 1 (?): cnpj deve ter 14 letras/números (recebido: "123")',
        'item 2: active deve ser true ou false',
        'item 3: empresa repetida no arquivo (NLE USA)',
      ]);
    });

    it('aceita a moeda (maiúscula) e recusa formato inválido', () => {
      expect(
        parseCnpjMappingSeed([{ ...usa, currency: 'usd' }])[0].currency,
      ).toBe('USD');
      expect(() => parseCnpjMappingSeed([{ ...usa, currency: 'US' }])).toThrow(
        /currency deve ter 3 letras/,
      );
    });

    it('recusa arquivo que não é uma lista', () => {
      expect(() => parseCnpjMappingSeed({ cnpj: 'x' })).toThrow(
        CnpjMappingSeedError,
      );
    });

    it('o arquivo de dev versionado é válido', () => {
      const file = join(
        __dirname,
        '../../../seeds/cnpj-mapping/development.json',
      );
      const entries = parseCnpjMappingSeed(
        JSON.parse(readFileSync(file, 'utf8')),
      );
      expect(entries).toHaveLength(4);
    });
  });

  describe('applyCnpjMappingSeed', () => {
    it('insere, e reaplicar o mesmo arquivo não muda nada (idempotente)', async () => {
      const entries = parseCnpjMappingSeed([usa]);

      const first = await applyCnpjMappingSeed(repo, entries);
      const second = await applyCnpjMappingSeed(repo, entries);

      expect(first.inserted).toHaveLength(1);
      expect(second.inserted).toHaveLength(0);
      expect(second.unchanged).toHaveLength(1);
      expect(await repo.findAll()).toHaveLength(1);
      expect(await repo.resolveCnpj('NLE USA', null)).toBe('00111111000100');
    });

    it('atualiza o CNPJ pela chave, sem duplicar', async () => {
      await applyCnpjMappingSeed(repo, parseCnpjMappingSeed([usa]));

      const result = await applyCnpjMappingSeed(
        repo,
        parseCnpjMappingSeed([{ ...usa, cnpj: '99999999000199' }]),
      );

      expect(result.updated).toHaveLength(1);
      expect(result.updated[0]).toContain('antes:');
      expect(await repo.findAll()).toHaveLength(1);
      expect(await repo.resolveCnpj('NLE USA', null)).toBe('99999999000199');
    });

    it('atualiza a moeda e informa a mudança', async () => {
      await applyCnpjMappingSeed(repo, parseCnpjMappingSeed([usa]));
      const result = await applyCnpjMappingSeed(
        repo,
        parseCnpjMappingSeed([{ ...usa, currency: 'USD' }]),
      );
      expect(result.updated).toHaveLength(1);
      expect((await repo.findActiveByCnpj(usa.cnpj))!.currency).toBe('USD');
    });

    it('active = false desativa o de/para', async () => {
      await applyCnpjMappingSeed(repo, parseCnpjMappingSeed([usa]));
      await applyCnpjMappingSeed(
        repo,
        parseCnpjMappingSeed([{ ...usa, active: false }]),
      );
      expect(await repo.resolveCnpj('NLE USA', null)).toBeNull();
    });

    it('não mexe no que está no banco e fora do arquivo, só informa', async () => {
      await repo.upsert({
        legalEntityId: 'OUTRA',
        legalEntityName: 'Outra Empresa',
        cnpj: '11111111000111',
      });

      const result = await applyCnpjMappingSeed(
        repo,
        parseCnpjMappingSeed([usa]),
      );

      expect(result.notInFile).toEqual(['Outra Empresa → 11111111000111']);
      expect(await repo.resolveCnpj('OUTRA', null)).toBe('11111111000111');
    });

    it('dry-run calcula o resultado sem gravar', async () => {
      const result = await applyCnpjMappingSeed(
        repo,
        parseCnpjMappingSeed([usa]),
        { dryRun: true },
      );
      expect(result.inserted).toHaveLength(1);
      expect(await repo.findAll()).toHaveLength(0);
    });
  });

  it('CnpjMappingRepository.upsert atualiza pela chave em vez de duplicar', async () => {
    await repo.upsert(usa);
    await repo.upsert({ ...usa, cnpj: '22222222000122' });
    await repo.upsert({ legalEntityName: 'Sem Id', cnpj: '33333333000133' });
    await repo.upsert({ legalEntityName: 'Sem Id', cnpj: '44444444000144' });

    const all = await repo.findAll();
    expect(all).toHaveLength(2);
    expect(await repo.resolveCnpj('NLE USA', null)).toBe('22222222000122');
    expect(await repo.resolveCnpj(null, 'Sem Id')).toBe('44444444000144');
  });
});
