import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import pool from '../config/database';

interface Migration {
  name: string;
  path: string;
}

/**
 * Get all migration files from the migrations directory
 */
const getMigrationFiles = (): Migration[] => {
  const migrationsDir = path.join(__dirname, 'migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found');
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => ({
      name: file.replace('.sql', ''),
      path: path.join(migrationsDir, file)
    }));

  return files;
};

/**
 * Check if a migration has already been applied
 */
const isMigrationApplied = async (client: Pool, migrationName: string): Promise<boolean> => {
  const result = await client.query(
    'SELECT 1 FROM schema_migrations WHERE migration_name = $1',
    [migrationName]
  );
  return result.rowCount! > 0;
};

/**
 * Record a migration as applied
 */
const recordMigration = async (client: Pool, migrationName: string): Promise<void> => {
  await client.query(
    'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
    [migrationName]
  );
};

/**
 * Run all pending migrations
 */
export const runMigrations = async (): Promise<void> => {
  const client = pool;

  try {
    console.log('Starting database migrations...');

    // Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const migrations = getMigrationFiles();
    
    if (migrations.length === 0) {
      console.log('No migrations found');
      return;
    }

    for (const migration of migrations) {
      const applied = await isMigrationApplied(client, migration.name);
      
      if (applied) {
        console.log(`✓ Migration ${migration.name} already applied`);
        continue;
      }

      console.log(`Running migration: ${migration.name}`);
      
      const sql = fs.readFileSync(migration.path, 'utf8');
      
      // Execute migration in a transaction
      await client.query('BEGIN');
      
      try {
        await client.query(sql);
        await recordMigration(client, migration.name);
        await client.query('COMMIT');
        console.log(`✓ Migration ${migration.name} completed successfully`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
};

/**
 * Run migrations if this file is executed directly
 */
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migration process completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration process failed:', error);
      process.exit(1);
    });
}
