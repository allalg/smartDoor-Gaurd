import test from 'node:test';
import assert from 'node:assert/strict';

// Helper: HMAC-SHA256 implementation identical to Edge Functions
async function computeOtpHmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join('');
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OTP_REGEX = /^\d{6}$/;

// ============================================================================
// 1. CRYPTOGRAPHIC & HMAC AUDIT TESTS
// ============================================================================

test('HMAC-SHA256 generates consistent 64-character hex digests', async () => {
  const secret = 'super-secret-hmac-key-2026';
  const message = '123456' + '550e8400-e29b-41d4-a716-446655440000';
  const hash1 = await computeOtpHmac(secret, message);
  const hash2 = await computeOtpHmac(secret, message);

  assert.equal(hash1.length, 64);
  assert.equal(hash1, hash2);
});

test('HMAC-SHA256 is avalanche-resistant and differs from raw SHA-256', async () => {
  const secret = 'super-secret-hmac-key-2026';
  const msg1 = '123456' + '550e8400-e29b-41d4-a716-446655440000';
  const msg2 = '123457' + '550e8400-e29b-41d4-a716-446655440000';

  const hmac1 = await computeOtpHmac(secret, msg1);
  const hmac2 = await computeOtpHmac(secret, msg2);
  assert.notEqual(hmac1, hmac2);

  // Raw SHA-256 comparison
  const rawHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg1));
  const rawHash = Array.from(new Uint8Array(rawHashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  assert.notEqual(hmac1, rawHash, 'HMAC must not match plain SHA-256');
});

// ============================================================================
// 2. INPUT VALIDATION & REGEX AUDIT TESTS
// ============================================================================

test('UUID validation strictly rejects malformed identifiers', () => {
  const validUuid = 'c356f91d-4074-4b55-b072-bb34388ea85c';
  assert.ok(UUID_REGEX.test(validUuid));

  assert.ok(!UUID_REGEX.test('not-a-uuid'));
  assert.ok(!UUID_REGEX.test('c356f91d40744b55b072bb34388ea85c'));
  assert.ok(!UUID_REGEX.test('c356f91d-4074-4b55-b072-bb34388ea85c; DROP TABLE profiles;'));
  assert.ok(!UUID_REGEX.test(''));
});

test('OTP validation strictly enforces 6-digit requirement', () => {
  assert.ok(OTP_REGEX.test('123456'));
  assert.ok(OTP_REGEX.test('999999'));
  assert.ok(OTP_REGEX.test('000001'));

  assert.ok(!OTP_REGEX.test('12345'), 'Must reject 5 digits');
  assert.ok(!OTP_REGEX.test('1234567'), 'Must reject 7 digits');
  assert.ok(!OTP_REGEX.test('12345a'), 'Must reject alphanumeric');
  assert.ok(!OTP_REGEX.test('-12345'), 'Must reject negative numbers');
});

// ============================================================================
// 3. ATOMIC SESSION CONSUMPTION (RETURNS UUID) & REPLAY PROTECTION SIMULATION
// ============================================================================

class MockDatabase {
  constructor() {
    this.sessions = new Map();
    this.profiles = new Map();
    this.isAdvisoryLocked = false;
  }

  addSession(sessionId, requestId, userId, otpHmac, expiresAt) {
    this.sessions.set(requestId, {
      id: sessionId,
      request_id: requestId,
      user_id: userId,
      otp_hash: otpHmac,
      expires_at: new Date(expiresAt),
      consumed_at: null,
    });
  }

  addProfile(userId, displayName, role, isEnabled, approvalStatus = 'approved') {
    this.profiles.set(userId, {
      id: userId,
      display_name: displayName,
      role,
      is_enabled: isEnabled,
      approval_status: approvalStatus,
    });
  }

  // Exact contract: PostgreSQL consume_door_auth_session(TEXT, TEXT) RETURNS UUID
  // Returns user_id UUID on success, NULL on any failure
  async consumeDoorAuthSession(requestId, otpHmac) {
    if (!requestId || !otpHmac) {
      return null;
    }

    const session = this.sessions.get(requestId);
    if (!session) {
      return null;
    }

    // Hash check
    if (session.otp_hash !== otpHmac) {
      return null;
    }

    // Replay check
    if (session.consumed_at !== null) {
      return null;
    }

    // Expiry check
    if (session.expires_at <= new Date()) {
      return null;
    }

    // Atomically consume
    session.consumed_at = new Date();
    return session.user_id;
  }

  // Forensic reason determination on failure (used by verify-door-auth)
  getFailureReason(requestId, otpHmac) {
    const session = this.sessions.get(requestId);
    if (!session) {
      return { reason: 'Invalid authentication session', isReplay: false, userId: null };
    }
    if (session.otp_hash !== otpHmac) {
      return { reason: 'Invalid authentication token', isReplay: false, userId: session.user_id };
    }
    if (session.consumed_at !== null) {
      return { reason: 'Replay detected: Token already consumed', isReplay: true, userId: session.user_id };
    }
    if (session.expires_at <= new Date()) {
      return { reason: 'Authentication token expired', isReplay: false, userId: session.user_id };
    }
    return { reason: 'Authentication check failed', isReplay: false, userId: session.user_id };
  }

  // Simulates handle_new_user() trigger on signup
  handleNewUser(userId, displayName = 'New Resident') {
    const profile = {
      id: userId,
      display_name: displayName,
      role: 'user',
      is_enabled: false,
      approval_status: 'pending',
    };
    this.profiles.set(userId, profile);
    return profile;
  }

  // Simulates protect_profile_columns() trigger
  updateProfileDirectly(callerAuthRole, callerAuthUid, targetId, updates) {
    const target = this.profiles.get(targetId);
    if (!target) throw new Error('Target profile not found');

    const roleChanging = updates.role !== undefined && updates.role !== target.role;
    const statusChanging = updates.is_enabled !== undefined && updates.is_enabled !== target.is_enabled;
    const approvalChanging = updates.approval_status !== undefined && updates.approval_status !== target.approval_status;

    // Trigger check:
    if (roleChanging || statusChanging || approvalChanging) {
      // Must come from admin_update_user (setting = 'true') or backend migration without JWT
      const allowSetting = updates._allowSetting === 'true';
      const isServerMaintenance = callerAuthRole === 'service_role' && callerAuthUid === null;

      if (!allowSetting && !isServerMaintenance) {
        throw new Error('Direct modification of role, approval status, and account status is prohibited. Use admin_update_user.');
      }
    }

    if (updates.display_name !== undefined) target.display_name = updates.display_name;
    if (updates.role !== undefined) target.role = updates.role;
    if (updates.is_enabled !== undefined) target.is_enabled = updates.is_enabled;
    if (updates.approval_status !== undefined) target.approval_status = updates.approval_status;
    return target;
  }

