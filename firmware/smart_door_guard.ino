#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <NimBLEDevice.h>
#include <esp_bt.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <cstring>
#include <string>

// =====================================================
// CONFIGURATION
// Fill these locally. Do NOT upload/share real credentials.
// DEVICE_SECRET must exactly match Supabase's
// DOOR_DEVICE_SECRET value (same raw text, not a hash).
// =====================================================
const char *WIFI_SSID = "Nik";
const char *WIFI_PASSWORD = "12345678";

// Must match the rotated DOOR_DEVICE_SECRET in Supabase.
const char *DEVICE_SECRET = "b5ec2a004a25f46c41f5b80b3465f87beab8f658e026dba42b947e2788dd0d09";

const char *VERIFY_URL =
  "https://kruxomreotxjjyuiafun.supabase.co/functions/v1/verify-door-auth";

// Prolonged-presence alert endpoint (same Supabase project).
const char *PRESENCE_ALERT_URL =
  "https://kruxomreotxjjyuiafun.supabase.co/functions/v1/report-presence-alert";

// Supabase anon key for API gateway authentication
const char *SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtydXhvbXJlb3R4amp5dWlhZnVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTAwOTcsImV4cCI6MjEwNzM2NjA5N30.NTH9Csm5m3j9ff8ozzWgyj5SHRuX8q-pY6hQaSbhjvs";

const char *DEVICE_ID = "esp32_door_01";

// =====================================================
// HARDWARE / BLE UUIDS
// =====================================================
#define IR_SENSOR_PIN 27
#define SDA_PIN 25
#define SCL_PIN 26

#define SERVICE_UUID "19b10000-e8f2-537e-4f6c-d104768a1214"
#define AUTH_CHAR_UUID "19b10001-e8f2-537e-4f6c-d104768a1214"
#define STATUS_CHAR_UUID "19b10002-e8f2-537e-4f6c-d104768a1214"

static constexpr size_t MAX_BLE_JSON = 513;
static constexpr size_t REQUEST_ID_LEN = 36;
static constexpr size_t OTP_LEN = 6;

LiquidCrystal_I2C lcd(0x27, 16, 2);
NimBLECharacteristic *statusCharacteristic = nullptr;
SemaphoreHandle_t requestMutex = nullptr;

// Fixed buffers avoid repeated String allocations while BLE is active.
static char incomingJson[MAX_BLE_JSON] = {0};
static size_t incomingLength = 0;
static char pendingRequest[MAX_BLE_JSON] = {0};

bool personDetected = false;
unsigned long lastDetectionTime = 0;
unsigned long displayHoldUntil = 0;
const unsigned long STANDBY_DELAY = 5000;

// =====================================================
// PROLONGED PRESENCE ALERTING CONFIGURATION
// Uses a non-blocking millis() timer to detect when someone
// remains at the door for more than 60 continuous seconds.
// One alert per presence episode; resets when area clears.
// =====================================================

// Threshold: alert fires after 60 seconds of uninterrupted presence.
static constexpr unsigned long PRESENCE_ALERT_THRESHOLD_MS = 60000;

// Debounce grace: IR sensor must report clear for this long before
// the presence timer resets. Prevents false resets from momentary
// sensor flicker or a person shifting slightly out of range.
static constexpr unsigned long PRESENCE_DEBOUNCE_GRACE_MS = 500;

// State machine for prolonged presence detection.
bool presenceTimerActive = false;    // True while timing a continuous presence episode
unsigned long presenceStartTime = 0; // millis() when continuous presence began
bool presenceAlertSent = false;      // True after alert sent for this episode
unsigned long presenceAlertRetryAfter = 0; // millis() time for retry after network failure

// =====================================================
// LCD / BLE STATUS HELPERS
// =====================================================
void publishStatus(const char *status) {
  if (statusCharacteristic != nullptr) {
    statusCharacteristic->setValue(status);
    statusCharacteristic->notify();
  }
}

