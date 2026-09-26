import React, {useRef, useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ActivityIndicator,
  ScrollView,
  Modal,
  Platform,
  PermissionsAndroid,
  Linking,
  AppState,
} from 'react-native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp, useIsFocused} from '@react-navigation/native';
import {RootStackParamList} from '../navigation/AppNavigator';
import {
  Job,
  Structure,
  loadJob,
  saveJob,
  savePhoto,
  nextPhotoPath,
  getStructurePhotos,
  photoUri,
  photoFileName,
  deletePhotoFiles,
} from '../storage/storage';
import {decimalToDMS} from '../utils/coordinates';
import {
  HeadingReading,
  startCameraHeading,
  setHeadingLocation,
  formatHeading,
} from '../utils/cameraHeading';
import {launchImageLibrary} from 'react-native-image-picker';
import ViewShot from 'react-native-view-shot';
import Geolocation from '@react-native-community/geolocation';
import {Camera, usePhotoOutput} from 'react-native-vision-camera';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Photo'>;
  route: RouteProp<RootStackParamList, 'Photo'>;
};

/** Everything drawn on the overlay, frozen at the instant the shutter is pressed */
type Snapshot = {
  dms: string;
  timestamp: string;
  heading: number | null; // null = direction not recorded (e.g. photo from library)
  isTrueNorth: boolean;
  mode: 'camera' | 'flat';
  tilt: number | null; // degrees from flat
};

const LEVEL_SIZE = 84;
const BUBBLE_SIZE = 20;

