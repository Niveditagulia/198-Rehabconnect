// RehabConnect USB protocol TEMPLATE for Arduino UNO R4 Minima.
// This is not a completed sensor driver or calibrated rep detector.
// Insert your tested vertical-axis accelerometer code below.
// Mount the sensor securely to the moving equipment, not to the patient.
// No synthetic measurements are emitted. Invalid signals remain false.
unsigned long sequenceNumber = 0;
float movementAcceleration = 0; // gravity-compensated vertical acceleration, m/s^2
unsigned long previousSend = 0;
bool movementValid = false;
void setup() { Serial.begin(115200); }
void loop() {
  // Update the accelerometer here using the calibrated vertical axis.
  // Remove gravity: stationary movementAcceleration must be near zero, not 9.81.
  // Set movementValid only when the accelerometer is working and calibrated.
  // The browser counts a crossing at >=2 m/s^2, re-arms below 1, and debounces 500ms.
  if (millis() - previousSend < 20) return;
  previousSend = millis();
  if (!Serial) return;
  Serial.print("{\"sequence\":"); Serial.print(sequenceNumber++);
  Serial.print(",\"timestamp\":"); Serial.print(millis());
  Serial.print(",\"acceleration\":");
  if (movementValid) Serial.print(movementAcceleration, 3); else Serial.print("null");
  // Retained as unavailable for compatibility with the website packet format.
  Serial.print(",\"heartRate\":null");
  Serial.print(",\"movementValid\":"); Serial.print(movementValid ? "true" : "false");
  Serial.print(",\"heartRateValid\":false");
  Serial.println("}");
}