void showStandby() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("SmartDoor Guard");
  lcd.setCursor(0, 1);
  lcd.print("Waiting...");
}

void showApproach() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Welcome!");
  lcd.setCursor(0, 1);
  lcd.print("Open app to auth");
}

void showDenied(const char *reason) {
  Serial.print("Authentication denied: ");
  Serial.println(reason);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Access Denied");
  lcd.setCursor(0, 1);
  lcd.print(reason);

  displayHoldUntil = millis() + 4000;
  publishStatus("DENIED");
}

void showGranted(const char *displayName) {
  Serial.print("Verified user: ");
  Serial.println(displayName);

  lcd.clear();
  lcd.setCursor(0, 0);
  String welcome = "Welcome, ";
  welcome += displayName;
  if (welcome.length() > 16) {
    welcome = welcome.substring(0, 16);
  }
  lcd.print(welcome);
  lcd.setCursor(0, 1);
  lcd.print("Access Granted");

  displayHoldUntil = millis() + 5000;
  publishStatus("GRANTED");
}

void resetIncomingBuffer() {
  incomingLength = 0;
  incomingJson[0] = '\0';
}

bool isHexChar(char c) {
  return (c >= '0' && c <= '9') ||
         (c >= 'a' && c <= 'f') ||
         (c >= 'A' && c <= 'F');
}

bool isValidUuid(const char *value) {
  if (value == nullptr || strlen(value) != REQUEST_ID_LEN) return false;
  for (size_t i = 0; i < REQUEST_ID_LEN; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (value[i] != '-') return false;
    } else if (!isHexChar(value[i])) {
      return false;
    }
  }
  return true;
}

// =====================================================
// HEAP DIAGNOSTICS
// =====================================================
void printInternalHeap(const char *label) {
  const uint32_t caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
  Serial.printf("\n[%s]\n", label);
  Serial.printf("Free internal heap: %u bytes\n",
                (unsigned)heap_caps_get_free_size(caps));
  Serial.printf("Largest internal block: %u bytes\n",
                (unsigned)heap_caps_get_largest_free_block(caps));
  Serial.printf("Minimum free internal heap: %u bytes\n",
                (unsigned)heap_caps_get_minimum_free_size(caps));
}

