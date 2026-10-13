import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const DB_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5433', 10),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'postgres',
  password: process.env.PGPASSWORD || '',
};

test('PostgreSQL Staging Security Verification', async (t) => {
  const adminClient = new pg.Client(DB_CONFIG);
  await adminClient.connect();

  // Setup mock auth schema, roles & functions for isolated testing
  await adminClient.query(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE supabase_admin; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
    BEGIN
      RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    END;
    $$ LANGUAGE plpgsql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
    BEGIN
      RETURN COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    END;
    $$ LANGUAGE plpgsql STABLE;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    DROP TABLE IF EXISTS public.intrusion_alerts CASCADE;
    DROP TABLE IF EXISTS public.entry_logs CASCADE;
    DROP TABLE IF EXISTS public.auth_sessions CASCADE;
    DROP TABLE IF EXISTS public.user_music CASCADE;
    DROP TABLE IF EXISTS public.profiles CASCADE;

    CREATE TABLE public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
    );

    CREATE TABLE public.auth_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id TEXT NOT NULL UNIQUE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
    );
  `);

  // Read and apply the actual migration file
  const migrationPath = path.resolve('supabase/migrations/20261012_security_fixes.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  await adminClient.query(migrationSql);

  // Setup trigger for new user creation
  await adminClient.query(`
    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    BEGIN
      INSERT INTO public.profiles (id, display_name, role, is_enabled)
      VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'display_name', pg_catalog.split_part(new.email, '@', 1)),
        'user',
        TRUE
      );
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
  `);

  // -------------------------------------------------------------
  // Test 1: Real concurrent OTP consumption against PostgreSQL
  // -------------------------------------------------------------
  await t.test('Real PostgreSQL concurrency: 10 simultaneous OTP consumptions permit exactly 1 success', async () => {
    const testUserId = '11111111-1111-1111-1111-111111111111';
    const requestId = 'e1a2b3c4-d5e6-4a7b-8c9d-0e1f2a3b4c5d';
    const otpHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    await adminClient.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, 'testuser@example.com') ON CONFLICT DO NOTHING;`,
      [testUserId]
    );
    await adminClient.query(
      `INSERT INTO public.profiles (id, display_name, role, is_enabled) VALUES ($1, 'Test User', 'user', true) ON CONFLICT DO NOTHING;`,
      [testUserId]
    );
    await adminClient.query(
      `DELETE FROM public.auth_sessions WHERE request_id = $1;`,
      [requestId]
    );
    await adminClient.query(
      `INSERT INTO public.auth_sessions (request_id, user_id, otp_hash, expires_at) VALUES ($1, $2, $3, now() + interval '5 minutes');`,
      [requestId, testUserId, otpHash]
    );

    // Create 10 distinct database clients
    const clients = Array.from({ length: 10 }, () => new pg.Client(DB_CONFIG));
    await Promise.all(clients.map(c => c.connect()));

    // Launch all 10 queries concurrently
    const results = await Promise.all(
      clients.map(c =>
        c.query(`SELECT public.consume_door_auth_session($1, $2) AS user_id;`, [requestId, otpHash])
          .then(res => res.rows[0].user_id)
      )
    );

    await Promise.all(clients.map(c => c.end()));

    const successfulConsumptions = results.filter(id => id === testUserId);
    const rejectedConsumptions = results.filter(id => id === null);

    assert.equal(successfulConsumptions.length, 1, 'Exactly one concurrent request must consume the session');
    assert.equal(rejectedConsumptions.length, 9, 'All 9 remaining concurrent requests must return NULL');

    // Subsequent replay request
    const replayRes = await adminClient.query(
      `SELECT public.consume_door_auth_session($1, $2) AS user_id;`,
      [requestId, otpHash]
    );
    assert.equal(replayRes.rows[0].user_id, null, 'Replay of consumed session must return NULL');
  });

  // -------------------------------------------------------------
  // Test 2: Real concurrent administrator demotions against PostgreSQL
  // -------------------------------------------------------------
  await t.test('Real PostgreSQL concurrency: Advisory lock prevents demotion of the last active administrator', async () => {
    const admin1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const admin2Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    await adminClient.query(
      `INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'admin1@example.com'), ($2::uuid, 'admin2@example.com') ON CONFLICT (id) DO NOTHING;`,
      [admin1Id, admin2Id]
    );
    await adminClient.query(
      `INSERT INTO public.profiles (id, display_name, role, is_enabled) VALUES ($1::uuid, 'Admin 1', 'admin', true) ON CONFLICT (id) DO UPDATE SET role = 'admin', is_enabled = true;`,
      [admin1Id]
    );
    await adminClient.query(
      `INSERT INTO public.profiles (id, display_name, role, is_enabled) VALUES ($1::uuid, 'Admin 2', 'admin', true) ON CONFLICT (id) DO UPDATE SET role = 'admin', is_enabled = true;`,
      [admin2Id]
    );

    // Verify initial active admin count
    const initialAdmins = await adminClient.query(
      `SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_enabled = true;`
    );
    assert.equal(parseInt(initialAdmins.rows[0].count, 10), 2);

    // Open two concurrent clients representing Admin 1 and Admin 2
    const client1 = new pg.Client(DB_CONFIG);
    const client2 = new pg.Client(DB_CONFIG);
    await client1.connect();
    await client2.connect();

    // Simultaneously attempt mutually demoting each other
    const [res1, res2] = await Promise.all([
      client1.query(`SELECT success, message FROM public.admin_update_user($1::uuid, $2::uuid, 'user', NULL);`, [admin1Id, admin2Id]),
      client2.query(`SELECT success, message FROM public.admin_update_user($1::uuid, $2::uuid, 'user', NULL);`, [admin2Id, admin1Id]),
    ]);

    await client1.end();
    await client2.end();

    const outcomes = [res1.rows[0], res2.rows[0]];
    const successes = outcomes.filter(o => o.success === true);
    const failures = outcomes.filter(o => o.success === false);

    assert.equal(successes.length, 1, 'Exactly one concurrent demotion must succeed');
    assert.equal(failures.length, 1, 'Exactly one concurrent demotion must be blocked');

    // Verify exactly 1 admin remains active in PostgreSQL
    const finalAdmins = await adminClient.query(
      `SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_enabled = true;`
    );
    assert.equal(parseInt(finalAdmins.rows[0].count, 10), 1, 'Exactly one active administrator must remain');

    // Identify which admin survived
    const survivingAdmin = await adminClient.query(
      `SELECT id FROM public.profiles WHERE role = 'admin' AND is_enabled = true LIMIT 1;`
    );
    const survivingId = survivingAdmin.rows[0].id;
    const demotedId = survivingId === admin1Id ? admin2Id : admin1Id;

    // Now, create a second temporary admin to act as caller, and try to demote the last remaining admin
    const callerAdminId = '99999999-9999-9999-9999-999999999999';
    await adminClient.query(
      `INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'caller@example.com') ON CONFLICT (id) DO NOTHING;`,
      [callerAdminId]
    );
    // Make caller a temporary active admin alongside the surviving admin
    await adminClient.query(
      `INSERT INTO public.profiles (id, display_name, role, is_enabled) VALUES ($1::uuid, 'Caller Admin', 'admin', true) ON CONFLICT (id) DO UPDATE SET role = 'admin', is_enabled = true;`,
      [callerAdminId]
    );

    // Caller demotes the demoted admin again (should not reduce admin count) or demotes surviving admin
    // Then caller tries to demote surviving admin while active admin count is 2 -> succeeds.
    // Now ONLY callerAdmin is left (1 active admin left).
    await adminClient.query(
      `SELECT public.admin_update_user($1::uuid, $2::uuid, 'user', NULL);`,
      [callerAdminId, survivingId]
    );

    // Now active admins count is exactly 1 (callerAdminId)
    // Another user tries to demote callerAdminId (the last active admin)
    // Temporarily create another admin so they have authorization to call, but try to demote callerAdminId when count is 1?
    // Wait, caller cannot demote themselves, and if count is 1:
    const lastAdminRes = await adminClient.query(
      `SELECT success, message FROM public.admin_update_user($1::uuid, $1::uuid, 'user', NULL);`,
      [callerAdminId]
    );
    assert.equal(lastAdminRes.rows[0].success, false);
    assert.match(lastAdminRes.rows[0].message, /Administrators cannot demote themselves/);
  });

  // -------------------------------------------------------------
  // Test 3: Audit profile mutation paths and trigger guards
  // -------------------------------------------------------------
  await t.test('PostgreSQL trigger audit: Direct client modification of role/is_enabled is prohibited', async () => {
    const regularUserId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    await adminClient.query(
      `INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'regular@example.com') ON CONFLICT (id) DO NOTHING;`,
      [regularUserId]
    );
    await adminClient.query(
      `INSERT INTO public.profiles (id, display_name, role, is_enabled) VALUES ($1::uuid, 'Regular User', 'user', true) ON CONFLICT (id) DO UPDATE SET role = 'user', is_enabled = true;`,
      [regularUserId]
    );

    const userClient = new pg.Client(DB_CONFIG);
    await userClient.connect();

    // Simulate authenticated client context
    await userClient.query(`SET request.jwt.claim.sub = '${regularUserId}';`);
    await userClient.query(`SET request.jwt.claim.role = 'authenticated';`);

    // 1. Direct role escalation must be blocked by protect_profile_columns trigger
    await assert.rejects(
      userClient.query(`UPDATE public.profiles SET role = 'admin' WHERE id = $1::uuid;`, [regularUserId]),
      /Direct modification of role and account status is prohibited/
    );

    // 2. Direct account status change must also be blocked
    await assert.rejects(
      userClient.query(`UPDATE public.profiles SET is_enabled = false WHERE id = $1::uuid;`, [regularUserId]),
      /Direct modification of role and account status is prohibited/
    );

    // 3. User CAN legitimately update display_name
    await userClient.query(`UPDATE public.profiles SET display_name = 'My New Name' WHERE id = $1::uuid;`, [regularUserId]);
    const updated = await userClient.query(`SELECT display_name FROM public.profiles WHERE id = $1::uuid;`, [regularUserId]);
    assert.equal(updated.rows[0].display_name, 'My New Name');

    await userClient.end();
  });

  await t.test('PostgreSQL signup flow: handle_new_user trigger succeeds without trigger conflict', async () => {
    const newUserId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

    await adminClient.query(`DELETE FROM public.profiles WHERE id = $1::uuid;`, [newUserId]);
    await adminClient.query(`DELETE FROM auth.users WHERE id = $1::uuid;`, [newUserId]);

    // Simulate new signup in auth.users
    await adminClient.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1::uuid, 'newresident@example.com', '{"display_name": "New Resident"}'::jsonb);`,
      [newUserId]
    );

    const profile = await adminClient.query(`SELECT * FROM public.profiles WHERE id = $1::uuid;`, [newUserId]);
    assert.equal(profile.rows.length, 1);
    assert.equal(profile.rows[0].display_name, 'New Resident');
    assert.equal(profile.rows[0].role, 'user');
    assert.equal(profile.rows[0].is_enabled, true);
  });

  await adminClient.end();
});
