import { CnpjMappingRepository } from '../cnpj-mapping.repository';

/** Uma linha do arquivo de seed (`seeds/cnpj-mapping/<ambiente>.json`). */
export interface CnpjMappingSeedEntry {
  /** Id da empresa no Workday (`company_ID`, ou o id interno quando não há). */
  legalEntityId: string | null;
  /** Nome da empresa no Workday (chave quando não há id). */
  legalEntityName: string;
  /** CNPJ do cliente no Pmovel: 14 letras/números (aceita máscara). */
  cnpj: string;
  active: boolean;
  /** Moeda ISO 4217 (ex.: `BRL`), usada nos lançamentos da Fase 2. */
  currency: string | null;
}

export interface CnpjMappingSeedResult {
  inserted: string[];
  updated: string[];
  unchanged: string[];
  /** De/para que existem no banco e não estão no arquivo (não são alterados). */
  notInFile: string[];
}

/** Erro de validação do arquivo de seed (nada é gravado). */
export class CnpjMappingSeedError extends Error {
  constructor(readonly problems: string[]) {
    super(`arquivo de seed inválido:\n- ${problems.join('\n- ')}`);
    this.name = 'CnpjMappingSeedError';
  }
}

/** CNPJ só com letras e números, maiúsculo (aceita o CNPJ alfanumérico). */
function normalizeCnpj(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function keyOf(e: { legalEntityId: string | null; legalEntityName: string }) {
  return e.legalEntityId ?? `nome:${e.legalEntityName}`;
}

/**
 * Valida o conteúdo do arquivo e devolve as linhas normalizadas. Junta todos
 * os problemas antes de falhar, para corrigir o arquivo de uma vez.
 */
export function parseCnpjMappingSeed(data: unknown): CnpjMappingSeedEntry[] {
  if (!Array.isArray(data)) {
    throw new CnpjMappingSeedError(['o arquivo deve conter uma lista (array)']);
  }

  const problems: string[] = [];
  const entries: CnpjMappingSeedEntry[] = [];
  const seen = new Set<string>();

  data.forEach((raw: unknown, i) => {
    const where = `item ${i + 1}`;
    if (!raw || typeof raw !== 'object') {
      problems.push(`${where}: deve ser um objeto`);
      return;
    }
    const r = raw as Record<string, unknown>;

    const name =
      typeof r.legalEntityName === 'string' ? r.legalEntityName.trim() : '';
    if (!name) problems.push(`${where}: legalEntityName é obrigatório`);

    let legalEntityId: string | null = null;
    if (r.legalEntityId !== undefined && r.legalEntityId !== null) {
      if (typeof r.legalEntityId !== 'string' || !r.legalEntityId.trim()) {
        problems.push(`${where}: legalEntityId deve ser texto ou null`);
      } else {
        legalEntityId = r.legalEntityId.trim();
      }
    }

    const cnpj = typeof r.cnpj === 'string' ? normalizeCnpj(r.cnpj) : '';
    if (!/^[A-Z0-9]{14}$/.test(cnpj)) {
      problems.push(
        `${where} (${name || '?'}): cnpj deve ter 14 letras/números (recebido: ${JSON.stringify(r.cnpj)})`,
      );
    }

    if (r.active !== undefined && typeof r.active !== 'boolean') {
      problems.push(`${where}: active deve ser true ou false`);
    }

    let currency: string | null = null;
    if (r.currency !== undefined && r.currency !== null) {
      currency =
        typeof r.currency === 'string' ? r.currency.trim().toUpperCase() : '';
      if (!/^[A-Z]{3}$/.test(currency)) {
        problems.push(
          `${where} (${name || '?'}): currency deve ter 3 letras, ISO 4217 (recebido: ${JSON.stringify(r.currency)})`,
        );
      }
    }

    const entry: CnpjMappingSeedEntry = {
      legalEntityId,
      legalEntityName: name,
      cnpj,
      active: r.active === undefined ? true : r.active === true,
      currency,
    };
    const key = keyOf(entry);
    if (name && seen.has(key)) {
      problems.push(`${where}: empresa repetida no arquivo (${key})`);
    }
    seen.add(key);
    entries.push(entry);
  });

  if (problems.length) throw new CnpjMappingSeedError(problems);
  return entries;
}

/**
 * Aplica o seed: insere o que falta e atualiza o que mudou, pela chave
 * (`legalEntityId`, ou o nome quando não há id). Nunca apaga nem desativa o
 * que não está no arquivo: só informa em `notInFile`. Com `dryRun`, só
 * calcula o resultado.
 */
export async function applyCnpjMappingSeed(
  repo: CnpjMappingRepository,
  entries: CnpjMappingSeedEntry[],
  options: { dryRun?: boolean } = {},
): Promise<CnpjMappingSeedResult> {
  const result: CnpjMappingSeedResult = {
    inserted: [],
    updated: [],
    unchanged: [],
    notInFile: [],
  };

  for (const entry of entries) {
    const label = `${entry.legalEntityName} → ${entry.cnpj}${entry.currency ? ` ${entry.currency}` : ''}`;
    const existing = await repo.findByKey(
      entry.legalEntityId,
      entry.legalEntityName,
    );
    if (!existing) {
      result.inserted.push(label);
    } else if (
      existing.legalEntityName !== entry.legalEntityName ||
      existing.cnpj !== entry.cnpj ||
      existing.active !== entry.active ||
      (existing.currency ?? null) !== entry.currency
    ) {
      result.updated.push(
        `${label} (antes: ${existing.legalEntityName} → ${existing.cnpj}${existing.currency ? ` ${existing.currency}` : ''}${existing.active ? '' : ', inativo'})`,
      );
    } else {
      result.unchanged.push(label);
      continue;
    }
    if (!options.dryRun) await repo.upsert(entry);
  }

  const keys = new Set(entries.map(keyOf));
  for (const row of await repo.findAll()) {
    if (!keys.has(keyOf(row))) {
      result.notInFile.push(
        `${row.legalEntityName} → ${row.cnpj}${row.active ? '' : ' (inativo)'}`,
      );
    }
  }
  return result;
}
