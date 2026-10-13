# SmartDoor Guard: IoT-Based Smart Door Authentication Web Application

SmartDoor Guard is a production-grade, zero-trust web application for an **IoT-Based Smart Door Authentication System** powered by React, TypeScript, Vite, Tailwind CSS, Supabase, and the Web Bluetooth API (optimized for Android Chrome and Chromium browsers).

---

## 1. System Architecture & Workflow

```
+---------------------------------------------------------------------------------------------------------+
|                                    ZERO-TRUST AUTHENTICATION SEQUENCE                                   |
+---------------------------------------------------------------------------------------------------------+
       ESP32 (Hardware)                  Android Chrome (Web App)                 Supabase (Backend)
              |                                     |                                      |
  (1) [IR Sensor Detects Person]                    |                                      |
  (2) LCD: "Tap Authenticate at Door"               |                                      |
              |                        (3) User taps "Authenticate"                        |
              |                                     |                                      |
              |                                     |--(4) POST /issue-auth-session ------>|
              |                                     |    (User Bearer JWT validated)       | (Validates is_enabled)
              |                                     |                                      | (Generates 6-digit OTP)
              |                                     |<-(5) Return {request_id, token} -----| (Stores SHA-256 hash)
              |                                     |      (Single-use, 60s TTL)           |
              |                                     |                                      |
              |<- (6) Web Bluetooth GATT Connect --|                                      |
              |<- (7) BLE Write Auth Characteristic-|                                      |
              |       JSON: {req, tok, ts}          |                                      |
              |                                                                            |
              |--(8) POST /verify-door-auth (over Wi-Fi) --------------------------------->|
              |      Header: x-device-secret: <DOOR_DEVICE_SECRET>                         | (Re-hashes token)
              |      Payload: {request_id, token, device_id}                               | (Atomic check & consume)
              |                                                                            | (Prevents replay attacks)
              |                                                                            | (Logs to entry_logs)
              |                                                                            |
              |                                                                            |--[Direct Spotify Web API]--> Spotify Connect Device
              |                                                                            |   (Plays preferred user_music song)
              |                                                                            |
              |                                                                            |--[If Replay / Failed]------> Intrusion Alert
              |                                                                            |   (Logs to intrusion_alerts)
              |                                                                            |
              |<-(9) Return {verified: true/false, decision: 'granted'/'denied'} ----------|
              |                                                                            |
  (10) Physical Access Decision:                                                           |
       - If GRANTED: Trigger solenoid, LCD: "Welcome Jane", play Spotify                   |
       - If DENIED: Keep locked, LCD: "Access Denied", sound buzzer                        |
              |                                                                            |
  (11) BLE Notify / Polling: Frontend updates UI with final verification result            |
```

---

## 2. Directory Structure

```
smart-entry-system/
├── src/
│   ├── components/
│   │   ├── Navbar.tsx                # Persistent brand navbar & portal switcher
│   │   ├── AppLayout.tsx             # User portal responsive layout (sidebar/bottom-nav)
│   │   ├── AdminLayout.tsx           # Admin console layout with security badges
│   │   ├── ProtectedRoute.tsx        # Guards user routes with session & active status checks
│   │   ├── AdminRoute.tsx            # Strict backend-verified admin role check
│   │   ├── BluetoothConnectCard.tsx  # Section 4 dedicated Web Bluetooth module
│   │   └── DoorAuthModal.tsx         # Section 3 complete 14-step door authentication flow
│   ├── context/
│   │   └── AuthContext.tsx           # Supabase auth, profile, role, & music state provider
│   ├── lib/
│   │   ├── supabase.ts               # Supabase JS client with env validation
│   │   └── utils.ts                  # Date formatting and Tailwind class merging
│   ├── pages/
│   │   ├── Login.tsx                 # Resident login (/login)
│   │   ├── Signup.tsx                # Resident registration (/signup)
│   │   ├── Dashboard.tsx             # Resident dashboard (/dashboard)
│   │   ├── Profile.tsx               # Display name & Spotify song preference (/profile)
│   │   ├── AccessHistory.tsx         # Personal audit logs (/access-history)
│   │   └── admin/
│   │       ├── AdminDashboard.tsx    # Admin KPI dashboard & analytics (/admin)
│   │       ├── AdminUsers.tsx        # User status and role management (/admin/users)
│   │       ├── AdminAccessLogs.tsx   # Facility-wide entry audit trail (/admin/access-logs)
│   │       └── AdminAlerts.tsx       # Live intrusion alerts & acknowledgments (/admin/alerts)
│   ├── services/
│   │   ├── auth.ts                   # User profile fetching and updating
│   │   ├── music.ts                  # Spotify URI/URL parser and user_music persistence
│   │   ├── access-history.ts         # User and facility access logs queries
│   │   ├── admin.ts                  # Metrics, user activation, and alerts services
│   │   └── bluetooth.ts              # Web Bluetooth service with configurable UUIDs
│   ├── types/
│   │   ├── database.ts               # TypeScript schemas matching existing DB tables
│   │   └── bluetooth.ts              # Web Bluetooth connection and packet types
│   ├── App.tsx                       # React Router DOM configuration
│   └── main.tsx                      # Application root mount
├── supabase/
│   ├── functions/
│   │   ├── _shared/                  # Shared utilities (Spotify Web API client, device targeting)
│   │   ├── issue-auth-session/       # Edge function: issues single-use 60s OTP
│   │   ├── verify-door-auth/         # Edge function: ESP32 Wi-Fi validation, direct Spotify playback
│   │   ├── admin-actions/            # Edge function: server-authorized role changes
│   │   ├── spotify-search/           # Edge function: catalog search for authenticated users
│   │   ├── spotify-auth-url/         # Edge function: OAuth authorization URL & state token
│   │   ├── spotify-callback/         # Edge function: OAuth code exchange & refresh token store
│   │   ├── spotify-test-devices/     # Edge function: diagnostic endpoint for Connect devices
│   │   └── spotify-test-playback/    # Edge function: diagnostic endpoint for direct playback
│   ├── migrations/                   # Database migrations (PostgreSQL DDL)
│   └── schema.sql                    # Complete schema reference and RLS policies
├── .env.example                      # Template for frontend environment variables
├── package.json
└── vite.config.ts
```

