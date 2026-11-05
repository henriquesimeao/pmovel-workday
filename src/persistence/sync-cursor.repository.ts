import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncCursor } from './entities/sync-cursor.entity';

/**
 * Acesso ao cursor de sincronização (diffs por job).
 */
@Injectable()
export class SyncCursorRepository {
  constructor(
    @InjectRepository(SyncCursor)
    private readonly cursors: Repository<SyncCursor>,
  ) {}

  /** Lê o cursor de um job, ou null se nunca executou. */
  find(jobKey: string): Promise<SyncCursor | null> {
    return this.cursors.findOne({ where: { jobKey } });
  }

  /** Data da última execução bem-sucedida (ou null). */
  async getLastRunAt(jobKey: string): Promise<Date | null> {
    const cursor = await this.find(jobKey);
    return cursor?.lastRunAt ?? null;
  }

  /** Atualiza (upsert) o cursor de um job. */
  async save(jobKey: string, lastRunAt: Date, lastValue?: string | null): Promise<void> {
    await this.cursors.save({ jobKey, lastRunAt, lastValue: lastValue ?? null });
  }
}