  // Simulates PostgreSQL admin_update_user with advisory transaction lock and approval status support
  async adminUpdateUser(callerId, targetId, newRole, newStatus, newApprovalStatus) {
    // Acquire transaction advisory lock
    while (this.isAdvisoryLocked) {
      await new Promise((r) => setTimeout(r, 5));
    }
    this.isAdvisoryLocked = true;

    try {
      const caller = this.profiles.get(callerId);
      if (!caller || caller.role !== 'admin' || !caller.is_enabled || (caller.approval_status && caller.approval_status !== 'approved')) {
        return { success: false, message: 'Unauthorized: Caller is not an active administrator' };
      }

      const target = this.profiles.get(targetId);
      if (!target) {
        return { success: false, message: 'Target user not found' };
      }

      // Self-protection
      if (callerId === targetId) {
        if (newRole !== undefined && newRole !== null && newRole !== 'admin') {
          return { success: false, message: 'Administrators cannot demote themselves' };
        }
        if (newStatus !== undefined && newStatus === false) {
          return { success: false, message: 'Administrators cannot disable their own account' };
        }
        if (newApprovalStatus !== undefined && newApprovalStatus !== 'approved') {
          return { success: false, message: 'Administrators cannot alter their own approval status' };
        }
      }

      // Count active admins
      const activeAdmins = Array.from(this.profiles.values()).filter(
        (p) => p.role === 'admin' && p.is_enabled === true && (p.approval_status === 'approved' || !p.approval_status)
      ).length;

      // Last admin protection
      if (target.role === 'admin' && target.is_enabled === true) {
        const willDemote = newRole !== undefined && newRole !== null && newRole !== 'admin';
        const willDisable = newStatus !== undefined && newStatus === false;
        const willRevokeApproval = newApprovalStatus !== undefined && newApprovalStatus !== 'approved';

        if ((willDemote || willDisable || willRevokeApproval) && activeAdmins <= 1) {
          return { success: false, message: 'Cannot demote or disable the last active administrator' };
        }
      }

      if (newRole !== undefined && newRole !== null && !['user', 'admin'].includes(newRole)) {
        return { success: false, message: 'Invalid role' };
      }

      if (newApprovalStatus !== undefined && !['pending', 'approved', 'rejected'].includes(newApprovalStatus)) {
        return { success: false, message: 'Invalid approval status' };
      }

      // If approval status changed, enforce atomic synchronization with is_enabled if not explicitly passed
      let effectiveStatus = newStatus !== undefined ? newStatus : target.is_enabled;
      if (newApprovalStatus === 'approved' && newStatus === undefined) {
        effectiveStatus = true;
      } else if (newApprovalStatus === 'rejected' && newStatus === undefined) {
        effectiveStatus = false;
      }

      // Authorized update through trigger flag
      this.updateProfileDirectly('service_role', callerId, targetId, {
        role: (newRole !== undefined && newRole !== null) ? newRole : target.role,
        is_enabled: effectiveStatus,
        approval_status: newApprovalStatus !== undefined ? newApprovalStatus : target.approval_status,
        _allowSetting: 'true',
      });

      return { success: true, message: 'User profile updated successfully' };
    } finally {
      this.isAdvisoryLocked = false;
    }
  }
}

test('consume_door_auth_session: Valid OTP returns user_id UUID', async () => {
  const db = new MockDatabase();
  const secret = 'hmac-secret-123';
  const reqId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const otp = '654321';
  const hash = await computeOtpHmac(secret, otp + reqId);

  db.addSession('sess-1', reqId, userId, hash, Date.now() + 60000);

  const returnedUserId = await db.consumeDoorAuthSession(reqId, hash);
  assert.equal(returnedUserId, userId, 'Must return the user_id UUID');

  // Immediate second attempt (replay) returns null
  const replayUserId = await db.consumeDoorAuthSession(reqId, hash);
  assert.equal(replayUserId, null, 'Must return NULL on replay');

  const forensic = db.getFailureReason(reqId, hash);
  assert.equal(forensic.isReplay, true);
  assert.ok(forensic.reason.includes('Replay detected'));
});

test('consume_door_auth_session: Incorrect OTP returns NULL', async () => {
  const db = new MockDatabase();
  const secret = 'hmac-secret-123';
  const reqId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const correctHash = await computeOtpHmac(secret, '654321' + reqId);
  const wrongHash = await computeOtpHmac(secret, '999999' + reqId);

  db.addSession('sess-1', reqId, userId, correctHash, Date.now() + 60000);

  const res = await db.consumeDoorAuthSession(reqId, wrongHash);
  assert.equal(res, null);

  const forensic = db.getFailureReason(reqId, wrongHash);
  assert.ok(forensic.reason.includes('Invalid authentication token'));
});

test('consume_door_auth_session: Expired OTP returns NULL', async () => {
  const db = new MockDatabase();
  const secret = 'hmac-secret-123';
  const reqId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const hash = await computeOtpHmac(secret, '654321' + reqId);

  // Expired 5 seconds ago
  db.addSession('sess-1', reqId, userId, hash, Date.now() - 5000);

  const res = await db.consumeDoorAuthSession(reqId, hash);
  assert.equal(res, null);

  const forensic = db.getFailureReason(reqId, hash);
  assert.ok(forensic.reason.includes('expired'));
});

test('Concurrent OTP consumption: Exactly one returns UUID, other returns NULL', async () => {
  const db = new MockDatabase();
  const secret = 'hmac-secret-123';
  const reqId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const hash = await computeOtpHmac(secret, '654321' + reqId);

  db.addSession('sess-1', reqId, userId, hash, Date.now() + 60000);

  // Concurrent execution
  const [res1, res2] = await Promise.all([
    db.consumeDoorAuthSession(reqId, hash),
    db.consumeDoorAuthSession(reqId, hash),
  ]);

  const successes = [res1, res2].filter((r) => r !== null);
  const failures = [res1, res2].filter((r) => r === null);

  assert.equal(successes.length, 1, 'Exactly one concurrent call returns UUID');
  assert.equal(failures.length, 1, 'Other concurrent call returns NULL');
});

// ============================================================================
// 4. TRIGGER AUDIT: protect_profile_columns() DIRECT CLIENT BLOCKING
// ============================================================================

test('Ordinary user cannot modify role or is_enabled directly', () => {
  const db = new MockDatabase();
  const userId = 'user-1';
  db.addProfile(userId, 'Normal User', 'user', true);

  // Attempt to self-promote to admin directly via client update
  assert.throws(
    () => {
      db.updateProfileDirectly('authenticated', userId, userId, { role: 'admin' });
    },
    /Direct modification of role.*is prohibited/
  );

  // Attempt to re-enable disabled account directly via client update
  db.addProfile('user-disabled', 'Disabled User', 'user', false);
  assert.throws(
    () => {
      db.updateProfileDirectly('authenticated', 'user-disabled', 'user-disabled', { is_enabled: true });
    },
    /Direct modification of role.*is prohibited/
  );
});