---

## 3. Web Bluetooth API Configuration

The application uses the standard **Web Bluetooth API** (`navigator.bluetooth`). In accordance with browser security specifications:
- Bluetooth operations are **only** initiated via direct user gestures (buttons).
- Browser support is detected proactively, with clear guidance for Chrome on Android.
- All GATT Service and Characteristic UUIDs are configurable via environment variables or directly within the UI config drawer:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `VITE_BLE_SERVICE_UUID` | `19b10000-e8f2-537e-4f6c-d104768a1214` | Primary ESP32 GATT Service UUID |
| `VITE_BLE_CHAR_AUTH_UUID` | `19b10001-e8f2-537e-4f6c-d104768a1214` | Auth packet write characteristic |
| `VITE_BLE_CHAR_STATUS_UUID` | `19b10002-e8f2-537e-4f6c-d104768a1214` | Status notification characteristic |
| `VITE_BLE_DEVICE_NAME_PREFIX` | `SmartDoor` | Name filter for BLE device discovery |

---

## 4. Setup and Deployment

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your Supabase Project URL and Anon Key:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Step 3: Run the Development Server
```bash
npm run dev
```

### Step 4: Build for Production
```bash
npm run build
```

---

## 5. Supabase Edge Functions Deployment & Secrets

Deploy the required Edge Functions to your Supabase project using the Supabase CLI:

```bash
# 1. Login to Supabase CLI
supabase login

# 2. Link your project
supabase link --project-ref your-project-ref

# 3. Deploy functions
supabase functions deploy issue-auth-session
supabase functions deploy verify-door-auth
supabase functions deploy admin-actions
supabase functions deploy spotify-search

# 4. Set required backend secrets in Supabase
supabase secrets set DOOR_DEVICE_SECRET="your-esp32-hardware-secret-key"
supabase secrets set OTP_HMAC_SECRET="your-secure-64-char-hmac-secret-key"

# 5. Spotify Web API backend secrets (Already configured in Spotify Developer Dashboard)
supabase secrets set SPOTIFY_CLIENT_ID="your-spotify-client-id"
supabase secrets set SPOTIFY_CLIENT_SECRET="your-spotify-client-secret"
supabase secrets set SPOTIFY_REDIRECT_URI="https://<project-ref>.supabase.co/functions/v1/spotify-callback"
supabase secrets set SPOTIFY_SETUP_SECRET="your-high-entropy-setup-secret"
# Optional: defaults to "Web Player (Chrome)" or first active Connect device
supabase secrets set SPOTIFY_DEVICE_NAME="Web Player (Chrome)"
```

---

## 6. ESP32 Firmware Implementation Guide

When configuring the ESP32 microcontroller firmware (C++ / Arduino IDE or ESP-IDF):

1. **BLE Server Initialization**:
   - Create BLE Server advertising `VITE_BLE_SERVICE_UUID`.
   - Create Characteristic `VITE_BLE_CHAR_AUTH_UUID` with `PROPERTY_WRITE`.
   - On write, parse JSON payload: `{"req":"...","tok":"...","ts":12345678}`.

2. **Wi-Fi Verification Call**:
   - Make an HTTPS `POST` request to:
     `https://<your-project-id>.supabase.co/functions/v1/verify-door-auth`
   - Include headers:
     ```
     Content-Type: application/json
     x-device-secret: <DOOR_DEVICE_SECRET>
     ```
   - JSON payload:
     ```json
     {
       "request_id": "<req_from_ble>",
       "token": "<tok_from_ble>",
       "device_id": "esp32_door_main_entrance"
     }
     ```

