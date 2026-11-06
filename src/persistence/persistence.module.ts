import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { SyncRun, SyncItem, CnpjMapping, SyncCursor } from './entities';
import { SyncRunRepository } from './sync-run.repository';
import { SyncCursorRepository } from './sync-cursor.repository';
import { CnpjMappingRepository } from './cnpj-mapping.repository';

const ENTITIES = [SyncRun, SyncItem, CnpjMapping, SyncCursor];
const REPOSITORIES = [
  SyncRunRepository,
  SyncCursorRepository,
  CnpjMappingRepository,
];

/**
 * Módulo de persistência (MySQL via TypeORM).
 *
 * - Conexão configurada a partir do AppConfigService (DB_*).
 * - `synchronize: false` — o schema é versionado em migrations
 *   (`npm run migration:run`). Em desenvolvimento, pode-se ligar via env, mas o
 *   default é migrations para espelhar produção.
 * - Exporta os repositórios de domínio para os demais módulos.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const db = config.database;
        return {
          type: 'mysql' as const,
          host: db.host,
          port: db.port,
          username: db.user,
          password: db.password,
          database: db.name,
          entities: ENTITIES,
          synchronize: false,
          migrationsRun: false,
        };
      },
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  providers: REPOSITORIES,
  exports: [...REPOSITORIES, TypeOrmModule],
})
export class PersistenceModule {}