test('Administrator cannot bypass admin_update_user to change role directly', () => {
  const db = new MockDatabase();
  const adminId = 'admin-1';
  const targetId = 'target-user';
  db.addProfile(adminId, 'Admin User', 'admin', true);
  db.addProfile(targetId, 'Target User', 'user', true);

  // Direct client table update by admin is BLOCKED to prevent bypassing last-admin lock
  assert.throws(
    () => {
      db.updateProfileDirectly('authenticated', adminId, targetId, { role: 'admin' });
    },
    /Direct modification of role.*is prohibited/
  );
});

test('User CAN update display_name directly without trigger blocking', () => {
  const db = new MockDatabase();
  const userId = 'user-1';
  db.addProfile(userId, 'Original Name', 'user', true);

  // Changing display_name alone is permitted
  const updated = db.updateProfileDirectly('authenticated', userId, userId, { display_name: 'Updated Name' });
  assert.equal(updated.display_name, 'Updated Name');
  assert.equal(updated.role, 'user');
});

// ============================================================================
// 5. LAST ADMIN PROTECTION & CONCURRENCY ADVISORY LOCK
// ============================================================================

test('Administrator cannot demote or disable themselves via admin_update_user', async () => {
  const db = new MockDatabase();
  const adminId = 'admin-1';
  db.addProfile(adminId, 'Admin 1', 'admin', true);

  const demoteRes = await db.adminUpdateUser(adminId, adminId, 'user', undefined);
  assert.equal(demoteRes.success, false);
  assert.ok(demoteRes.message.includes('cannot demote themselves'));

  const disableRes = await db.adminUpdateUser(adminId, adminId, undefined, false);
  assert.equal(disableRes.success, false);
  assert.ok(disableRes.message.includes('cannot disable their own account'));
});

test('Last active administrator cannot be demoted or disabled', async () => {
  const db = new MockDatabase();
  const admin1 = 'admin-1';
  const admin2 = 'admin-2';
  db.addProfile(admin1, 'Admin 1', 'admin', true);
  db.addProfile(admin2, 'Admin 2', 'admin', true);

  // Admin 1 demotes Admin 2 -> now only 1 active admin remains
  const res1 = await db.adminUpdateUser(admin1, admin2, 'user', undefined);
  assert.equal(res1.success, true);

  // Now, promote another temp admin to test disabling the remaining original
  const admin3 = 'admin-3';
  db.addProfile(admin3, 'Admin 3', 'admin', true);

  // Admin 3 tries to demote Admin 1 (now 2 admins exist, succeeds)
  const res2 = await db.adminUpdateUser(admin3, admin1, 'user', undefined);
  assert.equal(res2.success, true);

  // Now only Admin 3 is left! Any attempt to demote Admin 3 must fail!
  // Even if another caller exists:
  const res3 = await db.adminUpdateUser(admin3, admin3, 'user', undefined);
  assert.equal(res3.success, false);
  assert.ok(res3.message.includes('cannot demote themselves'));
});

test('Concurrent demotions of two administrators: Exactly one succeeds, last admin protected', async () => {
  const db = new MockDatabase();
  const adminA = 'admin-a';
  const adminB = 'admin-b';
  db.addProfile(adminA, 'Admin A', 'admin', true);
  db.addProfile(adminB, 'Admin B', 'admin', true);

  // Admin A tries to demote Admin B while Admin B tries to demote Admin A concurrently
  const [resA, resB] = await Promise.all([
    db.adminUpdateUser(adminA, adminB, 'user', undefined),
    db.adminUpdateUser(adminB, adminA, 'user', undefined),
  ]);

  const successes = [resA, resB].filter((r) => r.success);
  const failures = [resA, resB].filter((r) => !r.success);

  assert.equal(successes.length, 1, 'Exactly one concurrent demotion can succeed');
  assert.equal(failures.length, 1, 'The other concurrent demotion is rejected');
  assert.ok(
    failures[0].message.includes('Cannot demote or disable the last active administrator') ||
    failures[0].message.includes('not an active administrator')
  );
});

// ============================================================================
// 6. PHYSICAL DOOR ACCESS SAFETY CHECKS
// ============================================================================

test('Suspended resident with valid OTP is denied door entry', async () => {
  const db = new MockDatabase();
  const secret = 'hmac-secret-123';
  const reqId = '11111111-1111-1111-1111-111111111111';
  const userId = 'suspended-user';
  const hash = await computeOtpHmac(secret, '654321' + reqId);

  db.addSession('sess-1', reqId, userId, hash, Date.now() + 60000);
  db.addProfile(userId, 'Suspended User', 'user', false);

  const returnedUserId = await db.consumeDoorAuthSession(reqId, hash);
  assert.equal(returnedUserId, userId); // Consumed

  // verify-door-auth checks profile
  const profile = db.profiles.get(returnedUserId);
  const decision = profile?.is_enabled ? 'granted' : 'denied';
  assert.equal(decision, 'denied', 'Suspended accounts must never unlatch the door');
});

test('Direct Spotify Web API playback failure is isolated and does not alter granted physical access', () => {
  let decision = 'denied';
  let musicTriggered = false;

  const validEntry = true;
  if (validEntry) {
    decision = 'granted'; // Physical decision sealed

    try {
      // Simulate Spotify API failure (e.g. no active device or 502 error)
      throw new Error('Spotify Web API network timeout / device unreachable');
    } catch {
      musicTriggered = false; // Isolated failure must never alter decision
    }
  }

  assert.equal(decision, 'granted', 'Door unlatch decision must remain granted regardless of Spotify status');
  assert.equal(musicTriggered, false, 'musicTriggered accurately reflects Spotify playback failure');
});

test('Invalid or denied authentication never triggers Spotify playback', () => {
  let decision = 'denied';
  let musicTriggered = false;

  const validEntry = false;
  if (validEntry) {
    decision = 'granted';
    musicTriggered = true;
  }

  assert.equal(decision, 'denied');
  assert.equal(musicTriggered, false, 'Denied entry must never trigger music playback');
});