// =====================================================
// SUPABASE OTP VERIFICATION
// NimBLE + fixed request buffers reduce RAM pressure before TLS.
// =====================================================
void verifyRequest(const char *json) {
  Serial.println();
  Serial.println("=== Door authentication ===");

  if (json == nullptr || json[0] == '\0') {
    showDenied("Empty request");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi disconnected; attempting reconnect...");
    WiFi.reconnect();
    showDenied("WiFi unavailable");
    return;
  }

  // Extract fields in a short scope so ArduinoJson memory is freed
  // before allocating TLS handshake structures.
  char requestId[REQUEST_ID_LEN + 1] = {0};
  char otp[OTP_LEN + 1] = {0};
  {
    JsonDocument requestDoc;
    DeserializationError parseError = deserializeJson(requestDoc, json);
    if (parseError) {
      Serial.print("BLE JSON parse failed: ");
      Serial.println(parseError.c_str());
      showDenied("Invalid request");
      return;
    }

    const char *req = requestDoc["req"] | "";
    const char *tok = requestDoc["tok"] | "";

    if (!isValidUuid(req) || strlen(tok) != OTP_LEN) {
      showDenied("Bad request data");
      return;
    }

    for (size_t i = 0; i < OTP_LEN; ++i) {
      if (tok[i] < '0' || tok[i] > '9') {
        showDenied("Invalid OTP");
        return;
      }
    }

    memcpy(requestId, req, REQUEST_ID_LEN);
    requestId[REQUEST_ID_LEN] = '\0';
    memcpy(otp, tok, OTP_LEN);
    otp[OTP_LEN] = '\0';
  }

  // Construct JSON in a fixed-size stack buffer (no body String allocation).
  char requestBody[160] = {0};
  int payloadLength = snprintf(
      requestBody, sizeof(requestBody),
      "{\"request_id\":\"%s\",\"token\":\"%s\",\"device_id\":\"%s\"}",
      requestId, otp, DEVICE_ID);

  if (payloadLength <= 0 || (size_t)payloadLength >= sizeof(requestBody)) {
    showDenied("Request too large");
    return;
  }

  // Clear stack copies that are no longer needed before TLS begins.
  memset(otp, 0, sizeof(otp));

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Verifying...");
  lcd.setCursor(0, 1);
  lcd.print("Please wait");

  printInternalHeap("Before HTTPS/TLS");

  WiFiClientSecure client;
  client.setInsecure();  // Prototype only; use CA validation for production.
  client.setTimeout(15000);

  HTTPClient http;
  http.setConnectTimeout(15000);
  http.setTimeout(15000);
  http.setReuse(false);

  Serial.println("Opening Supabase HTTPS endpoint...");
  if (!http.begin(client, VERIFY_URL)) {
    Serial.println("HTTP begin failed");
    showDenied("Connection error");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  char authHeader[260] = {0};
  snprintf(authHeader, sizeof(authHeader), "Bearer %s", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", authHeader);
  http.addHeader("x-device-secret", DEVICE_SECRET);
  http.addHeader("Connection", "close");

  Serial.printf("Sending POST; payload length: %d bytes\n", payloadLength);
  int httpCode = http.POST(reinterpret_cast<uint8_t *>(requestBody),
                           (size_t)payloadLength);
  // Clear the transient OTP from the outgoing payload buffer as soon as
  // HTTPClient has completed the synchronous POST call.
  memset(requestBody, 0, sizeof(requestBody));

  Serial.printf("HTTP result: %d\n", httpCode);

  if (httpCode < 0) {
    Serial.print("HTTP transport error: ");
    Serial.println(http.errorToString(httpCode));
    char tlsError[128] = {0};
    int tlsCode = client.lastError(tlsError, sizeof(tlsError));
    if (tlsCode != 0) {
      Serial.printf("TLS error code: %d; detail: %s\n", tlsCode, tlsError);
    }
    http.end();
    printInternalHeap("After HTTPS failure");
    showDenied("Network error");
    return;
  }

  String response = http.getString();
  Serial.printf("Supabase HTTP status: %d\n", httpCode);
  Serial.println("Supabase response received.");
  http.end();

  if (httpCode < 200 || httpCode >= 300) {
    Serial.println(response);
    if (httpCode == 400) {
      showDenied("Bad request");
    } else if (httpCode == 401 || httpCode == 403) {
      showDenied("Device rejected");
    } else if (httpCode >= 500) {
      showDenied("Server error");
    } else {
      showDenied("HTTP error");
    }
    return;
  }

  JsonDocument responseDoc;
  DeserializationError responseError = deserializeJson(responseDoc, response);
  if (responseError) {
    Serial.print("Response JSON parse failed: ");
    Serial.println(responseError.c_str());
    showDenied("Bad server reply");
    return;
  }

  bool verified = responseDoc["verified"] | false;
  const char *decision = responseDoc["decision"] | "denied";

  if (verified && strcmp(decision, "granted") == 0) {
    const char *displayName = responseDoc["display_name"] | "Resident";
    showGranted(displayName);
  } else {
    const char *reason = responseDoc["reason"] | "Not authorized";
    Serial.print("Server denied request: ");
    Serial.println(reason);
    showDenied("Not authorized");
  }
}

// =====================================================
// PROLONGED PRESENCE ALERT (HTTPS POST)
//
// Sends a single HTTPS alert to the report-presence-alert
// Edge Function when presence exceeds the threshold.
// On failure, sets a retry-after timestamp so the main loop
// can retry without flooding the backend.
// =====================================================
void sendPresenceAlert(unsigned long elapsedMs) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Presence] WiFi disconnected; will retry alert in 5s");
    presenceAlertRetryAfter = millis() + 5000;
    return;
  }

  unsigned long durationSeconds = elapsedMs / 1000;

  char requestBody[128] = {0};
  int len = snprintf(requestBody, sizeof(requestBody),
    "{\"device_id\":\"%s\",\"duration_seconds\":%lu}",
    DEVICE_ID, durationSeconds);

  if (len <= 0 || (size_t)len >= sizeof(requestBody)) {
    Serial.println("[Presence] Alert payload too large");
    presenceAlertSent = true; // Don't retry a malformed payload
    return;
  }

  Serial.printf("[Presence] Sending alert: %lus continuous presence\n", durationSeconds);
  printInternalHeap("Before presence alert HTTPS");

  WiFiClientSecure client;
  client.setInsecure();  // Prototype only
  client.setTimeout(10000);

  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(10000);
  http.setReuse(false);

  if (!http.begin(client, PRESENCE_ALERT_URL)) {
    Serial.println("[Presence] HTTP begin failed");
    presenceAlertRetryAfter = millis() + 10000;
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  char authHeader[260] = {0};
  snprintf(authHeader, sizeof(authHeader), "Bearer %s", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", authHeader);
  http.addHeader("x-device-secret", DEVICE_SECRET);
  http.addHeader("Connection", "close");

  int httpCode = http.POST(reinterpret_cast<uint8_t *>(requestBody), (size_t)len);
  memset(requestBody, 0, sizeof(requestBody));

  if (httpCode < 0) {
    Serial.printf("[Presence] HTTP error: %s\n", http.errorToString(httpCode).c_str());
    http.end();
    // Exponential backoff: 10s after first failure, capped at 60s
    unsigned long backoff = presenceAlertRetryAfter > 0 ? 30000 : 10000;
    presenceAlertRetryAfter = millis() + backoff;
    Serial.printf("[Presence] Will retry in %lums\n", backoff);
    return;
  }

  String response = http.getString();
  http.end();

  Serial.printf("[Presence] Server response: HTTP %d\n", httpCode);

  if (httpCode >= 200 && httpCode < 300) {
    presenceAlertSent = true;
    presenceAlertRetryAfter = 0;
    Serial.println("[Presence] Alert recorded successfully (or duplicate suppressed)");
  } else if (httpCode == 403) {
    // Device authentication failed — don't retry (misconfigured secret)
    presenceAlertSent = true;
    presenceAlertRetryAfter = 0;
    Serial.println("[Presence] Device rejected by server — check DEVICE_SECRET");
  } else if (httpCode == 404) {
    Serial.println("[Presence] Function not deployed on Supabase (HTTP 404). Please deploy: supabase functions deploy report-presence-alert");
    presenceAlertRetryAfter = millis() + 60000;
  } else {
    Serial.printf("[Presence] Server rejected: %s\n", response.c_str());
    presenceAlertRetryAfter = millis() + 15000;
  }
}

// =====================================================
// BLE FRAGMENT ASSEMBLY (NimBLE-Arduino 2.x)
// =====================================================
class AuthCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *characteristic,
               NimBLEConnInfo &connInfo) override {
    (void)connInfo;
    std::string fragment = characteristic->getValue();
    if (fragment.empty()) return;

    Serial.printf("BLE fragment received: %u bytes\n",
                  (unsigned)fragment.size());

    // Begin collecting only when the first JSON object brace is seen.
    for (size_t i = 0; i < fragment.size(); ++i) {
      char c = fragment[i];
      if (incomingLength == 0 && c != '{') continue;

      if (incomingLength >= MAX_BLE_JSON - 1) {
        Serial.println("BLE request too large; clearing buffer");
        resetIncomingBuffer();
        publishStatus("INVALID_REQUEST");
        return;
      }

      incomingJson[incomingLength++] = c;
      incomingJson[incomingLength] = '\0';
    }

    if (incomingLength == 0) return;

    // Determine if the JSON object is complete, respecting quoted braces.
    int depth = 0;
    bool inString = false;
    bool escaped = false;
    for (size_t i = 0; i < incomingLength; ++i) {
      char c = incomingJson[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString && c == '\\') {
        escaped = true;
        continue;
      }
      if (c == '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (c == '{') depth++;
        if (c == '}') depth--;
        if (depth < 0) {
          resetIncomingBuffer();
          publishStatus("INVALID_REQUEST");
          return;
        }
      }
    }

    if (depth != 0 || inString) return;

    bool queued = false;
    if (requestMutex != nullptr &&
        xSemaphoreTake(requestMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      if (pendingRequest[0] == '\0') {
        memcpy(pendingRequest, incomingJson, incomingLength + 1);
        queued = true;
      }
      xSemaphoreGive(requestMutex);
    }

    Serial.printf("Complete BLE request: %u bytes\n", (unsigned)incomingLength);
    resetIncomingBuffer();

    if (queued) {
      Serial.println("Authentication request queued");
      publishStatus("REQUEST_RECEIVED");
    } else {
      Serial.println("Request queue busy; request discarded");
      publishStatus("BUSY");
    }
  }
};

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(IR_SENSOR_PIN, INPUT);
  Wire.begin(SDA_PIN, SCL_PIN);
  lcd.init();
  lcd.backlight();
  showStandby();

  if (strcmp(WIFI_SSID, "YOUR_WIFI_SSID") == 0 ||
      strcmp(WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") == 0 ||
      strcmp(DEVICE_SECRET, "YOUR_ROTATED_DEVICE_SECRET") == 0) {
    Serial.println("ERROR: Fill in Wi-Fi, Supabase URL, and device-secret settings.");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Set config first");
    while (true) delay(1000);
  }

  requestMutex = xSemaphoreCreateMutex();
  if (requestMutex == nullptr) {
    Serial.println("ERROR: Could not create request mutex");
    showDenied("Memory error");
    while (true) delay(1000);
  }

  // Connect Wi-Fi before BLE consumes its runtime memory budget.
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 20000) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Wi-Fi RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("Wi-Fi connection failed; BLE will still start.");
  }

  // Release memory reserved for Bluetooth Classic; this sketch uses BLE only.
  esp_err_t releaseResult = esp_bt_mem_release(ESP_BT_MODE_CLASSIC_BT);
  Serial.print("Classic Bluetooth memory release: ");
  Serial.println(esp_err_to_name(releaseResult));

  // Initialize the lower-memory NimBLE stack.
  NimBLEDevice::init("SmartDoor-ESP32");
  NimBLEServer *server = NimBLEDevice::createServer();
  server->advertiseOnDisconnect(true);

  NimBLEService *service = server->createService(SERVICE_UUID);
  NimBLECharacteristic *authCharacteristic = service->createCharacteristic(
      AUTH_CHAR_UUID, NIMBLE_PROPERTY::WRITE);

  statusCharacteristic = service->createCharacteristic(
      STATUS_CHAR_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  statusCharacteristic->setValue("READY");

  authCharacteristic->setCallbacks(new AuthCallbacks());
  service->start();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  bool advertisingStarted = advertising->start();
  Serial.printf(
      "BLE advertising start requested: %s\n",
      advertisingStarted ? "SUCCESS" : "FAILED"
  );
  Serial.println("BLE device name: SmartDoor-ESP32");
  Serial.printf("BLE service UUID: %s\n", SERVICE_UUID);

  printInternalHeap("After NimBLE initialization");
  Serial.println("SmartDoor Guard ready");
  Serial.println("Device: SmartDoor-ESP32 (NimBLE)");
  Serial.printf("Presence alert threshold: %lus\n", PRESENCE_ALERT_THRESHOLD_MS / 1000);
  Serial.printf("Presence debounce grace: %lums\n", PRESENCE_DEBOUNCE_GRACE_MS);
}

