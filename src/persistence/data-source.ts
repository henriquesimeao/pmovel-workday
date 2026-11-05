import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SyncRun, SyncItem, CnpjMapping, SyncCursor } from './entities';

/**
 * DataSource do TypeORM para o CLI de migrations (`npm run migration:*`).
 *
 * Lê as variáveis do ambiente (carregadas via `node --env-file=.env`). Em
 * produção NÃO usamos `synchronize`: o schema é versionado em migrations.
 */
export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [SyncRun, SyncItem, CnpjMapping, SyncCursor],
  migrations: ['src/persistence/migrations/*.ts'],
  synchronize: false,
  logging: false,
});
