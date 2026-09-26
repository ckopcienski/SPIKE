import {NativeModules, NativeEventEmitter} from 'react-native';

// JS side of android/app/src/main/java/com/spike/CameraHeadingModule.kt

export type HeadingReading = {
  /** Heading in degrees 0–360 (true north when a location has been set, otherwise magnetic) */
  heading: number;
  magneticHeading: number;
  trueHeading: number | null;
  isTrueNorth: boolean;
  /** Magnetic declination applied (degrees, east positive) */
  declination: number;
  /** Camera tilt: + looking up, - looking down (degrees) */
  pitch: number;
  /** Degrees away from lying flat (0 = perfectly flat, lens straight down) */
  tiltFromFlat: number;
  /** Level components: +levelX = right side of screen is higher, +levelY = top is higher */
  levelX: number;
  levelY: number;
  /**
   * 'flat'   = phone pointing down (default): heading is the direction the TOP OF THE PHOTO faces
   * 'camera' = phone held nearly upright: heading is the direction the lens faces
   */
  mode: 'camera' | 'flat';
  /** Estimated heading accuracy in degrees, or -1 if unknown */
  accuracy: number;
  /** True when Android reports the compass needs calibrating */
  calibrationNeeded: boolean;
};

const Native = NativeModules.CameraHeading;

/** Start streaming heading updates. Returns a function that stops them. */
export function startCameraHeading(
  onUpdate: (reading: HeadingReading) => void,
  onError?: (message: string) => void,
): () => void {
  if (!Native) {
    onError?.('Compass module not found — rebuild the app (npx react-native run-android).');
    return () => {};
  }
  const emitter = new NativeEventEmitter(Native);
  const sub = emitter.addListener('CameraHeadingUpdated', onUpdate);
  Native.start().catch((e: Error) => onError?.(e.message));
  return () => {
    sub.remove();
    Native.stop();
  };
}

/** Give the compass a GPS position so it can report true north instead of magnetic. */
export function setHeadingLocation(latitude: number, longitude: number, altitudeMeters = 0) {
  Native?.setLocation(latitude, longitude, altitudeMeters);
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function headingToCardinal(heading: number): string {
  return CARDINALS[Math.round(heading / 45) % 8];
}

/** e.g. "042° NE" */
export function formatHeading(heading: number): string {
  const deg = Math.round(heading) % 360;
  return `${String(deg).padStart(3, '0')}° ${headingToCardinal(deg)}`;
}
