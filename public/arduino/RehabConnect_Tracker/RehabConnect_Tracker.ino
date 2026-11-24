#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

//Screen Definitions
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// Pins Definitions
const int xPin = A0;
const int yPin = A1;
const int zPin = A3;
const int ledPin = 13;
const int buttonPin = 8;

// Accelerometer variables
const int ADC_BITS = 12;               // more bits for ADC reduces noise
const float ADC_MAX = 4095.0;          
const float ADC_VREF = 3.3;
const int SAMPLES = 4;                 
const float RestVoltage = 1.65;       
const float sensitivity = 0.33;        
const float GRAVITY = 9.81;

// Variables for detecting reps
const float triggerThreshold = 2.0;   // max acceleration to count a rep
const float RESET_THRESHOLD = 1.5;     // must settle below this to be a completed repition
const unsigned long REP_COOLDOWN = 500;       // prevents sensor from counting sudden movments
const unsigned long RESET_STABLE_TIME = 150;  // settle time for sensor before resseting
const double AlphaAcc = 0.5;           // allows smoothing
const unsigned long SAMPLE_INTERVAL = 10;     // delay between measurements
const unsigned long LED_ON_TIME = 150;
const unsigned long DEBOUNCE_TIME = 50;
const bool DEBUG_SERIAL = false;        // set false to silence Serial output

// Intialized variables for baselines
float xSmoothed = 0, ySmoothed = 0, zSmoothed = 0;  // smoothed accel values x, y, z
float baselineMagnitude = GRAVITY;     // resting accel for callibration
bool repDetected = false;              
bool showHeader = true;
bool paused = false;                   
int repCount = 0;

// Rep thresholds and component timings
unsigned long lastRepTime = 0;
unsigned long belowThresholdSince = 0;
unsigned long lastSampleTime = 0;
unsigned long lastPrintTime = 0;
unsigned long ledOffTime = 0;
bool ledOn = false;

// Button intializations
int lastButtonReading = HIGH;
int buttonState = HIGH;
unsigned long lastButtonChange = 0;

// USB reports the same counters as the OLED. Tracking also works offline.
char linkId[37] = "";
char command[48];
size_t commandLength = 0;
unsigned long sequence = 0, setId = 0, bootReps = 0;
const char *trackerState = "calibrating";
char output[208];
size_t outputLength = 0, outputSent = 0;
bool changed = true;
unsigned long lastReport = 0;

void serviceUSB() {
  if (!Serial) {
    commandLength = outputLength = outputSent = 0;
    linkId[0] = 0;
    return;
  }
  for (int i = 0; i < 64 && Serial.available(); ++i) {
    char c = Serial.read();
    if (c == '\n') {
      command[commandLength] = 0;
      if (commandLength == 42 && strncmp(command, "HELLO ", 6) == 0 &&
          strspn(command + 6, "0123456789abcdef-") == 36) {
        strcpy(linkId, command + 6);
        changed = true;
      }
      commandLength = 0;
    } else if (c != '\r' && commandLength < sizeof(command) - 1) {
      command[commandLength++] = c;
    }
  }
  if (outputSent == outputLength && (changed || millis() - lastReport >= 500)) {
    outputLength = snprintf(output, sizeof(output),
      "{\"v\":1,\"type\":\"tracker\",\"link\":\"%s\",\"seq\":%lu,\"setId\":%lu,\"setReps\":%d,\"bootReps\":%lu,\"state\":\"%s\"}\n",
      linkId, ++sequence, setId, repCount, bootReps, trackerState);
    outputSent = 0;
    lastReport = millis();
    changed = false;
  }
  int room = Serial.availableForWrite();
  if (room > 0 && outputSent < outputLength) {
    size_t count = outputLength - outputSent;
    if (count > (size_t)room) count = room;
    outputSent += Serial.write((const uint8_t *)output + outputSent, count);
  }
}

// Reading and averaging volt measurements (remove noise)
float readAveragedVoltage(int pin, int samples) {
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(pin);
    delayMicroseconds(500);
  }
  return (sum / (float)samples) * (ADC_VREF / ADC_MAX);
}

// Smoothing values
float smooth(float newVal, float prevVal, double alpha) {
  return alpha * prevVal + (1 - alpha) * newVal;
}

// calculating acceleration values x, y, z
void readAccel(float &ax, float &ay, float &az) {
  ax = ((readAveragedVoltage(xPin, SAMPLES) - RestVoltage) / sensitivity) * GRAVITY;
  ay = ((readAveragedVoltage(yPin, SAMPLES) - RestVoltage) / sensitivity) * GRAVITY;
  az = ((readAveragedVoltage(zPin, SAMPLES) - RestVoltage) / sensitivity) * GRAVITY;
}

