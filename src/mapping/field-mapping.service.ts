import { Injectable } from '@nestjs/common';
import { ConsolidatedWorker } from '../workday/consolidated-worker';
import { FieldMappingRule, TransformName } from './mapping.config';

/** Conversão parcial Alpha-3 → Alpha-2 para países comuns (fallback: vazio). */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  BRA: 'BR',
  USA: 'US',
  ARG: 'AR',
  PRT: 'PT',
  MEX: 'MX',
  CHL: 'CL',
  COL: 'CO',
  URY: 'UY',
  PRY: 'PY',
};

/**
 * Resolve o valor de um campo do Pmovel a partir do worker consolidado,
 * conforme a regra de mapeamento (direct / default / lookup).
 *
 * O modo `lookup` não é resolvido aqui (depende de serviço externo, ex.: CNPJ);
 * o EmployeeMapper trata esse caso. Este serviço cobre `direct` e `default`,
 * aplicando as transformações nomeadas.
 */
@Injectable()
export class FieldMappingService {
  /**
   * @returns o valor resolvido, ou `undefined` quando a origem não existe no
   * worker (campo ausente) — o chamador decide se isso é erro (obrigatório) ou
   * aceitável (opcional).
   */
  resolve(worker: ConsolidatedWorker, rule: FieldMappingRule): unknown {
    switch (rule.mode) {
      case 'default':
        return rule.value;
      case 'direct': {
        const raw = worker[rule.source];
        return rule.transform ? this.applyTransform(rule.transform, raw) : raw;
      }
      case 'lookup':
        // Resolvido externamente (EmployeeMapper). Retorna undefined aqui.
        return undefined;
    }
  }

  private applyTransform(name: TransformName, value: unknown): unknown {
    if (value === null || value === undefined) return value;
    switch (name) {
      case 'alpha3ToAlpha2':
        return ALPHA3_TO_ALPHA2[String(value)] ?? '';
      case 'trimJobTitle':
        // "Analista de Sistemas - Fulano de Tal" -> "Analista de Sistemas"
        return String(value).split(' - ')[0].trim();
    }
  }
}
