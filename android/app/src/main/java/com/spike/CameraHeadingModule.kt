package com.spike

import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.SystemClock
import android.view.Surface
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Compass heading for photos, designed for shooting straight DOWN into a structure.
 *
 * With the phone held flat over a manhole, the photo is a plan view and the useful direction
 * is the one the TOP OF THE PHOTO (top of the screen) points — that lets the app draw a true
 * north arrow on the image. This is the default ("flat" mode).
 *
 * Only if the phone is tilted close to upright (lens within ~30° of the horizon) does it switch
 * to "camera" mode and report the direction the lens faces instead, since the top of the
 * phone is then pointing at the sky and has no meaningful compass direction.
 *
 * Also reports how far the phone is from level, so the app can show a bubble level.
 *
 * Uses Android's fused rotation-vector sensor (gyro + accelerometer + magnetometer), and
 * converts magnetic north to true north once a GPS position is supplied via setLocation().
 */
class CameraHeadingModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), SensorEventListener {

  companion object {
    const val NAME = "CameraHeading"
    const val EVENT = "CameraHeadingUpdated"
    private const val EMIT_INTERVAL_MS = 66L // ~15 updates per second
    private const val SMOOTHING = 0.25 // 0..1, higher = more responsive, lower = steadier
  }

  private var sensorManager: SensorManager? = null
  private val rotation = FloatArray(9)
  private val gravity = FloatArray(3)
  private val geomagnetic = FloatArray(3)
  private var haveGravity = false
  private var haveGeomagnetic = false

  private var declination = 0f
  private var hasDeclination = false

  private var smoothSin = 0.0
  private var smoothCos = 1.0
  private var smoothInitialized = false
  private var lastMode = ""
  private var lastEmit = 0L

  private var accuracyDegrees = -1.0
  private var sensorStatus = SensorManager.SENSOR_STATUS_ACCURACY_HIGH

  override fun getName(): String = NAME

  // Required by NativeEventEmitter
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  @ReactMethod
  fun start(promise: Promise) {
    stopSensors()
    val sm = reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sensorManager = sm
    smoothInitialized = false
    haveGravity = false
    haveGeomagnetic = false

    val rotationVector = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    if (rotationVector != null) {
      sm.registerListener(this, rotationVector, SensorManager.SENSOR_DELAY_GAME)
      promise.resolve(null)
      return
    }

    // Fallback for devices without a rotation-vector sensor
    val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    val mag = sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
    if (accel == null || mag == null) {
      sensorManager = null
      promise.reject("NO_COMPASS", "This device does not have a compass sensor.")
      return
    }
    sm.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
    sm.registerListener(this, mag, SensorManager.SENSOR_DELAY_GAME)
    promise.resolve(null)
  }

  @ReactMethod
  fun stop() {
    stopSensors()
  }

  /** Supply the current position so headings can be reported relative to TRUE north. */
  @ReactMethod
  fun setLocation(latitude: Double, longitude: Double, altitudeMeters: Double) {
    val field = GeomagneticField(
      latitude.toFloat(),
      longitude.toFloat(),
      altitudeMeters.toFloat(),
      System.currentTimeMillis(),
    )
    declination = field.declination
    hasDeclination = true
  }

  override fun invalidate() {
    stopSensors()
    super.invalidate()
  }

  private fun stopSensors() {
    sensorManager?.unregisterListener(this)
    sensorManager = null
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
    sensorStatus = accuracy
  }

  override fun onSensorChanged(event: SensorEvent) {
    when (event.sensor.type) {
      Sensor.TYPE_ROTATION_VECTOR -> {
        // Some devices reject arrays longer than 4 values here
        val values = event.values.copyOf(min(4, event.values.size))
        SensorManager.getRotationMatrixFromVector(rotation, values)
        if (event.values.size >= 5 && event.values[4] >= 0f) {
          accuracyDegrees = Math.toDegrees(event.values[4].toDouble())
        }
      }
      Sensor.TYPE_ACCELEROMETER -> {
        lowPass(event.values, gravity)
        haveGravity = true
        if (!haveGeomagnetic) return
        if (!SensorManager.getRotationMatrix(rotation, null, gravity, geomagnetic)) return
      }
      Sensor.TYPE_MAGNETIC_FIELD -> {
        lowPass(event.values, geomagnetic)
        haveGeomagnetic = true
        if (!haveGravity) return
        if (!SensorManager.getRotationMatrix(rotation, null, gravity, geomagnetic)) return
      }
      else -> return
    }
    update()
  }