// =====================================================
// MAIN LOOP
//
// Non-blocking structure:
//   1. Process any queued BLE auth request (may block during TLS)
//   2. Read IR sensor
//   3. Manage presence timer and prolonged-presence alert
//   4. Handle display hold and standby transitions
// =====================================================
void loop() {
  // --- 1. BLE Authentication Processing ---
  char requestToVerify[MAX_BLE_JSON] = {0};

  if (requestMutex != nullptr &&
      xSemaphoreTake(requestMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
    if (pendingRequest[0] != '\0') {
      memcpy(requestToVerify, pendingRequest, sizeof(requestToVerify));
      requestToVerify[sizeof(requestToVerify) - 1] = '\0';
      pendingRequest[0] = '\0';
    }
    xSemaphoreGive(requestMutex);
  }

  if (requestToVerify[0] != '\0') {
    verifyRequest(requestToVerify);
  }

  // --- 2. IR Sensor Detection ---
  // LOW indicates someone is present (active-low IR sensor on GPIO 27).
  bool detected = (digitalRead(IR_SENSOR_PIN) == LOW);

  if (detected) {
    lastDetectionTime = millis();

    if (!personDetected) {
      personDetected = true;
      Serial.println("Presence detected");
      if (millis() >= displayHoldUntil) showApproach();
    }

    // Start the prolonged-presence timer on first detection.
    // Timer remains active as long as presence is continuous.
    if (!presenceTimerActive) {
      presenceTimerActive = true;
      presenceStartTime = millis();
      presenceAlertSent = false;
      presenceAlertRetryAfter = 0;
      Serial.println("[Presence] Continuous timer started");
    }
  }

  // --- 3. Prolonged Presence Alert Check (non-blocking) ---
  // Only fires once per continuous-presence episode.
  // Uses unsigned subtraction which is wrap-safe for millis().
  if (presenceTimerActive && detected) {
    unsigned long elapsed = millis() - presenceStartTime;
    if (elapsed >= PRESENCE_ALERT_THRESHOLD_MS && !presenceAlertSent) {
      // Attempt to send alert (or retry if previous attempt failed)
      if (presenceAlertRetryAfter == 0 || millis() >= presenceAlertRetryAfter) {
        sendPresenceAlert(elapsed);
      }
    }
  }

  // --- 4. Presence Timer Reset (with debounce grace) ---
  // Only reset after the sensor has been clear for at least
  // PRESENCE_DEBOUNCE_GRACE_MS (500ms) to avoid false resets from
  // momentary IR sensor flicker. A genuine departure will stay clear
  // well beyond 500ms.
  if (presenceTimerActive && !detected &&
      (millis() - lastDetectionTime) >= PRESENCE_DEBOUNCE_GRACE_MS) {
    Serial.println("[Presence] Timer reset — area clear");
    presenceTimerActive = false;
    presenceAlertSent = false;
    presenceAlertRetryAfter = 0;
    // Next visit is eligible for a new alert.
  }

  // --- 5. Standby Return ---
  // Return to standby display after no presence for STANDBY_DELAY (5s).
  if (personDetected && millis() - lastDetectionTime >= STANDBY_DELAY) {
    personDetected = false;
    Serial.println("Returned to standby");
    if (millis() >= displayHoldUntil) showStandby();
  }

  // --- 6. Display Hold ---
  // Keep access result visible for the configured hold duration.
  if (displayHoldUntil != 0 && millis() >= displayHoldUntil) {
    displayHoldUntil = 0;
    if (personDetected) showApproach();
    else showStandby();
  }

  delay(20);
}
