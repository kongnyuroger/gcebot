import { config } from 'dotenv';
import { resolve } from 'path';

// These tests hit the real Postgres/Redis started by docker-compose, so they need
// the same .env the app itself uses (DATABASE_URL, REDIS_URL).
config({ path: resolve(__dirname, '../../../.env') });