3. **Physical Access Decision**:
   - If response `decision == "granted"`:
     - Pull GPIO pin HIGH for 5 seconds to activate the solenoid door lock relay.
     - Display on LCD: `Welcome <display_name>!`.
     - Direct Spotify playback starts automatically in backend on the configured Spotify device.
   - If response `decision == "denied"`:
     - Keep lock engaged.
     - Sound buzzer on GPIO pin for 2 seconds.
     - Display on LCD: `Access Denied!`.
     - Music is never triggered.

---

## 7. Spotify Web API Direct Integration (No IFTTT Required)

SmartDoor Guard integrates directly with the **Spotify Web API**:

1. **Shared Playback Account**:
   - A dedicated shared Spotify account (or home speaker account) is linked via `spotify-auth-url` and `spotify-callback`.
   - Refresh tokens are securely stored in the private `spotify_shared_account` table with strict Row Level Security (RLS restricted solely to `service_role`).
   - Access tokens are automatically refreshed and rotated on demand.

2. **Song Search & Selection**:
   - Authenticated residents search the Spotify catalog directly in the UI via the `spotify-search` Edge Function.
   - Client applications never receive or store the Spotify Client Secret.
   - Selected tracks are persisted with canonical URI (`spotify:track:...`) and rich metadata (track name, artist, album, artwork URL) in `user_music`.

3. **Direct Playback on Door Unlock**:
   - When `verify-door-auth` verifies entry, it calls `PUT https://api.spotify.com/v1/me/player/play` targeting the active Spotify Connect device (such as `Web Player (Chrome)` or an audio receiver).
   - Playback operates in a completely fail-safe manner: Spotify network errors, timeouts, or absent playback devices will **never** block or delay physical door entry.

---

## 8. Mandatory Administrator Approval System

SmartDoor Guard enforces mandatory administrator approval for all resident registrations:
1. **Zero-Trust Signup Defaults**:
   - Newly registered users strictly initialize with `role = 'user'`, `is_enabled = false`, and `approval_status = 'pending'`.
   - Protected triggers (`protect_profile_columns`) prohibit client-side modification of `role`, `is_enabled`, or `approval_status`.
2. **Backend Door-Auth Gating**:
   - `issue-auth-session` and `verify-door-auth` verify both `is_enabled = true` and `approval_status = 'approved'`.
   - Pending or rejected users cannot obtain single-use door-auth OTPs or trigger door entry.
3. **Administration Console Review Queue**:
   - The `/admin` dashboard displays a **Pending Signups** alert card and direct review queue.
   - Administrators approve or reject users with atomic database synchronization via `admin_update_user`:
     - **Approve**: sets `approval_status = 'approved'` and `is_enabled = true`.
     - **Reject**: sets `approval_status = 'rejected'` and `is_enabled = false`.
   - Self-modification and demotion of the last active administrator are strictly prevented.

---

## 9. Automated Testing & Verification

SmartDoor Guard includes an automated security and regression test suite:

```bash
# Run security and Spotify regression tests (Node test runner)
npm test

# Run PostgreSQL staging integration tests
npm run test:staging
```

Test coverage includes:
- **HMAC-SHA256 Token Validation & Replay Prevention**: Atomic consumption and single-use 60s TTL.
- **Mandatory Admin Approval**: Default pending state, client trigger protection, and approval/rejection lifecycle.
- **Zero-Trust Access Control**: Suspended, pending, or rejected accounts blocked from door-auth sessions.
- **Spotify Web API Resilience**: Fail-safe playback isolation and Spotify URI parsing.
- **PostgreSQL Database Constraints**: Result check constraint validation (`result IN ('success', 'failure')`).

---

## 10. End-to-End Testing Checklist

- [x] **Account Signup & Verification**: Create account at `/signup`, verify default `pending` status and approval notification.
- [x] **Admin Approval Queue**: Approve/reject pending resident in `/admin/users`, verifying atomic `is_enabled` sync.
- [x] **Role Authorization**: Verify `/admin` routes redirect unapproved or ordinary users with unauthorized message.
- [x] **Spotify Preference**: Select track from catalog picker at `/profile`, verify persistence in `user_music` table.
- [x] **Single-Use OTP Session**: Request auth session via `/issue-auth-session`, verify 60-second TTL countdown in UI.
- [x] **Replay Protection**: Verify that consuming the same OTP twice fails atomically and triggers an intrusion alert.
- [x] **Web Bluetooth Handshake**: Connect via Bluetooth on Android Chrome, send auth payload to ESP32.
- [x] **Realtime Admin Alerts**: Acknowledge alerts in `/admin/alerts`, verify real-time status update.
- [x] **Mobile Responsiveness**: Test touch controls and compact bottom bar on Android viewports.