function formatTimestamp(d: Date): string {
  return d.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function PhotoScreen({navigation, route}: Props) {
  const {jobId, structureId} = route.params;
  const viewShotRef = useRef<any>(null);
  const isFocused = useIsFocused();
  const photoOutput = usePhotoOutput({quality: 0.9});

  const [job, setJob] = useState<Job | null>(null);
  const [structure, setStructure] = useState<Structure | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [appActive, setAppActive] = useState(true);

  // Live values (camera mode)
  const [dmsCoords, setDmsCoords] = useState('Acquiring GPS...');
  const [reading, setReading] = useState<HeadingReading | null>(null);
  const [compassError, setCompassError] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState(formatTimestamp(new Date()));
  const readingRef = useRef<HeadingReading | null>(null);
  const dmsRef = useRef('GPS unavailable');

  // Captured photo + frozen overlay values (review mode)
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [nextName, setNextName] = useState('');
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const photos = structure ? getStructurePhotos(structure) : [];
  const reviewing = capturedPhoto !== null;
  const cameraActive =
    isFocused && appActive && hasCameraPermission && !reviewing && !previewPath;

  // Load (or reload) the job + structure from disk and work out the next file name
  async function refresh() {
    const j = await loadJob(jobId);
    if (!j) return;
    setJob(j);
    const s = j.structures.find(st => st.id === structureId) || null;
    setStructure(s);
    if (s) {
      setNextName(photoFileName(await nextPhotoPath(jobId, s.structureId)));
    }
  }

  useEffect(() => {
    refresh();
    ensureCameraPermission().then(setHasCameraPermission);

    // Live GPS
    const watchId = Geolocation.watchPosition(
      pos => {
        const {latitude, longitude, altitude} = pos.coords;
        const dms = decimalToDMS(latitude, longitude);
        dmsRef.current = dms;
        setDmsCoords(dms);
        setHeadingLocation(latitude, longitude, altitude ?? 0); // enables true north
      },
      () => setDmsCoords('GPS unavailable'),
      {enableHighAccuracy: true, distanceFilter: 1, interval: 2000},
    );

    // Live compass (direction the camera lens is facing)
    const stopHeading = startCameraHeading(
      r => {
        readingRef.current = r;
        setReading(r);
      },
      msg => setCompassError(msg),
    );

    // Live clock
    const timer = setInterval(() => setTimestamp(formatTimestamp(new Date())), 1000);

    // Pause the camera when the app goes to the background
    const appStateSub = AppState.addEventListener('change', s =>
      setAppActive(s === 'active'),
    );

    return () => {
      Geolocation.clearWatch(watchId);
      stopHeading();
      clearInterval(timer);
      appStateSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, structureId]);

  async function ensureCameraPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const perm = PermissionsAndroid.PERMISSIONS.CAMERA;
    if (await PermissionsAndroid.check(perm)) return true;
    const result = await PermissionsAndroid.request(perm, {
      title: 'Camera access',
      message: 'SPIKE needs the camera to take photos of structures.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    });
    if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert(
        'Camera blocked',
        'Camera access was turned off for SPIKE. Enable it in Settings → Apps → SPIKE → Permissions.',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Open Settings', onPress: () => Linking.openSettings()},
        ],
      );
    }
    return false;
  }

  async function handleShutter() {
    if (capturing) return;
    // Freeze direction, position and time at the instant the shutter is pressed
    const r = readingRef.current;
    const frozen: Snapshot = {
      dms: dmsRef.current,
      timestamp: formatTimestamp(new Date()),
      heading: r ? r.heading : null,
      isTrueNorth: r ? r.isTrueNorth : false,
      mode: r ? r.mode : 'flat',
      tilt: r ? r.tiltFromFlat : null,
    };
    setCapturing(true);
    try {
      const file = await photoOutput.capturePhotoToFile({enableShutterSound: true}, {});
      setSnapshot(frozen);
      setCapturedPhoto(photoUri(file.filePath));
    } catch (e: any) {
      Alert.alert('Camera error', e?.message || 'Could not take the photo. Please try again.');
    } finally {
      setCapturing(false);
    }
  }

  function handleChoosePhoto() {
    launchImageLibrary({mediaType: 'photo', quality: 0.9}, response => {
      if (response.didCancel) return;
      const uri = response.assets?.[0]?.uri;
      if (!uri) return;
      // A library photo was taken earlier — its direction is unknown
      setSnapshot({
        dms: dmsRef.current,
        timestamp: formatTimestamp(new Date()),
        heading: null,
        isTrueNorth: false,
        mode: 'flat',
        tilt: null,
      });
      setCapturedPhoto(uri);
    });
  }

  function handleRetake() {
    setCapturedPhoto(null);
    setSnapshot(null);
  }

  async function handleSavePhoto() {
    if (!capturedPhoto || !viewShotRef.current?.capture || !structure) return;
    setSaving(true);
    try {
      // Burn the overlay into the image, then copy it into the job's photos folder
      const shotUri: string = await viewShotRef.current.capture();
      const savedPath = await savePhoto(jobId, structure.structureId, shotUri);

      // Re-read the job so we never overwrite newer changes
      const latest = (await loadJob(jobId)) ?? job;
      if (!latest) throw new Error('Job not found');
      const updatedJob: Job = {
        ...latest,
        structures: latest.structures.map(s =>
          s.id === structureId
            ? {...s, photos: [...getStructurePhotos(s), savedPath], photoPath: undefined}
            : s,
        ),
        updatedAt: new Date().toISOString(),
      };
      await saveJob(updatedJob);
      await refresh();

      Alert.alert('Photo saved', `Saved as ${photoFileName(savedPath)}`, [
        {text: 'Take Another', onPress: handleRetake},
        {text: 'Done', onPress: () => navigation.goBack()},
      ]);
    } catch (e) {
      Alert.alert('Error', 'Could not save photo. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleDeletePhoto(path: string) {
    Alert.alert('Delete photo', `Delete ${photoFileName(path)}?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const latest = await loadJob(jobId);
          if (!latest) return;
          await deletePhotoFiles([path]);
          await saveJob({
            ...latest,
            structures: latest.structures.map(s =>
              s.id === structureId
                ? {...s, photos: getStructurePhotos(s).filter(p => p !== path), photoPath: undefined}
                : s,
            ),
            updatedAt: new Date().toISOString(),
          });
          setPreviewPath(null);
          await refresh();
        },
      },
    ]);
  }

  // What the overlay shows: live values while aiming, frozen values after the shot
  const overlay: Snapshot = snapshot ?? {
    dms: dmsCoords,
    timestamp,
    heading: reading ? reading.heading : null,
    isTrueNorth: reading ? reading.isTrueNorth : false,
    mode: reading ? reading.mode : 'flat',
    tilt: reading ? reading.tiltFromFlat : null,
  };
  const northLabel = overlay.isTrueNorth ? 'True' : 'Mag';
  const isFlat = overlay.mode === 'flat';
  const headingText =
    overlay.heading === null
      ? 'Direction not recorded'
      : isFlat
      ? `Top of photo ${formatHeading(overlay.heading)} ${northLabel}` +
        (overlay.tilt !== null ? ` · tilt ${Math.round(overlay.tilt)}°` : '')
      : `Lens facing ${formatHeading(overlay.heading)} ${northLabel}`;

  // Flat (plan view): rotate the rose so its N points to north IN the photo.
  // Upright: keep N at the top and point the arrow where the lens faces.
  const roseRotation =
    overlay.heading === null ? 0 : isFlat ? -overlay.heading : 0;
  const arrowRotation =
    overlay.heading === null ? 0 : isFlat ? 0 : overlay.heading;

  // Bubble level (only while aiming, only when roughly flat)
  const showLevel = !reviewing && reading && reading.mode === 'flat';
  const maxOffset = (LEVEL_SIZE - BUBBLE_SIZE) / 2;
  const clamp = (v: number) => Math.max(-maxOffset, Math.min(maxOffset, v));
  const bubbleX = reading ? clamp(reading.levelX * 180) : 0;
  const bubbleY = reading ? clamp(-reading.levelY * 180) : 0;
  const isLevel = !!reading && reading.tiltFromFlat <= 5;

  const showCalibrationHint =
    !reviewing &&
    reading &&
    (reading.calibrationNeeded || reading.accuracy > 20);

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (reviewing ? handleRetake() : navigation.goBack())}>
          <Text style={styles.headerBtn}>{reviewing ? '‹ Retake' : '✕ Close'}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {structure?.structureId || 'Photo'}
          </Text>
          {nextName ? (
            <Text style={styles.headerSub}>Next: {nextName}</Text>
          ) : null}
        </View>
        {reviewing ? (
          <TouchableOpacity onPress={handleSavePhoto} disabled={saving}>
            <Text style={styles.headerSave}>
              {saving ? 'Saving...' : 'Save'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{width: 50}} />
        )}
      </View>

      {/* Viewfinder (live) or captured photo (review). ViewShot turns the
          photo + overlay into the single image that gets saved. */}
      <ViewShot
        ref={viewShotRef}
        style={styles.photoContainer}
        options={{format: 'jpg', quality: 0.9}}>
        {reviewing ? (
          <Image
            source={{uri: capturedPhoto!}}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : hasCameraPermission ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device="back"
            isActive={cameraActive}
            outputs={[photoOutput]}
            enableNativeTapToFocusGesture
            enableNativeZoomGesture
          />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.placeholderIcon}>📷</Text>
            <Text style={styles.placeholderText}>Camera permission needed</Text>
            <TouchableOpacity
              style={styles.permissionBtn}
              onPress={() => ensureCameraPermission().then(setHasCameraPermission)}>
              <Text style={styles.permissionBtnText}>Allow camera</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* GPS / compass overlay — drawn over the viewfinder and burned into the photo */}
        <View style={styles.overlayBar} pointerEvents="none">
          <View style={styles.overlayLeft}>
            <Text style={styles.overlayStructureId}>
              {structure?.structureId || '—'} · {job?.name || '—'}
            </Text>
            <Text style={styles.overlayCoords}>{overlay.dms}</Text>
            <Text style={styles.overlayHeading}>{headingText}</Text>
            <Text style={styles.overlayTime}>{overlay.timestamp}</Text>
          </View>

          {/* Compass rose. Flat: a north arrow pointing to north within the photo.
              Upright: N at top, arrow = direction the lens faces. */}
          <View style={styles.compassContainer}>
            <View
              style={[
                styles.compassRing,
                {transform: [{rotate: `${roseRotation}deg`}]},
              ]}>
              <Text style={styles.compassN}>N</Text>
              <Text style={styles.compassS}>S</Text>
              <Text style={styles.compassW}>W</Text>
              <Text style={styles.compassE}>E</Text>
              {overlay.heading !== null && (
                <View
                  style={[
                    styles.compassArrow,
                    {transform: [{rotate: `${arrowRotation}deg`}]},
                  ]}>
                  <View style={styles.arrowNorth} />
                  <View style={styles.arrowSouth} />
                </View>
              )}
            </View>
            <Text style={styles.compassLabel}>
              {overlay.heading === null
                ? '—'
                : isFlat
                ? `${northLabel} N`
                : `${Math.round(overlay.heading)}°`}
            </Text>
          </View>
        </View>

        {/* Bubble level — shown while aiming only, never burned into the photo */}
        {showLevel && (
          <View style={styles.levelWrap} pointerEvents="none">
            <View
              style={[
                styles.levelRing,
                {borderColor: isLevel ? '#4EC9B0' : '#E8B84B'},
              ]}>
              <View style={styles.levelCrossH} />
              <View style={styles.levelCrossV} />
              <View
                style={[
                  styles.levelBubble,
                  {
                    backgroundColor: isLevel ? '#4EC9B0' : '#E8B84B',
                    transform: [{translateX: bubbleX}, {translateY: bubbleY}],
                  },
                ]}
              />
            </View>
            <Text style={styles.levelText}>
              {isLevel ? 'Level' : `Tilt ${Math.round(reading!.tiltFromFlat)}°`}
            </Text>
          </View>
        )}
      </ViewShot>

      {/* Bottom controls */}
      <View style={styles.controls}>
        {compassError && !reviewing && (
          <Text style={styles.warningText}>⚠ {compassError}</Text>
        )}
        {showCalibrationHint && (
          <Text style={styles.warningText}>
            ⚠ Compass accuracy is low — wave the phone in a figure-8 to calibrate
          </Text>
        )}
        {(saving || capturing) && (
          <ActivityIndicator color="white" style={{marginBottom: 12}} />
        )}

        {/* Photos already saved for this structure — tap to view / long-press to delete */}
        {photos.length > 0 && !reviewing && (
          <View style={styles.savedStrip}>
            <Text style={styles.savedLabel}>SAVED ({photos.length})</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.savedScroll}>
              {photos.map(p => (
                <TouchableOpacity
                  key={p}
                  style={styles.thumbWrap}
                  onPress={() => setPreviewPath(p)}
                  onLongPress={() => handleDeletePhoto(p)}>
                  <Image source={{uri: photoUri(p)}} style={styles.thumb} />
                  <Text style={styles.thumbName} numberOfLines={1}>
                    {photoFileName(p)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {reviewing ? (
          <View style={styles.controlRow}>
            <TouchableOpacity style={styles.reviewBtn} onPress={handleRetake}>
              <Text style={styles.reviewBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reviewBtn, styles.reviewBtnPrimary]}
              onPress={handleSavePhoto}
              disabled={saving}>
              <Text style={[styles.reviewBtnText, styles.reviewBtnTextPrimary]}>
                {saving ? 'Saving...' : 'Save Photo'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.controlRow}>
            <TouchableOpacity style={styles.controlBtn} onPress={handleChoosePhoto}>
              <Text style={styles.controlBtnIcon}>🖼</Text>
              <Text style={styles.controlBtnText}>Library</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.shutterBtn, (!cameraActive || capturing) && {opacity: 0.4}]}
              onPress={handleShutter}
              disabled={!cameraActive || capturing}>
              <View style={styles.shutterInner} />
            </TouchableOpacity>

            <View style={styles.controlBtn} />
          </View>
        )}
      </View>

      {/* Full-screen preview of a saved photo */}
      <Modal
        visible={!!previewPath}
        animationType="fade"
        onRequestClose={() => setPreviewPath(null)}>
        <View style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <TouchableOpacity onPress={() => setPreviewPath(null)}>
              <Text style={styles.headerBtn}>✕ Close</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {previewPath ? photoFileName(previewPath) : ''}
            </Text>
            <TouchableOpacity
              onPress={() => previewPath && handleDeletePhoto(previewPath)}>
              <Text style={styles.previewDelete}>Delete</Text>
            </TouchableOpacity>
          </View>
          {previewPath && (
            <Image
              source={{uri: photoUri(previewPath)}}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0a0a0a'},
  header: {
    backgroundColor: '#0a0a0a',
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {color: 'rgba(255,255,255,0.7)', fontSize: 14},
  headerTitle: {color: 'white', fontSize: 16, fontWeight: '600'},
  headerSave: {color: '#4EC9B0', fontSize: 16, fontWeight: '600'},
  headerCenter: {alignItems: 'center', flex: 1, marginHorizontal: 8},
  headerSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  photoContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
  },
  overlayBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  overlayLeft: {flex: 1, gap: 2},
  overlayStructureId: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  overlayCoords: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  overlayHeading: {
    color: '#4EC9B0',
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  overlayTime: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  compassContainer: {alignItems: 'center', gap: 2},
  compassRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  compassN: {
    position: 'absolute',
    top: 2,
    color: 'white',
    fontSize: 8,
    fontWeight: '700',
  },
  compassS: {
    position: 'absolute',
    bottom: 2,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 8,
  },
  compassW: {
    position: 'absolute',
    left: 3,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 8,
  },
  compassE: {
    position: 'absolute',
    right: 3,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 8,
  },
  compassArrow: {
    width: 2,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowNorth: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#4EC9B0',
  },
  arrowSouth: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(255,255,255,0.3)',
  },
  compassLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 9,
    fontWeight: '600',
  },
  levelWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelRing: {
    width: LEVEL_SIZE,
    height: LEVEL_SIZE,
    borderRadius: LEVEL_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  levelCrossH: {
    position: 'absolute',
    width: LEVEL_SIZE - 16,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  levelCrossV: {
    position: 'absolute',
    width: 1,
    height: LEVEL_SIZE - 16,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  levelBubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    opacity: 0.85,
  },
  levelText: {
    marginTop: 6,
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  placeholderIcon: {fontSize: 48},
  placeholderText: {color: 'rgba(255,255,255,0.5)', fontSize: 14},
  permissionBtn: {
    backgroundColor: '#4D4D61',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  permissionBtnText: {color: 'white', fontSize: 14, fontWeight: '600'},
  controls: {
    backgroundColor: '#0a0a0a',
    paddingBottom: 32,
    paddingTop: 16,
    alignItems: 'center',
  },
  warningText: {
    color: '#E8B84B',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 10,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '80%',
  },
  controlBtn: {alignItems: 'center', gap: 4, width: 60},
  controlBtnIcon: {fontSize: 24},
  controlBtnText: {color: 'rgba(255,255,255,0.7)', fontSize: 11},
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'white',
  },
  reviewBtn: {
    flex: 1,
    marginHorizontal: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
  },
  reviewBtnPrimary: {backgroundColor: '#4EC9B0', borderColor: '#4EC9B0'},
  reviewBtnText: {color: 'white', fontSize: 15, fontWeight: '600'},
  reviewBtnTextPrimary: {color: '#0a0a0a'},
  savedStrip: {width: '100%', marginBottom: 14},
  savedLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginLeft: 16,
    marginBottom: 6,
  },
  savedScroll: {paddingHorizontal: 16, gap: 10},
  thumbWrap: {width: 64, alignItems: 'center'},
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 6,
    backgroundColor: '#222',
  },
  thumbName: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 9,
    marginTop: 3,
    maxWidth: 64,
  },
  previewContainer: {flex: 1, backgroundColor: '#000'},
  previewHeader: {
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  previewDelete: {color: '#FF6B6B', fontSize: 14, fontWeight: '600'},
  previewImage: {flex: 1},
});
