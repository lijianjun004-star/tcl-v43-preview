/** Local PostgreSQL-in-WASM only. auth.* and storage.* are test doubles, not CloudBase. */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
export const scope = 'localPGmock-auth';
export async function createDatabase(dataDir = 'memory://') {
  const db = new PGlite(dataDir, { extensions: { pgcrypto } });
  await db.waitReady;
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'') $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
      owner uuid, owner_id text, metadata jsonb DEFAULT '{}'::jsonb,
      path_tokens text[] GENERATED ALWAYS AS (string_to_array(name,'/')) STORED,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      UNIQUE(bucket_id,name)
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects,storage.buckets TO anon, authenticated;
    CREATE POLICY local_mock_existing_objects ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
    CREATE POLICY local_mock_existing_buckets ON storage.buckets FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
  `);
  return db;
}
export async function withIdentity(db, { uid='', role='authenticated' }, fn) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [uid,role]);
  await db.exec(`SET ROLE ${role === 'authenticated' ? 'authenticated' : role === 'service_role' ? 'service_role' : 'anon'}`);
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}
