import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database-options';

config({ path: resolve(process.cwd(), '../../.env') });

export default new DataSource(databaseOptions(process.env));