// Callibration (baseline accel) before starting next excersize
void calibrate() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(5, 24);
  display.print("Hold still...");
  display.display();

  float sumMag = 0, sx = 0, sy = 0, sz = 0;
  const int N = 50;
  for (int i = 0; i < N; i++) {
    float ax, ay, az;
    readAccel(ax, ay, az);
    sumMag += sqrt(ax * ax + ay * ay + az * az);
    sx += ax; sy += ay; sz += az;
    serviceUSB();
    delay(10);
  }

  baselineMagnitude = sumMag / N;
  xSmoothed = sx / N;
  ySmoothed = sy / N;
  zSmoothed = sz / N;

  if (DEBUG_SERIAL) {
    Serial.print("Baseline magnitude (m/s^2, should be ~9.8): ");
    Serial.println(baselineMagnitude);
  }
}

// OLED monitor display
void drawDisplay() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  if (showHeader) {
    display.setCursor(5, 0);
    display.println("New Exercise:");
  }
  display.setCursor(5, 16);
  display.print("Total reps: ");
  display.println(repCount);
  display.display();
}

// Resetting variables before new excersize
void resetExercise() {
  paused = false;          
  trackerState = "calibrating";
  changed = true;
  calibrate();             
  repCount = 0;
  ++setId;
  trackerState = "running";
  changed = true;
  repDetected = false;    
  belowThresholdSince = 0;
  lastRepTime = millis();
  showHeader = true;
  drawDisplay();
}

// Pause phase - stops counting so the strap can be moved to new equipment
void enterPause() {
  paused = true;
  trackerState = "paused";
  changed = true;
  repDetected = false;
  belowThresholdSince = 0;
  digitalWrite(ledPin, LOW);
  ledOn = false;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(5, 0);
  display.println("PAUSED");
  display.setCursor(5, 14);
  display.print("Last set: ");
  display.println(repCount);
  display.setCursor(5, 34);
  display.println("Move the strap then");
  display.println("press to continue");
  display.display();
}

// Button readings - no delay so accel readings never stop
// 1 press means changing strap position. 2 press means calibrate  and move to new exercise.
void handleButton(unsigned long now) {
  int reading = digitalRead(buttonPin);
  if (reading != lastButtonReading) {
    lastButtonReading = reading;
    lastButtonChange = now;
  }
  if ((now - lastButtonChange) > DEBOUNCE_TIME && reading != buttonState) {
    buttonState = reading;
    if (buttonState == LOW) {
      if (paused) resetExercise();  
      else {
        enterPause();}           
    }
  }
}

void setup() {
  Serial.begin(115200);                 
  analogReadResolution(ADC_BITS);      
  pinMode(ledPin, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    trackerState = "fault";
    while (true) { serviceUSB(); delay(1); }
  }
  resetExercise();
}

void loop() {
  serviceUSB();
  handleButton(millis());

  // Starting a new set can spend time calibrating inside handleButton().
  const unsigned long now = millis();

  if (ledOn && now >= ledOffTime) {
    digitalWrite(ledPin, LOW);
    ledOn = false;
  }

  // if paused - don't take samples
  if (paused) {
    return;}

  if (now - lastSampleTime < SAMPLE_INTERVAL) {
    return;}
  lastSampleTime = now;

  float ax, ay, az;
  readAccel(ax, ay, az);

  xSmoothed = smooth(ax, xSmoothed, AlphaAcc);
  ySmoothed = smooth(ay, ySmoothed, AlphaAcc);
  zSmoothed = smooth(az, zSmoothed, AlphaAcc);

  float magnitude = sqrt(xSmoothed * xSmoothed + ySmoothed * ySmoothed + zSmoothed * zSmoothed);
  float accelerationChange = fabs(magnitude - baselineMagnitude);

  if (!repDetected) {
    // Look for a rep
    if (accelerationChange >= triggerThreshold && (now - lastRepTime) >= REP_COOLDOWN) {
      repDetected = true;
      ++bootReps;
      changed = true;
      repCount++;                       
      lastRepTime = now;
      belowThresholdSince = 0;
      showHeader = false;
      drawDisplay();

      digitalWrite(ledPin, HIGH);
      ledOn = true;
      ledOffTime = now + LED_ON_TIME;
    }
  } else {
    // Waiting for the arm to settle before allowing the next rep
    if (accelerationChange < RESET_THRESHOLD) {
      if (belowThresholdSince == 0) {
        belowThresholdSince = now;
      }
      if ((now - belowThresholdSince) >= RESET_STABLE_TIME && (now - lastRepTime) >= REP_COOLDOWN) {
        repDetected = false;
        belowThresholdSince = 0;
      }
    } else {
      belowThresholdSince = 0;
    }
  }

}