  private fun lowPass(input: FloatArray, output: FloatArray) {
    val a = 0.8f
    for (i in 0..2) output[i] = a * output[i] + (1 - a) * input[i]
  }

  private fun update() {
    // rotation maps phone coordinates -> world coordinates (x = east, y = north, z = up)
    val r = rotation

    // Direction the back camera looks = the phone's -Z axis
    val camEast = -r[2].toDouble()
    val camNorth = -r[5].toDouble()
    val camUp = -r[8].toDouble()
    val horizontal = sqrt(camEast * camEast + camNorth * camNorth)
    val pitch = Math.toDegrees(atan2(camUp, horizontal)) // + looking up, - looking down

    // Which phone axes are "up" and "right" on the screen (depends on screen rotation)
    val (ux, uy) = when (displayRotation()) {
      Surface.ROTATION_90 -> Pair(1f, 0f)
      Surface.ROTATION_180 -> Pair(0f, -1f)
      Surface.ROTATION_270 -> Pair(-1f, 0f)
      else -> Pair(0f, 1f)
    }
    val rx = uy
    val ry = -ux

    // Level: world "up" expressed in phone coordinates is (r[6], r[7], r[8]).
    // levelX > 0 = right side of screen is higher; levelY > 0 = top of screen is higher.
    val levelX = (r[6] * rx + r[7] * ry).toDouble()
    val levelY = (r[6] * ux + r[7] * uy).toDouble()
    val tiltFromFlat = Math.toDegrees(kotlin.math.acos(r[8].toDouble().coerceIn(-1.0, 1.0)))

    val east: Double
    val north: Double
    val mode: String
    if (horizontal >= 0.866) {
      // Phone nearly upright (lens within ~30° of the horizon): use the lens direction
      east = camEast
      north = camNorth
      mode = "camera"
    } else {
      // Phone flat / pointing down: use the direction the top of the screen (photo) points
      east = (r[0] * ux + r[1] * uy).toDouble()
      north = (r[3] * ux + r[4] * uy).toDouble()
      mode = "flat"
    }

    // Smooth on the unit circle so 359° -> 1° doesn't swing through 180°
    val angle = atan2(east, north)
    if (!smoothInitialized || mode != lastMode) {
      smoothSin = sin(angle)
      smoothCos = cos(angle)
      smoothInitialized = true
    } else {
      smoothSin += SMOOTHING * (sin(angle) - smoothSin)
      smoothCos += SMOOTHING * (cos(angle) - smoothCos)
    }
    lastMode = mode

    val now = SystemClock.elapsedRealtime()
    if (now - lastEmit < EMIT_INTERVAL_MS) return
    lastEmit = now

    val magnetic = normalize(Math.toDegrees(atan2(smoothSin, smoothCos)))
    val trueHeading = if (hasDeclination) normalize(magnetic + declination) else null

    val params = Arguments.createMap().apply {
      putDouble("heading", trueHeading ?: magnetic)
      putDouble("magneticHeading", magnetic)
      if (trueHeading != null) putDouble("trueHeading", trueHeading) else putNull("trueHeading")
      putBoolean("isTrueNorth", trueHeading != null)
      putDouble("declination", declination.toDouble())
      putDouble("pitch", pitch)
      putDouble("tiltFromFlat", tiltFromFlat)
      putDouble("levelX", levelX)
      putDouble("levelY", levelY)
      putString("mode", mode)
      putDouble("accuracy", accuracyDegrees)
      putBoolean(
        "calibrationNeeded",
        sensorStatus == SensorManager.SENSOR_STATUS_UNRELIABLE ||
          sensorStatus == SensorManager.SENSOR_STATUS_ACCURACY_LOW,
      )
    }

    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT, params)
    } catch (e: Exception) {
      // JS not ready yet — skip this update
    }
  }

  private fun normalize(deg: Double): Double {
    var d = deg % 360.0
    if (d < 0) d += 360.0
    return d
  }

  @Suppress("DEPRECATION")
  private fun displayRotation(): Int {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        reactContext.currentActivity?.display?.rotation ?: Surface.ROTATION_0
      } else {
        (reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
          .defaultDisplay.rotation
      }
    } catch (e: Exception) {
      Surface.ROTATION_0
    }
  }
}