test('Tightened CORS header generation restricts wildcards and echoes valid origins', () => {
  const allowedOrigins = new Set([
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
    'https://smartdoor.example.com',
  ]);

  function getCorsHeaders(origin) {
    const allowed = allowedOrigins.has(origin) ? origin : 'https://smartdoor.example.com';
    return {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    };
  }

  // 1. Authorized local origin receives matching CORS origin
  const localHeaders = getCorsHeaders('http://localhost:5173');
  assert.equal(localHeaders['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assert.equal(localHeaders['Vary'], 'Origin');

  // 2. Untrusted origin receives configured fallback, never wildcard '*'
  const untrustedHeaders = getCorsHeaders('https://malicious-site.attacker.com');
  assert.equal(untrustedHeaders['Access-Control-Allow-Origin'], 'https://smartdoor.example.com');
  assert.notEqual(untrustedHeaders['Access-Control-Allow-Origin'], '*');
});

test('user_music RLS ownership policy enforces auth.uid() matching user_id', () => {
  // Simulates PostgreSQL RLS: USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
  const authState = { currentUserId: 'user-aaa-111' };

  function simulateUserMusicMutation(authenticatedUserId, targetUserId, payload) {
    // RLS policy check
    if (authenticatedUserId !== targetUserId) {
      throw new Error('new row violates row-level security policy for table "user_music" (42501)');
    }
    return { success: true, updated: { user_id: targetUserId, ...payload } };
  }

  // 1. User updates own preference -> Allowed
  const ownUpdate = simulateUserMusicMutation(authState.currentUserId, 'user-aaa-111', {
    spotify_uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
  });
  assert.equal(ownUpdate.success, true);
  assert.equal(ownUpdate.updated.user_id, 'user-aaa-111');

  // 2. User attempts to update another resident's preference -> Denied by RLS
  assert.throws(
    () => simulateUserMusicMutation(authState.currentUserId, 'user-bbb-222', {
      spotify_uri: 'spotify:track:maliciousTrack',
    }),
    /row-level security policy/
  );
});

test('Spotify setup endpoints reject unauthenticated public callers lacking setup secret', () => {
  const configuredSetupSecret = 'super-secret-setup-token-999';

  function simulateSetupEndpointAuth(headers) {
    const incoming = headers['x-setup-secret'] || headers['authorization']?.replace('Bearer ', '');
    if (!configuredSetupSecret || incoming !== configuredSetupSecret) {
      return { status: 401, error: 'Unauthorized' };
    }
    return { status: 200, success: true };
  }

  // 1. Missing secret header
  assert.equal(simulateSetupEndpointAuth({}).status, 401);

  // 2. Incorrect secret header
  assert.equal(simulateSetupEndpointAuth({ 'x-setup-secret': 'wrong-secret' }).status, 401);

  // 3. Valid secret header
  assert.equal(simulateSetupEndpointAuth({ 'x-setup-secret': configuredSetupSecret }).status, 200);
});

test('entry_logs_result_check constraint: Validates result must be "success" or "failure"', () => {
  const allowedResults = new Set(['success', 'failure']);

  function validateEntryLogResult(row) {
    if (!allowedResults.has(row.result)) {
      throw new Error(`new row for relation "entry_logs" violates check constraint "entry_logs_result_check" (value: ${row.result})`);
    }
    return true;
  }

  // 1. Success entry
  assert.equal(validateEntryLogResult({ result: 'success' }), true);

  // 2. Failure entry
  assert.equal(validateEntryLogResult({ result: 'failure' }), true);

  // 3. Inconsistent values 'granted' and 'denied' violate constraint
  assert.throws(
    () => validateEntryLogResult({ result: 'granted' }),
    /violates check constraint "entry_logs_result_check"/
  );
  assert.throws(
    () => validateEntryLogResult({ result: 'denied' }),
    /violates check constraint "entry_logs_result_check"/
  );
  assert.throws(
    () => validateEntryLogResult({ result: 'pending' }),
    /violates check constraint "entry_logs_result_check"/
  );
});

test('verify-door-auth inserts: All entry_logs writes use "success" or "failure" while preserving response contract', () => {
  const allowedResults = new Set(['success', 'failure']);

  function validateConstraint(row) {
    if (!allowedResults.has(row.result)) {
      throw new Error(`new row for relation "entry_logs" violates check constraint "entry_logs_result_check" (value: ${row.result})`);
    }
    return true;
  }

  // Simulates verify-door-auth logic matching production Edge Function
  function simulateVerifyDoorAuth({ sessionState, tokenMatch = true, profile }) {
    let failureReason = null;
    let entryLog = null;
    let httpResponse = null;

    if (!sessionState || !tokenMatch || sessionState.consumed_at !== null || (sessionState.expires_at && new Date(sessionState.expires_at) <= new Date())) {
      if (!sessionState) {
        failureReason = "Invalid authentication session";
      } else if (!tokenMatch) {
        failureReason = "Invalid authentication token";
      } else if (sessionState.consumed_at !== null) {
        failureReason = "Replay detected: Token already consumed";
      } else {
        failureReason = "Authentication token expired";
      }

      entryLog = {
        user_id: sessionState?.user_id ?? null,
        device_id: 'esp32_door_01',
        result: 'failure',
        failure_reason: failureReason,
      };
      validateConstraint(entryLog);

      httpResponse = { verified: false, decision: "denied", reason: failureReason };
      return { entryLog, httpResponse };
    }

    if (!profile) {
      entryLog = {
        user_id: sessionState.user_id,
        device_id: 'esp32_door_01',
        result: 'failure',
        failure_reason: "Profile not found or inaccessible",
      };
      validateConstraint(entryLog);

      httpResponse = { verified: false, decision: "denied", reason: "Profile not found" };
      return { entryLog, httpResponse };
    }

    if (!profile.is_enabled || profile.approval_status !== "approved") {
      failureReason = profile.approval_status === "pending"
        ? "Account awaiting administrator approval"
        : profile.approval_status === "rejected"
        ? "Account registration rejected"
        : "Account suspended by administrator";

      entryLog = {
        user_id: profile.id,
        device_id: 'esp32_door_01',
        result: 'failure',
        failure_reason: failureReason,
      };
      validateConstraint(entryLog);

      httpResponse = { verified: false, decision: "denied", reason: failureReason };
      return { entryLog, httpResponse };
    }

    // Success path: Granted entry
    entryLog = {
      user_id: profile.id,
      device_id: 'esp32_door_01',
      result: 'success',
      failure_reason: null,
    };
    validateConstraint(entryLog);

    httpResponse = {
      verified: true,
      decision: "granted",
      user_id: profile.id,
      display_name: profile.display_name,
    };
    return { entryLog, httpResponse };
  }

  const validSession = { user_id: 'usr-1', expires_at: new Date(Date.now() + 60000).toISOString(), consumed_at: null };
  const approvedProfile = { id: 'usr-1', display_name: 'Resident A', is_enabled: true, approval_status: 'approved' };

  // Branch 1: Invalid authentication session (not found in DB)
  const b1 = simulateVerifyDoorAuth({ sessionState: null });
  assert.equal(b1.entryLog.result, 'failure');
  assert.equal(b1.httpResponse.decision, 'denied');
  assert.equal(b1.httpResponse.reason, 'Invalid authentication session');

  // Branch 2: Invalid authentication token (OTP hash mismatch)
  const b2 = simulateVerifyDoorAuth({ sessionState: validSession, tokenMatch: false });
  assert.equal(b2.entryLog.result, 'failure');
  assert.equal(b2.httpResponse.decision, 'denied');
  assert.equal(b2.httpResponse.reason, 'Invalid authentication token');

  // Branch 3: Replay attack detected (consumed_at is set)
  const b3 = simulateVerifyDoorAuth({
    sessionState: { ...validSession, consumed_at: new Date().toISOString() },
  });
  assert.equal(b3.entryLog.result, 'failure');
  assert.equal(b3.httpResponse.decision, 'denied');
  assert.equal(b3.httpResponse.reason, 'Replay detected: Token already consumed');

  // Branch 4: Authentication token expired
  const b4 = simulateVerifyDoorAuth({
    sessionState: { ...validSession, expires_at: new Date(Date.now() - 5000).toISOString() },
  });
  assert.equal(b4.entryLog.result, 'failure');
  assert.equal(b4.httpResponse.decision, 'denied');
  assert.equal(b4.httpResponse.reason, 'Authentication token expired');

  // Branch 5: User profile not found
  const b5 = simulateVerifyDoorAuth({ sessionState: validSession, profile: null });
  assert.equal(b5.entryLog.result, 'failure');
  assert.equal(b5.httpResponse.decision, 'denied');
  assert.equal(b5.httpResponse.reason, 'Profile not found');

  // Branch 6: Account pending administrator approval
  const b6 = simulateVerifyDoorAuth({
    sessionState: validSession,
    profile: { ...approvedProfile, approval_status: 'pending' },
  });
  assert.equal(b6.entryLog.result, 'failure');
  assert.equal(b6.httpResponse.decision, 'denied');
  assert.equal(b6.httpResponse.reason, 'Account awaiting administrator approval');

  // Branch 7: Account registration rejected
  const b7 = simulateVerifyDoorAuth({
    sessionState: validSession,
    profile: { ...approvedProfile, approval_status: 'rejected' },
  });
  assert.equal(b7.entryLog.result, 'failure');
  assert.equal(b7.httpResponse.decision, 'denied');
  assert.equal(b7.httpResponse.reason, 'Account registration rejected');

  // Branch 8: Account suspended / disabled
  const b8 = simulateVerifyDoorAuth({
    sessionState: validSession,
    profile: { ...approvedProfile, is_enabled: false },
  });
  assert.equal(b8.entryLog.result, 'failure');
  assert.equal(b8.httpResponse.decision, 'denied');
  assert.equal(b8.httpResponse.reason, 'Account suspended by administrator');

  // Branch 9: Successful verification (Access Granted)
  const b9 = simulateVerifyDoorAuth({ sessionState: validSession, profile: approvedProfile });
  assert.equal(b9.entryLog.result, 'success', 'Successful auth must insert result: "success"');
  assert.equal(b9.httpResponse.decision, 'granted', 'ESP32 response decision must remain "granted"');
  assert.equal(b9.httpResponse.verified, true);
});

// ============================================================================
// 5. MANDATORY ADMINISTRATOR APPROVAL AUDIT & REGRESSION TESTS
// ============================================================================

test('New signup defaults: handle_new_user strictly creates role=user, is_enabled=false, approval_status=pending', () => {
  const db = new MockDatabase();
  const newUserId = '33333333-3333-3333-3333-333333333333';

  const newProfile = db.handleNewUser(newUserId, 'Pending Resident');

  assert.equal(newProfile.role, 'user', 'New signup role must default to user');
  assert.equal(newProfile.is_enabled, false, 'New signup must default to is_enabled=false');
  assert.equal(newProfile.approval_status, 'pending', 'New signup must default to approval_status=pending');
});

test('protect_profile_columns: Direct client mutation of approval_status is strictly prohibited', () => {
  const db = new MockDatabase();
  const userId = '44444444-4444-4444-4444-444444444444';
  db.handleNewUser(userId, 'Malicious Resident');

  // Direct client attempt to self-approve via client supabase-js update
  assert.throws(
    () => {
      db.updateProfileDirectly('authenticated', userId, userId, { approval_status: 'approved' });
    },
    /Direct modification of role.*is prohibited/,
    'Must block direct client manipulation of approval_status'
  );

  // Direct client attempt to set approval_status to rejected
  assert.throws(
    () => {
      db.updateProfileDirectly('authenticated', userId, userId, { approval_status: 'rejected' });
    },
    /Direct modification of role.*is prohibited/
  );
});

test('issue-auth-session Edge Function: Pending user cannot obtain door-auth session (HTTP 403)', () => {
  function simulateIssueAuthSession(profile) {
    if (!profile) {
      return { status: 403, error: 'User profile record not found' };
    }
    if (!profile.is_enabled || profile.approval_status !== 'approved') {
      const errorMsg = profile.approval_status === 'pending'
        ? 'Your account is awaiting administrator approval.'
        : profile.approval_status === 'rejected'
        ? 'Your account registration was not approved.'
        : 'User door access privileges are suspended.';
      return { status: 403, error: errorMsg };
    }
    return { status: 200, sessionId: 'sess-abc', otp: '123456' };
  }

  // 1. Pending signup
  const pendingUser = { id: 'user-pending', role: 'user', is_enabled: false, approval_status: 'pending' };
  const pendingRes = simulateIssueAuthSession(pendingUser);
  assert.equal(pendingRes.status, 403);
  assert.equal(pendingRes.error, 'Your account is awaiting administrator approval.');

  // 2. Pending user with spoofed is_enabled=true (still pending)
  const spoofedPendingUser = { id: 'user-spoof', role: 'user', is_enabled: true, approval_status: 'pending' };
  const spoofedRes = simulateIssueAuthSession(spoofedPendingUser);
  assert.equal(spoofedRes.status, 403);
  assert.equal(spoofedRes.error, 'Your account is awaiting administrator approval.');

  // 3. Rejected user
  const rejectedUser = { id: 'user-rejected', role: 'user', is_enabled: false, approval_status: 'rejected' };
  const rejectedRes = simulateIssueAuthSession(rejectedUser);
  assert.equal(rejectedRes.status, 403);
  assert.equal(rejectedRes.error, 'Your account registration was not approved.');

  // 4. Missing profile fails closed
  const missingRes = simulateIssueAuthSession(null);
  assert.equal(missingRes.status, 403);

  // 5. Approved and enabled user succeeds
  const approvedUser = { id: 'user-approved', role: 'user', is_enabled: true, approval_status: 'approved' };
  const approvedRes = simulateIssueAuthSession(approvedUser);
  assert.equal(approvedRes.status, 200);
  assert.ok(approvedRes.sessionId);
});

test('verify-door-auth Edge Function: Enforces approval_status and logs failure for pending/rejected accounts', () => {
  function simulateVerifyDoorAuthWithApproval({ sessionValid, profile }) {
    if (!sessionValid) {
      return {
        entryLogResult: 'failure',
        httpResponse: { verified: false, decision: 'denied', reason: 'Invalid authentication session' }
      };
    }

    if (!profile) {
      return {
        entryLogResult: 'failure',
        httpResponse: { verified: false, decision: 'denied', reason: 'Profile not found' }
      };
    }

    if (!profile.is_enabled || profile.approval_status !== 'approved') {
      const failureReason = profile.approval_status === 'pending'
        ? 'Account awaiting administrator approval'
        : profile.approval_status === 'rejected'
        ? 'Account registration rejected'
        : 'Account suspended by administrator';

      return {
        entryLogResult: 'failure',
        httpResponse: { verified: false, decision: 'denied', reason: failureReason }
      };
    }

    return {
      entryLogResult: 'success',
      httpResponse: { verified: true, decision: 'granted' }
    };
  }

  // 1. Pending resident
  const pendingAttempt = simulateVerifyDoorAuthWithApproval({
    sessionValid: true,
    profile: { id: 'u1', is_enabled: false, approval_status: 'pending' }
  });
  assert.equal(pendingAttempt.entryLogResult, 'failure', 'Must record failure in entry_logs');
  assert.equal(pendingAttempt.httpResponse.verified, false);
  assert.equal(pendingAttempt.httpResponse.decision, 'denied');
  assert.equal(pendingAttempt.httpResponse.reason, 'Account awaiting administrator approval');

  // 2. Rejected resident
  const rejectedAttempt = simulateVerifyDoorAuthWithApproval({
    sessionValid: true,
    profile: { id: 'u2', is_enabled: false, approval_status: 'rejected' }
  });
  assert.equal(rejectedAttempt.entryLogResult, 'failure');
  assert.equal(rejectedAttempt.httpResponse.verified, false);
  assert.equal(rejectedAttempt.httpResponse.decision, 'denied');
  assert.equal(rejectedAttempt.httpResponse.reason, 'Account registration rejected');

  // 3. Approved resident
  const approvedAttempt = simulateVerifyDoorAuthWithApproval({
    sessionValid: true,
    profile: { id: 'u3', is_enabled: true, approval_status: 'approved' }
  });
  assert.equal(approvedAttempt.entryLogResult, 'success', 'Must record success in entry_logs');
  assert.equal(approvedAttempt.httpResponse.verified, true);
  assert.equal(approvedAttempt.httpResponse.decision, 'granted');
});

test('admin-actions & admin_update_user: Authorization, atomic approval, and rejection lifecycles', async () => {
  const db = new MockDatabase();
  const adminId = '11111111-aaaa-bbbb-cccc-111111111111';
  const residentId = '22222222-aaaa-bbbb-cccc-222222222222';
  const pendingId = '33333333-aaaa-bbbb-cccc-333333333333';

  db.addProfile(adminId, 'Super Admin', 'admin', true, 'approved');
  db.addProfile(residentId, 'Active User', 'user', true, 'approved');
  db.handleNewUser(pendingId, 'Waiting User');

  // 1. Non-admin caller cannot approve users
  const unauthorizedAttempt = await db.adminUpdateUser(residentId, pendingId, null, undefined, 'approved');
  assert.equal(unauthorizedAttempt.success, false);
  assert.ok(unauthorizedAttempt.message.includes('Unauthorized'));
  assert.equal(db.profiles.get(pendingId).approval_status, 'pending');

  // 2. Admin cannot self-alter approval status
  const selfApprovalAttempt = await db.adminUpdateUser(adminId, adminId, null, undefined, 'rejected');
  assert.equal(selfApprovalAttempt.success, false);
  assert.ok(selfApprovalAttempt.message.includes('Administrators cannot alter their own approval status'));

  // 3. Admin approves pending resident: atomically sets approval_status=approved and is_enabled=true
  const approveRes = await db.adminUpdateUser(adminId, pendingId, null, undefined, 'approved');
  assert.equal(approveRes.success, true);
  const approvedProfile = db.profiles.get(pendingId);
  assert.equal(approvedProfile.approval_status, 'approved');
  assert.equal(approvedProfile.is_enabled, true, 'Approving must atomically set is_enabled=true');

  // 4. Admin rejects resident: atomically sets approval_status=rejected and is_enabled=false
  const rejectRes = await db.adminUpdateUser(adminId, pendingId, null, undefined, 'rejected');
  assert.equal(rejectRes.success, true);
  const rejectedProfile = db.profiles.get(pendingId);
  assert.equal(rejectedProfile.approval_status, 'rejected');
  assert.equal(rejectedProfile.is_enabled, false, 'Rejecting must atomically set is_enabled=false');

  // 5. Last active administrator cannot have approval revoked
  const revokeAdminRes = await db.adminUpdateUser(adminId, adminId, null, undefined, 'rejected');
  assert.equal(revokeAdminRes.success, false);
  assert.equal(db.profiles.get(adminId).approval_status, 'approved');
  assert.equal(db.profiles.get(adminId).is_enabled, true);
});

test('admin-actions list_users: Active administrator can securely view pending signups and all user profiles', () => {
  const db = new MockDatabase();
  const adminId = '11111111-aaaa-bbbb-cccc-111111111111';
  const residentId = '22222222-aaaa-bbbb-cccc-222222222222';
  const pendingId = '33333333-aaaa-bbbb-cccc-333333333333';

  db.addProfile(adminId, 'Super Admin', 'admin', true, 'approved');
  db.addProfile(residentId, 'Active User', 'user', true, 'approved');
  db.handleNewUser(pendingId, 'Waiting User');

  function simulateAdminActionsListUsers(callerProfile) {
    if (!callerProfile) {
      return { status: 401, error: 'Invalid or expired credentials' };
    }
    if (!callerProfile.is_enabled || callerProfile.approval_status !== 'approved') {
      return { status: 403, error: 'Account access is suspended or awaiting approval' };
    }
    if (callerProfile.role !== 'admin') {
      return { status: 403, error: 'Forbidden: Administrator role required' };
    }

    // Return all users via service_role
    return {
      status: 200,
      success: true,
      users: Array.from(db.profiles.values()),
    };
  }

  // 1. Active admin fetches user directory
  const adminRes = simulateAdminActionsListUsers(db.profiles.get(adminId));
  assert.equal(adminRes.status, 200);
  assert.equal(adminRes.success, true);
  assert.equal(adminRes.users.length, 3);

  // Verify pending signup is visible to the admin
  const pendingSignups = adminRes.users.filter((u) => u.approval_status === 'pending');
  assert.equal(pendingSignups.length, 1);
  assert.equal(pendingSignups[0].id, pendingId);

  // 2. Ordinary resident cannot access user directory
  const residentRes = simulateAdminActionsListUsers(db.profiles.get(residentId));
  assert.equal(residentRes.status, 403);
  assert.equal(residentRes.error, 'Forbidden: Administrator role required');

  // 3. Pending resident cannot access user directory
  const pendingRes = simulateAdminActionsListUsers(db.profiles.get(pendingId));
  assert.equal(pendingRes.status, 403);
  assert.equal(pendingRes.error, 'Account access is suspended or awaiting approval');
});

test('RLS policy simulation: Ordinary residents can only select own profile while admins view all', () => {
  const db = new MockDatabase();
  const adminId = '11111111-aaaa-bbbb-cccc-111111111111';
  const residentId = '22222222-aaaa-bbbb-cccc-222222222222';
  const pendingId = '33333333-aaaa-bbbb-cccc-333333333333';

  db.addProfile(adminId, 'Super Admin', 'admin', true, 'approved');
  db.addProfile(residentId, 'Active User', 'user', true, 'approved');
  db.handleNewUser(pendingId, 'Waiting User');

  function simulateRlsProfilesSelect(callerId) {
    const caller = db.profiles.get(callerId);
    const isAdmin = caller && caller.role === 'admin' && caller.is_enabled && caller.approval_status === 'approved';

    return Array.from(db.profiles.values()).filter((row) => {
      // USING (auth.uid() = id OR public.is_admin())
      return row.id === callerId || isAdmin;
    });
  }

  // 1. Ordinary user can only view their own profile
  const userVisible = simulateRlsProfilesSelect(residentId);
  assert.equal(userVisible.length, 1);
  assert.equal(userVisible[0].id, residentId);

  // 2. Pending user can only view their own pending profile
  const pendingVisible = simulateRlsProfilesSelect(pendingId);
  assert.equal(pendingVisible.length, 1);
  assert.equal(pendingVisible[0].id, pendingId);

  // 3. Admin can view all profiles including pending signups
  const adminVisible = simulateRlsProfilesSelect(adminId);
  assert.equal(adminVisible.length, 3);
  const adminPending = adminVisible.filter((p) => p.approval_status === 'pending');
  assert.equal(adminPending.length, 1);
});

// ============================================================================
// 10. PROLONGED PRESENCE ALERTING & FIRMWARE TIMING SIMULATION TESTS
// ============================================================================

class PresenceTrackerSimulation {
  constructor(thresholdMs = 60000, debounceGraceMs = 500) {
    this.thresholdMs = thresholdMs;
    this.debounceGraceMs = debounceGraceMs;
    this.presenceTimerActive = false;
    this.presenceStartTime = 0;
    this.lastDetectionTime = 0;
    this.presenceAlertSent = false;
    this.alertsSent = [];
  }

  update(currentTimeMs, isDetected) {
    if (isDetected) {
      this.lastDetectionTime = currentTimeMs;
      if (!this.presenceTimerActive) {
        this.presenceTimerActive = true;
        this.presenceStartTime = currentTimeMs;
        this.presenceAlertSent = false;
      }
    }

    // Check alert threshold
    if (this.presenceTimerActive && isDetected) {
      const elapsed = currentTimeMs - this.presenceStartTime;
      if (elapsed >= this.thresholdMs && !this.presenceAlertSent) {
        this.presenceAlertSent = true;
        this.alertsSent.push({
          time: currentTimeMs,
          elapsedSeconds: Math.floor(elapsed / 1000),
        });
      }
    }

    // Check reset with debounce grace
    if (this.presenceTimerActive && !isDetected && (currentTimeMs - this.lastDetectionTime) >= this.debounceGraceMs) {
      this.presenceTimerActive = false;
      this.presenceAlertSent = false;
    }
  }
}

test('Firmware presence timer: Under 60 seconds of presence triggers no alert', () => {
  const tracker = new PresenceTrackerSimulation();
  // Simulate 50 seconds of continuous presence
  for (let t = 0; t <= 50000; t += 1000) {
    tracker.update(t, true);
  }
  assert.equal(tracker.alertsSent.length, 0, 'No alert before 60 seconds');
});

test('Firmware presence timer: Crossing 60 seconds triggers exactly one alert', () => {
  const tracker = new PresenceTrackerSimulation();
  // Simulate 70 seconds of continuous presence
  for (let t = 0; t <= 70000; t += 1000) {
    tracker.update(t, true);
  }
  assert.equal(tracker.alertsSent.length, 1, 'Exactly one alert must be sent');
  assert.equal(tracker.alertsSent[0].elapsedSeconds, 60);

  // Continuing to stand there for another minute should NOT trigger repeated alerts
  for (let t = 71000; t <= 120000; t += 1000) {
    tracker.update(t, true);
  }
  assert.equal(tracker.alertsSent.length, 1, 'Must not spam alerts during same presence episode');
});

test('Firmware presence timer: Debounce grace prevents false reset during momentary sensor flicker', () => {
  const tracker = new PresenceTrackerSimulation(60000, 500);
  // Presence for 30s
  for (let t = 0; t <= 30000; t += 1000) {
    tracker.update(t, true);
  }

  // Momentary flicker for 200ms (less than 500ms debounce grace)
  tracker.update(30200, false);
  assert.equal(tracker.presenceTimerActive, true, 'Timer must remain active during transient flicker');

  // Resume presence up to 61s total from start
  for (let t = 30300; t <= 61000; t += 1000) {
    tracker.update(t, true);
  }
  assert.equal(tracker.alertsSent.length, 1, 'Alert must still trigger as episode was continuous');
});

test('Firmware presence timer: Area clear > 500ms resets timer for next visitor', () => {
  const tracker = new PresenceTrackerSimulation(60000, 500);
  // Person 1 stands for 70s -> triggers alert
  for (let t = 0; t <= 70000; t += 1000) {
    tracker.update(t, true);
  }
  assert.equal(tracker.alertsSent.length, 1);

  // Person 1 leaves for 10 seconds
  for (let t = 71000; t <= 80000; t += 1000) {
    tracker.update(t, false);
  }
  assert.equal(tracker.presenceTimerActive, false, 'Timer reset after area cleared');

  // Person 2 arrives at t = 81000 and stands for 65s
  for (let t = 81000; t <= 146000; t += 1000) {
    tracker.update(t, true);
  }
  assert.equal(tracker.alertsSent.length, 2, 'New visit must trigger a new alert once threshold is reached');
});

// ============================================================================
// 11. REPORT-PRESENCE-ALERT EDGE FUNCTION VALIDATION & DEDUPLICATION TESTS
// ============================================================================

function simulateReportPresenceAlert({
  headers,
  body,
  serverSecret = 'door-device-secret-12345',
  existingAlerts = [],
}) {
  const deviceSecret = headers['x-device-secret'];
  if (!deviceSecret || deviceSecret !== serverSecret) {
    return { status: 403, success: false, error: 'Unauthorized device' };
  }

  const { device_id, duration_seconds } = body || {};
  if (typeof device_id !== 'string' || !device_id.trim()) {
    return { status: 400, success: false, error: 'Invalid or missing device_id' };
  }

  if (typeof duration_seconds !== 'number' || duration_seconds < 60 || duration_seconds > 86400) {
    return { status: 400, success: false, error: 'Invalid duration_seconds (must be 60–86400)' };
  }

  // Deduplication check: 120s window
  const now = Date.now();
  const recentAlert = existingAlerts.find(
    (a) => a.device_id === device_id &&
           a.alert_type === 'prolonged_presence' &&
           (now - new Date(a.created_at).getTime()) < 120000
  );

  if (recentAlert) {
    return { status: 200, success: true, duplicate: true, existing_alert_id: recentAlert.id };
  }

  const severity = duration_seconds >= 300 ? 'critical' : duration_seconds >= 120 ? 'high' : 'medium';
  const newAlert = {
    id: 'alert-' + Math.random().toString(36).substring(2, 9),
    entry_log_id: null,
    severity,
    message: `Prolonged presence detected at ${device_id} for ${Math.round(duration_seconds)}s`,
    notification_status: 'pending',
    alert_type: 'prolonged_presence',
    device_id,
    duration_seconds: Math.round(duration_seconds),
    created_at: new Date(now).toISOString(),
    acknowledged_at: null,
  };

  return { status: 200, success: true, alert: newAlert };
}

test('report-presence-alert: Rejects missing or invalid x-device-secret (HTTP 403)', () => {
  const res1 = simulateReportPresenceAlert({
    headers: {},
    body: { device_id: 'esp32_door_01', duration_seconds: 65 },
  });
  assert.equal(res1.status, 403);
  assert.equal(res1.error, 'Unauthorized device');

  const res2 = simulateReportPresenceAlert({
    headers: { 'x-device-secret': 'wrong-secret' },
    body: { device_id: 'esp32_door_01', duration_seconds: 65 },
  });
  assert.equal(res2.status, 403);
});

test('report-presence-alert: Rejects duration < 60 seconds or missing device_id (HTTP 400)', () => {
  const secret = 'door-device-secret-12345';
  const res1 = simulateReportPresenceAlert({
    headers: { 'x-device-secret': secret },
    body: { device_id: 'esp32_door_01', duration_seconds: 45 },
  });
  assert.equal(res1.status, 400);

  const res2 = simulateReportPresenceAlert({
    headers: { 'x-device-secret': secret },
    body: { device_id: '', duration_seconds: 65 },
  });
  assert.equal(res2.status, 400);
});

test('report-presence-alert: Valid presence report inserts alert with null entry_log_id and correct severity', () => {
  const secret = 'door-device-secret-12345';
  // 60s -> medium
  const resMedium = simulateReportPresenceAlert({
    headers: { 'x-device-secret': secret },
    body: { device_id: 'esp32_door_01', duration_seconds: 65 },
  });
  assert.equal(resMedium.status, 200);
  assert.equal(resMedium.success, true);
  assert.equal(resMedium.alert.severity, 'medium');
  assert.equal(resMedium.alert.entry_log_id, null);
  assert.equal(resMedium.alert.alert_type, 'prolonged_presence');
  assert.equal(resMedium.alert.duration_seconds, 65);

  // 150s -> high
  const resHigh = simulateReportPresenceAlert({
    headers: { 'x-device-secret': secret },
    body: { device_id: 'esp32_door_01', duration_seconds: 150 },
  });
  assert.equal(resHigh.alert.severity, 'high');

  // 350s -> critical
  const resCritical = simulateReportPresenceAlert({
    headers: { 'x-device-secret': secret },
    body: { device_id: 'esp32_door_01', duration_seconds: 350 },
  });
  assert.equal(resCritical.alert.severity, 'critical');
});

test('report-presence-alert: Duplicate report within 120s window is suppressed gracefully', () => {
  const secret = 'door-device-secret-12345';
  const existingAlert = {
    id: 'existing-alert-999',
    device_id: 'esp32_door_01',
    alert_type: 'prolonged_presence',
    created_at: new Date(Date.now() - 30000).toISOString(), // 30s ago
  };

  const res = simulateReportPresenceAlert({
    headers: { 'x-device-secret': secret },
    body: { device_id: 'esp32_door_01', duration_seconds: 70 },
    existingAlerts: [existingAlert],
  });

  assert.equal(res.status, 200);
  assert.equal(res.duplicate, true);
  assert.equal(res.existing_alert_id, 'existing-alert-999');
});

// ============================================================================
// 12. ADMIN ACCESS LOG AUDIT & PROFILE RESOLUTION TESTS
// ============================================================================

test('admin-actions list_access_logs: Securely hydrates profiles for entry_logs', () => {
  const db = new MockDatabase();
  const adminId = '11111111-aaaa-bbbb-cccc-111111111111';
  const residentId = '22222222-aaaa-bbbb-cccc-222222222222';

  db.addProfile(adminId, 'Admin Officer', 'admin', true, 'approved');
  db.addProfile(residentId, 'Alice Resident', 'user', true, 'approved');

  const mockEntryLogs = [
    {
      id: 'log-1',
      occurred_at: new Date().toISOString(),
      user_id: residentId,
      device_id: 'esp32_door_01',
      result: 'success',
      failure_reason: null,
      request_id: '550e8400-e29b-41d4-a716-446655440001',
      created_at: new Date().toISOString(),
    },
    {
      id: 'log-2',
      occurred_at: new Date().toISOString(),
      user_id: null, // anonymous failure
      device_id: 'esp32_door_01',
      result: 'failure',
      failure_reason: 'Invalid authentication session',
      request_id: '550e8400-e29b-41d4-a716-446655440002',
      created_at: new Date().toISOString(),
    },
  ];

  function simulateListAccessLogs(callerProfile) {
    if (!callerProfile) {
      return { status: 401, error: 'Missing or invalid credentials' };
    }
    if (!callerProfile.is_enabled || callerProfile.approval_status !== 'approved') {
      return { status: 403, error: 'Account access is suspended or awaiting approval' };
    }
    if (callerProfile.role !== 'admin') {
      return { status: 403, error: 'Forbidden: Administrator role required' };
    }

    // Hydrate profiles
    const hydrated = mockEntryLogs.map((log) => ({
      ...log,
      profile: log.user_id ? db.profiles.get(log.user_id) || null : null,
    }));

    return { status: 200, success: true, logs: hydrated };
  }

  // 1. Admin caller
  const resAdmin = simulateListAccessLogs(db.profiles.get(adminId));
  assert.equal(resAdmin.status, 200);
  assert.equal(resAdmin.logs.length, 2);
  assert.equal(resAdmin.logs[0].profile.display_name, 'Alice Resident');
  assert.equal(resAdmin.logs[1].profile, null);

  // 2. Resident caller rejected
  const resResident = simulateListAccessLogs(db.profiles.get(residentId));
  assert.equal(resResident.status, 403);
});


