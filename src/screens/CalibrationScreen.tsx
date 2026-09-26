import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp, useFocusEffect} from '@react-navigation/native';
import Geolocation from '@react-native-community/geolocation';
import {RootStackParamList} from '../navigation/AppNavigator';
import KeyboardSafeView, {useKeyboardScroll} from '../components/KeyboardSafeView';
import {useTheme, ThemeColors} from '../theme';
import {makeScreenStyles} from './SettingsScreen';
import {Job, loadJob, saveJob, generateId} from '../storage/storage';
import {jobCoordinateSystem} from '../storage/templates';
import {describeCoordinateSystem} from '../data/coordinateSystems';
import {isGeographic, coordinateUnitShort, unprojectPoint} from '../utils/projection';
import {
  ControlPoint,
  GpsSample,
  CALIBRATION_SECONDS,
  MIN_SAMPLES,
  MAX_SAMPLE_ACCURACY_M,
  LARGE_SHIFT_M,
  computeCalibration,
  describeShift,
  staleness,
  ageText,
} from '../utils/calibration';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Calibration'>;
  route: RouteProp<RootStackParamList, 'Calibration'>;
};

/** GPS calibration for one job: control points, calibrate on one, history */
export default function CalibrationScreen({navigation, route}: Props) {
  const {jobId} = route.params;
  const {colors: c} = useTheme();
  const screen = useMemo(() => makeScreenStyles(c), [c]);
  const styles = useMemo(() => makeStyles(c), [c]);
  const keyboardScroll = useKeyboardScroll();

  const [job, setJob] = useState<Job | null>(null);
  const [now, setNow] = useState(new Date());

  // New control point form
  const [adding, setAdding] = useState(false);
  const [cpName, setCpName] = useState('');
  const [cpN, setCpN] = useState('');
  const [cpE, setCpE] = useState('');

  // Calibrating (modal)
  const [point, setPoint] = useState<ControlPoint | null>(null);
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const samplesRef = useRef<GpsSample[]>([]);
  const finishing = useRef(false);

  const reload = useCallback(() => {
    loadJob(jobId).then(setJob);
    setNow(new Date());
  }, [jobId]);
  useFocusEffect(reload);

  // Keep "12 min ago" current
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const cs = job ? jobCoordinateSystem(job) : null;
  const geographic = cs ? isGeographic(cs) : false;
  const unit = cs ? coordinateUnitShort(cs) : '';
  const nLabel = geographic ? 'LATITUDE (dec. deg)' : `NORTHING (${unit})`;
  const eLabel = geographic ? 'LONGITUDE (dec. deg)' : `EASTING (${unit})`;

  async function update(patch: Partial<Job>) {
    const latest = (await loadJob(jobId)) ?? job;
    if (!latest) return;
    const next = {...latest, ...patch, updatedAt: new Date().toISOString()};
    await saveJob(next);
    setJob(next);
  }

  // ─── Control points ───

  async function addControlPoint() {
    const name = cpName.trim();
    const n = parseFloat(cpN);
    const e = parseFloat(cpE);
    if (!name) return Alert.alert('Name needed', 'Give the control point a name, e.g. CP-1.');
    if (!isFinite(n) || !isFinite(e)) {
      return Alert.alert('Coordinates needed', `Enter the point's ${geographic ? 'latitude and longitude' : 'northing and easting'} as numbers.`);
    }
    if (cs && !unprojectPoint(n, e, cs)) {
      return Alert.alert('Check coordinates', "Those coordinates can't be converted in this job's coordinate system.");
    }
    const points = job?.controlPoints ?? [];
    if (points.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return Alert.alert('Name in use', `There's already a control point called ${name}.`);
    }
    await update({controlPoints: [...points, {id: generateId(), name, northing: n, easting: e}]});
    setCpName('');
    setCpN('');
    setCpE('');
    setAdding(false);
  }

  function removeControlPoint(p: ControlPoint) {
    Alert.alert('Remove control point?', `Remove ${p.name} from this job? Calibrations already made stay as they are.`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => update({controlPoints: (job?.controlPoints ?? []).filter(x => x.id !== p.id)}),
      },
    ]);
  }

  // ─── Calibrating ───

  function stopWatching() {
    if (watchId.current !== null) {
      Geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }

  function startCalibration(p: ControlPoint) {
    samplesRef.current = [];
    finishing.current = false;
    setSamples([]);
    setLastAccuracy(null);
    setElapsed(0);
    setGpsError(null);
    setPoint(p);
    watchId.current = Geolocation.watchPosition(
      pos => {
        const s: GpsSample = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        };
        setLastAccuracy(s.accuracy);
        if (s.accuracy === null || s.accuracy <= MAX_SAMPLE_ACCURACY_M) {
          samplesRef.current = [...samplesRef.current, s];
          setSamples(samplesRef.current);
        }
      },
      err => setGpsError(err.message || 'GPS unavailable'),
      {enableHighAccuracy: true, distanceFilter: 0, interval: 1000, fastestInterval: 500},
    );
  }

  // Timer while calibrating; finishes by itself after CALIBRATION_SECONDS
  useEffect(() => {
    if (!point) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [point]);
  useEffect(() => {
    if (point && elapsed >= CALIBRATION_SECONDS && !finishing.current) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, point]);

  useEffect(() => stopWatching, []); // stop GPS if the screen closes

  function cancelCalibration() {
    stopWatching();
    setPoint(null);
  }

  async function finish() {
    if (!point || !cs || finishing.current) return;
    finishing.current = true;
    stopWatching();
    const used = samplesRef.current;
    if (used.length < MIN_SAMPLES) {
      setPoint(null);
      Alert.alert(
        'Not enough GPS readings',
        `Only ${used.length} good reading${used.length === 1 ? '' : 's'} (need ${MIN_SAMPLES}). Move to open sky, wait for a better fix and try again.`,
      );
      return;
    }
    let cal;
    try {
      cal = computeCalibration(point, used, cs, generateId());
    } catch (e: any) {
      setPoint(null);
      Alert.alert('Calibration failed', e?.message || 'Could not calibrate.');
      return;
    }
    setPoint(null);
    const shift = describeShift(cal, cs);
    const save = async () => {
      await update({
        calibration: cal,
        calibrationHistory: [cal, ...(job?.calibrationHistory ?? [])].slice(0, 50),
      });
      Alert.alert(
        'Calibrated',
        `${cal.pointName}: shift ${shift}\n${cal.samples} readings, ±${cal.meanAccuracy.toFixed(1)} m average.\n\nNew structures in this job will use this calibration.`,
      );
    };
    if (cal.shiftMetres > LARGE_SHIFT_M) {
      Alert.alert(
        'Large shift',
        `The phone is ${(cal.shiftMetres * 3.28084).toFixed(0)} ft from ${cal.pointName}'s coordinates (${shift}). Usually that means a typo in the point's coordinates, the wrong coordinate system, or you're not on the point.`,
        [
          {text: "Don't use", style: 'cancel'},
          {text: 'Use anyway', style: 'destructive', onPress: save},
        ],
      );
    } else {
      await save();
    }
  }

  function turnOff() {
    Alert.alert(
      'Turn off calibration?',
      "New structures will use the phone's GPS as-is. Structures already recorded keep their positions.",
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Turn off', style: 'destructive', onPress: () => update({calibration: null})},
      ],
    );
  }

  if (!job || !cs) return <View style={screen.container} />;

  const cal = job.calibration ?? null;
  const stale = cal ? staleness(cal, now) : null;
  const points = job.controlPoints ?? [];
  const history = job.calibrationHistory ?? [];
  const goodCount = samples.length;
  const progress = Math.min(1, elapsed / CALIBRATION_SECONDS);

  return (
    <KeyboardSafeView style={screen.container}>
      <View style={screen.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={screen.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={screen.headerTitle}>GPS Calibration</Text>
        <View style={{width: 50}} />
      </View>

      <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled" {...keyboardScroll}>
        {/* Current status */}
        <View style={[screen.card, styles.pad]}>
          {cal ? (
            <>
              <View style={styles.statusRow}>
                <View style={[styles.dot, {backgroundColor: stale ? '#E8B84B' : '#1D9E75'}]} />
                <Text style={styles.statusTitle}>Calibrated at {cal.pointName}</Text>
              </View>
              <Text style={styles.line}>
                {ageText(cal.createdAt, now)} · {cal.samples} readings · ±{cal.meanAccuracy.toFixed(1)} m
              </Text>
              <Text style={styles.line}>Shift: {describeShift(cal, cs)}</Text>
              {stale ? <Text style={styles.warn}>⚠ {stale}</Text> : null}
              <Text style={styles.small}>
                Applied to new structures in this job. To recalibrate, tap Calibrate on the same point or another one.
              </Text>
              <TouchableOpacity onPress={turnOff} style={styles.linkBtn}>
                <Text style={styles.linkDanger}>Turn off calibration</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.statusRow}>
                <View style={[styles.dot, {backgroundColor: c.textFaint}]} />
                <Text style={styles.statusTitle}>Not calibrated</Text>
              </View>
              <Text style={styles.small}>
                Set the phone on a known control point and tap Calibrate. The app averages the GPS for{' '}
                {CALIBRATION_SECONDS} seconds and shifts new structures by the difference. Horizontal only.
              </Text>
            </>
          )}
        </View>

        {/* Control points */}
        <Text style={screen.sectionLabel}>CONTROL POINTS · {describeCoordinateSystem(cs)}</Text>
        <View style={screen.card}>
          {points.length === 0 && !adding ? (
            <Text style={[styles.small, styles.pad]}>No control points yet.</Text>
          ) : null}
          {points.map((p, i) => (
            <TouchableOpacity
              key={p.id}
              style={[screen.row, i > 0 && styles.divider]}
              onLongPress={() => removeControlPoint(p)}
              delayLongPress={400}>
              <View style={screen.rowTextWrap}>
                <Text style={screen.rowTitle}>
                  {p.name}
                  {cal?.controlPointId === p.id ? <Text style={styles.inUse}>  · in use</Text> : null}
                </Text>
                <Text style={screen.rowSub}>
                  {geographic
                    ? `${p.northing.toFixed(8)}, ${p.easting.toFixed(8)}`
                    : `N ${p.northing.toFixed(2)}   E ${p.easting.toFixed(2)}`}
                </Text>
              </View>
              <TouchableOpacity style={styles.calBtn} onPress={() => startCalibration(p)}>
                <Text style={styles.calBtnText}>Calibrate</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}

          {adding ? (
            <View style={[styles.pad, points.length > 0 && styles.divider]}>
              <Text style={styles.label}>NAME</Text>
              <TextInput style={screen.input} value={cpName} onChangeText={setCpName} placeholder="e.g. CP-1" placeholderTextColor={c.placeholder} autoCapitalize="characters" />
              <Text style={styles.label}>{nLabel}</Text>
              <TextInput style={screen.input} value={cpN} onChangeText={setCpN} placeholder={geographic ? 'e.g. 41.415623' : 'e.g. 635672.99'} placeholderTextColor={c.placeholder} keyboardType="numbers-and-punctuation" />
              <Text style={styles.label}>{eLabel}</Text>
              <TextInput style={screen.input} value={cpE} onChangeText={setCpE} placeholder={geographic ? 'e.g. -81.921044' : 'e.g. 2127595.22'} placeholderTextColor={c.placeholder} keyboardType="numbers-and-punctuation" />
              <View style={styles.formBtns}>
                <TouchableOpacity onPress={() => setAdding(false)} style={styles.linkBtn}>
                  <Text style={styles.linkMuted}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={addControlPoint} style={styles.calBtn}>
                  <Text style={styles.calBtnText}>Save point</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={[screen.row, points.length > 0 && styles.divider]} onPress={() => setAdding(true)}>
              <Text style={styles.addText}>+ Add control point</Text>
            </TouchableOpacity>
          )}
        </View>
        {points.length > 0 ? <Text style={[styles.small, {marginLeft: 4}]}>Press and hold a point to remove it.</Text> : null}

        {/* History */}
        {history.length > 0 && (
          <>
            <Text style={screen.sectionLabel}>CALIBRATION HISTORY</Text>
            <View style={[screen.card, styles.pad, {gap: 6}]}>
              {history.slice(0, 10).map(h => (
                <Text key={h.id} style={styles.historyLine}>
                  {new Date(h.createdAt).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}
                  {'  '}
                  {h.pointName} · {describeShift(h, cs)}
                  {cal?.id === h.id ? '  (in use)' : ''}
                </Text>
              ))}
            </View>
          </>
        )}
        <View style={{height: 40}} />
      </ScrollView>

      {/* Calibrating */}
      <Modal visible={point !== null} transparent animationType="fade" onRequestClose={cancelCalibration}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Calibrating on {point?.name}</Text>
            <Text style={styles.small}>
              Set the phone on the point (or hold it steady directly over it) with a clear view of the sky.
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, {width: `${progress * 100}%`}]} />
            </View>
            <Text style={styles.line}>
              {elapsed} / {CALIBRATION_SECONDS} s · {goodCount} good reading{goodCount === 1 ? '' : 's'}
            </Text>
            <Text style={styles.line}>
              Current accuracy: {lastAccuracy === null ? '—' : `±${lastAccuracy.toFixed(1)} m`}
              {lastAccuracy !== null && lastAccuracy > MAX_SAMPLE_ACCURACY_M ? ' (too rough — ignored)' : ''}
            </Text>
            {gpsError ? <Text style={styles.warn}>⚠ {gpsError}</Text> : null}
            <View style={styles.formBtns}>
              <TouchableOpacity onPress={cancelCalibration} style={styles.linkBtn}>
                <Text style={styles.linkMuted}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={finish}
                disabled={goodCount < MIN_SAMPLES}
                style={[styles.calBtn, goodCount < MIN_SAMPLES && {opacity: 0.4}]}>
                <Text style={styles.calBtnText}>Finish now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardSafeView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    pad: {padding: 16},
    statusRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6},
    dot: {width: 10, height: 10, borderRadius: 5},
    statusTitle: {fontSize: 17, fontWeight: '700', color: c.text},
    line: {fontSize: 14, color: c.textSecondary, marginTop: 3},
    small: {fontSize: 12, color: c.textMuted, marginTop: 8, lineHeight: 17},
    warn: {fontSize: 13, color: '#B7791F', fontWeight: '600', marginTop: 8},
    linkBtn: {paddingVertical: 8, marginTop: 4, alignSelf: 'flex-start'},
    linkDanger: {fontSize: 14, color: c.danger, fontWeight: '600'},
    linkMuted: {fontSize: 15, color: c.textMuted},
    divider: {borderTopWidth: 0.5, borderTopColor: c.divider},
    inUse: {fontSize: 12, color: c.accentText, fontWeight: '600'},
    calBtn: {backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9},
    calBtnText: {color: 'white', fontSize: 14, fontWeight: '600'},
    addText: {fontSize: 15, color: c.accentText, fontWeight: '600'},
    label: {fontSize: 10, fontWeight: '600', color: c.textMuted, letterSpacing: 0.5, marginTop: 10, marginBottom: 6},
    formBtns: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14},
    historyLine: {fontSize: 12, color: c.textSecondary},
    backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24},
    sheet: {backgroundColor: c.card, borderRadius: 14, padding: 20},
    sheetTitle: {fontSize: 18, fontWeight: '700', color: c.text},
    progressTrack: {height: 8, borderRadius: 4, backgroundColor: c.divider, marginTop: 16, marginBottom: 10, overflow: 'hidden'},
    progressFill: {height: 8, backgroundColor: c.primaryBorder},
  });
