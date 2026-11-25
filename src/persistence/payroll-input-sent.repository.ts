import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayrollInputSent } from './entities/payroll-input-sent.entity';

export type PayrollInputSentInput = Omit<
  PayrollInputSent,
  'id' | 'createdAt' | 'updatedAt'
>;

/**
 * Registro de envio da Fase 2 (ver `PayrollInputSent`). Um lançamento por
 * ciclo + colaborador + verba; gravar de novo atualiza o mesmo registro.
 */
@Injectable()
export class PayrollInputSentRepository {
  constructor(
    @InjectRepository(PayrollInputSent)
    private readonly rows: Repository<PayrollInputSent>,
  ) {}

  /** Todos os lançamentos já enviados de um ciclo. */
  findByCycle(cycleId: number): Promise<PayrollInputSent[]> {
    return this.rows.find({ where: { cycleId } });
  }

  /** Lançamento de um colaborador × verba no ciclo, ou `null`. */
  findOne(
    cycleId: number,
    employeeId: number,
    eventCode: string,
  ): Promise<PayrollInputSent | null> {
    return this.rows.findOne({ where: { cycleId, employeeId, eventCode } });
  }

  /** Cria ou atualiza pela chave (ciclo + colaborador + verba). */
  async upsert(input: PayrollInputSentInput): Promise<PayrollInputSent> {
    const existing = await this.findOne(
      input.cycleId,
      input.employeeId,
      input.eventCode,
    );
    return this.rows.save(this.rows.create({ ...(existing ?? {}), ...input }));
  }
}
