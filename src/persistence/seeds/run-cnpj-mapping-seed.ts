import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { AppDataSource } from '../data-source';
import { CnpjMapping } from '../entities';
import { CnpjMappingRepository } from '../cnpj-mapping.repository';
import {
  applyCnpjMappingSeed,
  CnpjMappingSeedError,
  parseCnpjMappingSeed,
} from './cnpj-mapping.seed';

/**
 * Aplica o de/para de CNPJ de um arquivo JSON versionado no banco do
 * integrador (tabela `cnpj_mapping`).
 *
 *   npm run seed:cnpj -- seeds/cnpj-mapping/development.json [--dry-run]
 *
 * Em produção (sem .env, a partir do build):
 *   node dist/persistence/seeds/run-cnpj-mapping-seed.js seeds/cnpj-mapping/production.json
 *
 * Lê a conexão das variáveis DB_* do ambiente. Valida o arquivo inteiro antes
 * de gravar e grava tudo numa transação.
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error(
      'uso: npm run seed:cnpj -- <arquivo.json> [--dry-run]\n' +
        'ex.: npm run seed:cnpj -- seeds/cnpj-mapping/development.json',
    );
    return 2;
  }

  let entries;
  try {
    entries = parseCnpjMappingSeed(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    const message =
      e instanceof CnpjMappingSeedError || e instanceof Error
        ? e.message
        : String(e);
    console.error(`${file}: ${message}`);
    return 1;
  }

  await AppDataSource.initialize();
  try {
    const result = await AppDataSource.transaction((manager) =>
      applyCnpjMappingSeed(
        new CnpjMappingRepository(manager.getRepository(CnpjMapping)),
        entries,
        { dryRun },
      ),
    );

    const db = `${process.env.DB_HOST ?? 'localhost'}/${process.env.DB_NAME}`;
    console.log(
      `${dryRun ? '[dry-run, nada gravado] ' : ''}seed ${file} → ${db}`,
    );
    const section = (title: string, items: string[]) => {
      console.log(`${title}: ${items.length}`);
      for (const item of items) console.log(`  - ${item}`);
    };
    section('inseridos', result.inserted);
    section('atualizados', result.updated);
    section('sem mudança', result.unchanged);
    section('no banco e fora do arquivo (mantidos)', result.notInFile);
    return 0;
  } finally {
    await AppDataSource.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
