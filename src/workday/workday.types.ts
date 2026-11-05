/**
 * Tipos da REST API do Workday.
 *
 * A coleção `common/v1/{tenant}/workers` retorna um worker enxuto (descriptor +
 * id + href). Os dados ricos (cargo, organização/legal entity, datas, dados
 * pessoais) vêm de endpoints de detalhe/expansão e sub-recursos, cuja estrutura
 * exata é mapeada na Task 4 (descoberta contra o tenant real).
 *
 * Por isso o detalhe do worker é tipado de forma aberta por ora
 * (`WorkerDetail` = registro arbitrário), e será refinado quando o de/para
 * estiver fechado.
 */

/** Referência genérica do Workday (aparece em quase todo recurso). */
export interface WorkdayInstanceRef {
  id: string;
  descriptor?: string;
  href?: string;
}

/** Item da coleção de workers (forma enxuta). */
export interface WorkerSummary extends WorkdayInstanceRef {
  descriptor: string;
}

/** Página de uma coleção REST do Workday. */
export interface WorkdayCollection<T> {
  total: number;
  data: T[];
}

/**
 * Detalhe do worker. Estrutura aberta até a Task 4 refinar os campos efetivos
 * (primaryJob, organizações, hire/termination dates, dados pessoais, etc.).
 */
export type WorkerDetail = Record<string, unknown>;
