import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp, useFocusEffect} from '@react-navigation/native';
import {RootStackParamList} from '../navigation/AppNavigator';
import KeyboardSafeView, {useKeyboardScroll} from '../components/KeyboardSafeView';
import {useTheme, ThemeColors} from '../theme';
import {
  Job,
  Structure,
  Pipe,
  loadJob,
  saveJob,
  generateId,
  getStructurePhotos,
  photoFileBase,
  renameStructurePhotos,
} from '../storage/storage';
import {TemplateLists, SPIKE_TEMPLATE, jobLists} from '../storage/templates';
import {StructureFieldId, formatStation, formatOffset} from '../data/structureFields';
import {checkStructure} from '../utils/structureChecks';
import {applyCalibration, staleness} from '../utils/calibration';
import {decimalToDMS} from '../utils/coordinates';
import Geolocation from '@react-native-community/geolocation';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'DataEntry'>;
  route: RouteProp<RootStackParamList, 'DataEntry'>;
};

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Unique values, keeping order */
const unique = (list: string[]) => Array.from(new Set(list));

/** A new pipe using the job's usual defaults (8" PVC if they're in its lists) */
function newPipe(lists: TemplateLists): Pipe {
  const size = lists.pipeSizes.includes('8"') ? '8"' : lists.pipeSizes[0] ?? '';
  const material = lists.pipeMaterials.includes('PVC') ? 'PVC' : lists.pipeMaterials[0] ?? '';
  return {id: generateId(), direction: 'N', size, material, depthBelowRim: 0};
}

type ActiveTab = 'structure' | 'pipes';

export default function DataEntryScreen({navigation, route}: Props) {
  const {colors: c} = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const keyboardScroll = useKeyboardScroll(); // keep the focused box above the keyboard
  const {jobId, structureId} = route.params;
  const [job, setJob] = useState<Job | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('structure');

  // Structure fields
  const [structId, setStructId] = useState('');
  const [structType, setStructType] = useState(SPIKE_TEMPLATE.structureTypes[0]);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [customTypeModalVisible, setCustomTypeModalVisible] = useState(false);
  const [newCustomType, setNewCustomType] = useState('');
  const [customSizes, setCustomSizes] = useState<string[]>([]);
  const [customSizePipeId, setCustomSizePipeId] = useState<string | null>(null); // pipe the "+ Custom" size is for
  const [newCustomSize, setNewCustomSize] = useState('');
  const [customMaterials, setCustomMaterials] = useState<string[]>([]);
  const [customMaterialPipeId, setCustomMaterialPipeId] = useState<string | null>(null); // pipe the "+ Custom" material is for
  const [newCustomMaterial, setNewCustomMaterial] = useState('');
  const [street, setStreet] = useState('');
  const [showStreetSuggestions, setShowStreetSuggestions] = useState(false);
  const [rimElevation, setRimElevation] = useState('');
  // Casting size, typed in. Width only = round (width is the diameter);
  // width and length = rectangular (square when they match).
  const [castingWidth, setCastingWidth] = useState('');
  const [castingLength, setCastingLength] = useState('');
  const [depth, setDepth] = useState('');
  const [notes, setNotes] = useState('');

  // Optional details — each shown only if the job's template has that field on
  const [city, setCity] = useState('');
  const [station, setStation] = useState('');
  const [offset, setOffset] = useState('');
  const [offsetSide, setOffsetSide] = useState<'LT' | 'RT' | undefined>(undefined);
  const [sizeLength, setSizeLength] = useState('');
  const [sizeWidth, setSizeWidth] = useState('');
  const [sizeHeight, setSizeHeight] = useState('');
  const [constructionType, setConstructionType] = useState('');
  const [customConstruction, setCustomConstruction] = useState<string[]>([]);
  const [constructionModalVisible, setConstructionModalVisible] = useState(false);
  const [newConstruction, setNewConstruction] = useState('');
  const [condition, setCondition] = useState('');
  const [sump, setSump] = useState<boolean | undefined>(undefined);
  const [sumpDepth, setSumpDepth] = useState('');
  const [needsCleaning, setNeedsCleaning] = useState<boolean | undefined>(undefined);
  const [steps, setSteps] = useState<boolean | undefined>(undefined);
  const [stepsDirection, setStepsDirection] = useState('');
  const [latitude, setLatitude] = useState(0);
  const [longitude, setLongitude] = useState(0);
  const [dmsCoords, setDmsCoords] = useState('Acquiring GPS...');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  /** Phone GPS for a new structure, before the job's calibration shift */
  const [rawPos, setRawPos] = useState<{latitude: number; longitude: number} | null>(null);
  const [recordedCalPoint, setRecordedCalPoint] = useState<string | undefined>(undefined);

  // Pipes
  const [pipes, setPipes] = useState<Pipe[]>([newPipe(SPIKE_TEMPLATE)]);

  // Internal id of the saved structure. Empty for a new structure until it is
  // first saved — which now happens automatically when switching tabs or
  // opening Photos, so the structure is in the list and progress isn't lost.
  const [recordId, setRecordId] = useState(structureId ?? '');
  const isEditing = !!recordId;
  const savingRef = useRef(false);

  // Photo count for the Photos tab — refreshed whenever we come back from the Photo screen
  const [photoCount, setPhotoCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!recordId) return;
      loadJob(jobId).then(j => {
        const s = j?.structures.find(st => st.id === recordId);
        setPhotoCount(s ? getStructurePhotos(s).length : 0);
      });
    }, [jobId, recordId]),
  );

  // This job's pick lists (copied from its template when the job was created) + field additions
  const lists = job ? jobLists(job) : SPIKE_TEMPLATE;
  const allStructureTypes = unique([...lists.structureTypes, ...customTypes]);
  const allPipeSizes = unique([...lists.pipeSizes, ...customSizes]);
  const allPipeMaterials = unique([...lists.pipeMaterials, ...customMaterials]);
  const allConstructionTypes = unique([...lists.constructionTypes, ...customConstruction]);
  const has = (id: StructureFieldId) => lists.structureFields.includes(id);
  const stationOk = formatStation(station) !== null;
  const offsetOk = formatOffset(offset) !== null;

  useEffect(() => {
    loadJob(jobId).then(j => {
      setJob(j);
      if (j) {
        // Load any custom types saved on this job
        if (j.customStructureTypes) {
          setCustomTypes(j.customStructureTypes);
        }
        if (j.customPipeSizes) {
          setCustomSizes(j.customPipeSizes);
        }
        if (j.customPipeMaterials) {
          setCustomMaterials(j.customPipeMaterials);
        }
        if (j.customConstructionTypes) {
          setCustomConstruction(j.customConstructionTypes);
        }
        if (!structureId) {
          // New structure: start from this job's own lists
          const jl = jobLists(j);
          if (jl.structureTypes[0]) setStructType(jl.structureTypes[0]);
          setPipes([newPipe(jl)]);
        }
        if (structureId) {
          const existing = j.structures.find(s => s.id === structureId);
          if (existing) {
            setStructId(existing.structureId);
            setStructType(existing.type);
            setStreet(existing.street);
            setRimElevation(existing.rimElevation);
            setCastingWidth(existing.castingWidth ?? '');
            setCastingLength(
              existing.castingShape === 'rectangular' ? existing.castingLength ?? '' : '',
            );
            setDepth(existing.depth);
            setNotes(existing.notes);
            setCity(existing.city ?? '');
            setStation(existing.station ?? '');
            setOffset(existing.offset ?? '');
            setOffsetSide(existing.offsetSide);
            setSizeLength(existing.sizeLength ?? '');
            setSizeWidth(existing.sizeWidth ?? '');
            setSizeHeight(existing.sizeHeight ?? '');
            setConstructionType(existing.constructionType ?? '');
            setCondition(existing.condition ?? '');
            setSump(existing.sump);
            setSumpDepth(existing.sumpDepth ?? '');
            setNeedsCleaning(existing.needsCleaning);
            setSteps(existing.steps);
            setStepsDirection(existing.stepsDirection ?? '');
            setLatitude(existing.latitude);
            setLongitude(existing.longitude);
            setDmsCoords(existing.dmsCoordinates);
            setRecordedCalPoint(existing.calibrationPoint);
            setPipes(existing.pipes);
          }
        }
      }
    });

    Geolocation.getCurrentPosition(
      pos => {
        const {latitude: lat, longitude: lon, accuracy} = pos.coords;
        // The job's calibration (if any) is applied below, once the job is loaded
        setRawPos({latitude: lat, longitude: lon});
        setGpsAccuracy(accuracy);
      },
      () => {
        setDmsCoords('GPS unavailable');
      },
      {enableHighAccuracy: true, timeout: 15000, maximumAge: 10000},
    );
  }, [jobId, structureId]);

  // New structure: position = phone GPS + the job's calibration shift
  const calibration = job?.calibration ?? null;
  useEffect(() => {
    if (!rawPos) return;
    const p = applyCalibration(rawPos.latitude, rawPos.longitude, calibration);
    setLatitude(p.latitude);
    setLongitude(p.longitude);
    setDmsCoords(decimalToDMS(p.latitude, p.longitude));
  }, [rawPos, calibration]);
  const calStale = calibration && rawPos ? staleness(calibration, new Date(), rawPos) : null;

  function addPipe() {
    setPipes(prev => [...prev, newPipe(lists)]);
  }

  function removePipe(id: string) {
    setPipes(prev => prev.filter(p => p.id !== id));
  }

  function updatePipe(id: string, field: keyof Pipe, value: any) {
    setPipes(prev =>
      prev.map(p => (p.id === id ? {...p, [field]: value} : p)),
    );
  }

  async function handleAddCustomType() {
    const trimmed = newCustomType.trim();
    if (!trimmed) return;
    if (allStructureTypes.includes(trimmed)) {
      Alert.alert('Already exists', 'That structure type already exists.');
      return;
    }
    const updated = [...customTypes, trimmed];
    setCustomTypes(updated);
    setStructType(trimmed);
    setNewCustomType('');
    setCustomTypeModalVisible(false);

    // Save custom types to job
    await saveJobLists({customStructureTypes: updated});
  }

  // Save a job-level list (custom types / sizes) without overwriting newer changes
  async function saveJobLists(patch: Partial<Job>) {
    const latest = (await loadJob(jobId)) ?? job;
    if (!latest) return;
    const updatedJob = {...latest, ...patch};
    await saveJob(updatedJob);
    setJob(updatedJob);
  }

  async function handleAddConstruction() {
    const value = newConstruction.trim();
    if (!value) return;
    setConstructionModalVisible(false);
    setNewConstruction('');
    const existing = allConstructionTypes.find(t => t.toLowerCase() === value.toLowerCase());
    if (existing) {
      setConstructionType(existing);
      return;
    }
    setConstructionType(value);
    const updated = [...customConstruction, value];
    setCustomConstruction(updated);
    await saveJobLists({customConstructionTypes: updated});
  }

  /** Yes / No buttons; tapping the selected one again clears it */
  function yesNo(value: boolean | undefined, set: (v: boolean | undefined) => void) {
    return (
      <View style={styles.segmented}>
        {([true, false] as const).map(v => (
          <TouchableOpacity
            key={String(v)}
            style={[styles.segmentBtn, value === v && styles.segmentBtnActive]}
            onPress={() => set(value === v ? undefined : v)}>
            <Text style={[styles.segmentText, value === v && styles.segmentTextActive]}>
              {v ? 'Yes' : 'No'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  /** Row of choice chips; tapping the selected one again clears it */
  function chips(options: string[], value: string, set: (v: string) => void, extra?: React.ReactNode) {
    return (
      <View style={styles.sizeRow}>
        {options.map(o => (
          <TouchableOpacity
            key={o}
            style={[styles.sizeBtn, value === o && styles.sizeBtnActive]}
            onPress={() => set(value === o ? '' : o)}>
            <Text style={[styles.sizeBtnText, value === o && styles.sizeBtnTextActive]}>{o}</Text>
          </TouchableOpacity>
        ))}
        {/* A value recorded earlier that isn't in the list (still shown as selected) */}
        {!!value && !options.includes(value) && (
          <View style={[styles.sizeBtn, styles.sizeBtnActive]}>
            <Text style={[styles.sizeBtnText, styles.sizeBtnTextActive]}>{value}</Text>
          </View>
        )}
        {extra}
      </View>
    );
  }

  function openCustomSize(pipeId: string) {
    setNewCustomSize('');
    setCustomSizePipeId(pipeId);
  }

  async function handleAddCustomSize() {
    let size = newCustomSize.trim();
    if (!size) return;
    // A plain number means inches: 54 -> 54"
    if (/^\d+(\.\d+)?$/.test(size)) size = `${size}"`;
    const pipeId = customSizePipeId;
    setCustomSizePipeId(null);
    setNewCustomSize('');
    if (pipeId) updatePipe(pipeId, 'size', size);
    if (allPipeSizes.includes(size)) return; // already in the list — just select it
    const updated = [...customSizes, size];
    setCustomSizes(updated);
    await saveJobLists({customPipeSizes: updated});
  }

  function openCustomMaterial(pipeId: string) {
    setNewCustomMaterial('');
    setCustomMaterialPipeId(pipeId);
  }

  async function handleAddCustomMaterial() {
    const material = newCustomMaterial.trim();
    if (!material) return;
    const pipeId = customMaterialPipeId;
    setCustomMaterialPipeId(null);
    setNewCustomMaterial('');
    if (pipeId) updatePipe(pipeId, 'material', material);
    // Already in the list (ignoring upper/lower case)? Just select the existing one
    const existing = allPipeMaterials.find(
      m => m.toLowerCase() === material.toLowerCase(),
    );
    if (existing) {
      if (pipeId) updatePipe(pipeId, 'material', existing);
      return;
    }
    const updated = [...customMaterials, material];
    setCustomMaterials(updated);
    await saveJobLists({customPipeMaterials: updated});
  }

  /**
   * Write the form to the job file. Returns the structure's internal id, or
   * null if it couldn't be saved (no Structure ID yet, or a save already running).
   * Does not leave the screen.
   */
  async function persistStructure(): Promise<string | null> {
    if (!structId.trim() || !job || savingRef.current) return null;
    savingRef.current = true;
    try {
      return await writeStructure();
    } finally {
      savingRef.current = false;
    }
  }

  async function writeStructure(): Promise<string> {
    // Re-read the job from disk so changes made on other screens since this
    // one opened (e.g. a photo taken on the Photo screen) aren't overwritten.
    const latestJob = (await loadJob(jobId)) ?? job!;
    const existing = recordId
      ? latestJob.structures.find(s => s.id === recordId)
      : undefined;

    const structure: Structure = {
      // Keep fields this screen doesn't edit (photos, etc.)
      ...existing,
      id: recordId || generateId(),
      jobId,
      structureId: structId.trim(),
      type: structType,
      street: street.trim(),
      rimElevation: rimElevation.trim(),
      castingShape: castingLength.trim() ? 'rectangular' : 'round',
      castingWidth: castingWidth.trim(),
      castingLength: castingLength.trim(),
      depth: depth.trim(),
      notes: notes.trim(),
      // Optional details ('' / undefined when not recorded). Values are kept even
      // if the template later turns a field off.
      city: city.trim() || undefined,
      station: (formatStation(station) ?? station.trim()) || undefined,
      offset: (formatOffset(offset) ?? offset.trim()) || undefined,
      offsetSide: offset.trim() ? offsetSide : undefined,
      sizeLength: sizeLength.trim() || undefined,
      sizeWidth: sizeWidth.trim() || undefined,
      sizeHeight: sizeHeight.trim() || undefined,
      constructionType: constructionType || undefined,
      condition: condition || undefined,
      sump,
      sumpDepth: sump ? sumpDepth.trim() || undefined : undefined,
      needsCleaning,
      steps,
      stepsDirection: steps ? stepsDirection || undefined : undefined,
      latitude,
      longitude,
      dmsCoordinates: dmsCoords,
      // A new GPS fix: keep the raw reading and which calibration was applied
      ...(rawPos
        ? {
            rawLatitude: rawPos.latitude,
            rawLongitude: rawPos.longitude,
            calibrationId: calibration?.id,
            calibrationPoint: calibration?.pointName,
          }
        : {}),
      pipes,
      // Keep the original date when editing; only new structures get "now"
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    // If the Structure ID changed, rename its photo files to match (MH-12_1.jpg → MH-14_1.jpg)
    if (existing) {
      const existingPhotos = getStructurePhotos(existing);
      if (
        existingPhotos.length > 0 &&
        photoFileBase(existing.structureId) !== photoFileBase(structure.structureId)
      ) {
        try {
          structure.photos = await renameStructurePhotos(
            jobId,
            existingPhotos,
            structure.structureId,
          );
          delete structure.photoPath;
        } catch {
          Alert.alert(
            'Photos not renamed',
            'The structure was saved, but its photo files kept their old names.',
          );
        }
      }
    }

    const streets = [...(latestJob.streets || [])];
    if (street.trim() && !streets.includes(street.trim())) {
      streets.push(street.trim());
    }

    const updatedStructures = existing
      ? latestJob.structures.map(s => (s.id === structure.id ? structure : s))
      : [...latestJob.structures, structure];

    const updatedJob: Job = {
      ...latestJob,
      structures: updatedStructures,
      streets,
      customStructureTypes: customTypes,
      updatedAt: new Date().toISOString(),
    };

    await saveJob(updatedJob);
    setJob(updatedJob);
    setRecordId(structure.id);
    return structure.id;
  }

  // Header "Save": check for likely typos, then save and go back to the list
  async function handleSave() {
    if (!structId.trim()) {
      Alert.alert('Required', 'Please enter a Structure ID.');
      return;
    }
    const saveAndLeave = async () => {
      if (await persistStructure()) navigation.goBack();
    };
    const latest = (await loadJob(jobId)) ?? job;
    const warnings = checkStructure({
      recordId,
      structureId: structId,
      rimElevation,
      depth,
      pipes,
      others: latest?.structures ?? [],
      castingWidth,
      castingLength,
      station: has('staOffset') ? station : undefined,
      offset: has('staOffset') ? offset : undefined,
      sizeLength: has('structureSize') ? sizeLength : undefined,
      sizeWidth: has('structureSize') ? sizeWidth : undefined,
      sizeHeight: has('structureSize') ? sizeHeight : undefined,
      sumpDepth: has('sump') && sump ? sumpDepth : undefined,
    });
    if (warnings.length === 0) {
      await saveAndLeave();
      return;
    }
    Alert.alert(
      warnings.length === 1 ? 'Check this before saving' : `Check these ${warnings.length} things before saving`,
      warnings.map(w => `• ${w}`).join('\n\n'),
      [
        {text: 'Go back and fix', style: 'cancel'},
        {text: 'Save anyway', onPress: saveAndLeave},
      ],
    );
  }

  // Switching Structure ⇄ Pipes auto-saves once there's a Structure ID
  async function switchTab(tab: ActiveTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    await persistStructure();
  }

  // Photos: auto-save first (a new structure needs its ID for photo file names)
  async function openPhotos() {
    if (!structId.trim()) {
      Alert.alert(
        'Structure ID needed',
        'Enter a Structure ID first — photos are named after it (e.g. MH-12_1.jpg).',
      );
      setActiveTab('structure');
      return;
    }
    const id = await persistStructure();
    if (id) navigation.navigate('Photo', {jobId, structureId: id});
  }

  const filteredStreets =
    job?.streets.filter(
      s => s.toLowerCase().includes(street.toLowerCase()) && s !== street,
    ) || [];

  if (!job) return null;

  return (
    <KeyboardSafeView style={styles.container}>

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isEditing ? `Edit ${structId}` : 'New Structure'}
        </Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.gpsBar}>
        <View style={[styles.gpsDot, {backgroundColor: latitude !== 0 ? '#1D9E75' : '#E8B84B'}]} />
        <Text style={styles.gpsText}>{dmsCoords}</Text>
        {gpsAccuracy && (
          <Text style={styles.gpsAccuracy}>±{gpsAccuracy.toFixed(0)}m</Text>
        )}
      </View>
      {/* Calibration in use for this position */}
      {rawPos && calibration ? (
        <View style={[styles.calLine, calStale && styles.calLineStale]}>
          <Text style={styles.calLineText}>
            {calStale
              ? `⚠ ${calStale} (Job screen → GPS calibration)`
              : `Calibrated at ${calibration.pointName} — shift applied`}
          </Text>
        </View>
      ) : !rawPos && recordedCalPoint ? (
        <View style={styles.calLine}>
          <Text style={styles.calLineText}>Recorded with calibration at {recordedCalPoint}</Text>
        </View>
      ) : null}

  <View style={styles.tabBar}>
        {(['structure', 'pipes'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => switchTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'structure' ? 'Structure' : `Pipes (${pipes.length})`}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.tab} onPress={openPhotos}>
          <Text style={styles.tabText}>
            📷 Photos{photoCount > 0 ? ` (${photoCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" {...keyboardScroll}>
        {activeTab === 'structure' && (
          <View style={styles.formContainer}>

            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>STRUCTURE ID *</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. MH-01"
                value={structId}
                onChangeText={setStructId}
                placeholderTextColor={c.placeholder}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>STRUCTURE TYPE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.typeRow}>
                  {allStructureTypes.map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeBtn,
                        structType === type && styles.typeBtnActive,
                      ]}
                      onPress={() => setStructType(type)}>
                      <Text
                        style={[
                          styles.typeBtnText,
                          structType === type && styles.typeBtnTextActive,
                        ]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {/* A type recorded earlier that isn't in this job's list (still shown as selected) */}
                  {!!structType && !allStructureTypes.includes(structType) && (
                    <View style={[styles.typeBtn, styles.typeBtnActive]}>
                      <Text style={[styles.typeBtnText, styles.typeBtnTextActive]}>
                        {structType}
                      </Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.typeBtnCustom}
                    onPress={() => setCustomTypeModalVisible(true)}>
                    <Text style={styles.typeBtnCustomText}>+ Custom</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>

            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>STREET</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. Westfield Ave"
                value={street}
                onChangeText={t => {
                  setStreet(t);
                  setShowStreetSuggestions(true);
                }}
                onFocus={() => setShowStreetSuggestions(true)}
                onBlur={() => setTimeout(() => setShowStreetSuggestions(false), 150)}
                placeholderTextColor={c.placeholder}
              />
              {showStreetSuggestions && filteredStreets.length > 0 && (
                <View style={styles.suggestions}>
                  {filteredStreets.map(s => (
                    <TouchableOpacity
                      key={s}
                      style={styles.suggestionItem}
                      onPress={() => {
                        setStreet(s);
                        setShowStreetSuggestions(false);
                      }}>
                      <Text style={styles.suggestionText}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {has('city') && (
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>CITY</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="e.g. North Olmsted"
                  value={city}
                  onChangeText={setCity}
                  autoCapitalize="words"
                  placeholderTextColor={c.placeholder}
                />
              </View>
            )}

            {has('staOffset') && (
              <View style={styles.formCard}>
                <View style={styles.castingRow}>
                  <View style={styles.castingCol}>
                    <Text style={styles.fieldLabel}>STA</Text>
                    <TextInput
                      style={styles.fieldInput}
                      placeholder="e.g. 12+34.56"
                      value={station}
                      onChangeText={setStation}
                      onEndEditing={() => {
                        const f = formatStation(station);
                        if (f !== null) setStation(f);
                      }}
                      keyboardType="numbers-and-punctuation"
                      placeholderTextColor={c.placeholder}
                    />
                  </View>
                  <View style={styles.castingCol}>
                    <Text style={styles.fieldLabel}>OFFSET (ft)</Text>
                    <TextInput
                      style={styles.fieldInput}
                      placeholder="e.g. 12.50"
                      value={offset}
                      onChangeText={setOffset}
                      onEndEditing={() => {
                        const f = formatOffset(offset);
                        if (f !== null) setOffset(f);
                      }}
                      keyboardType="decimal-pad"
                      placeholderTextColor={c.placeholder}
                    />
                  </View>
                  <View style={styles.sideToggle}>
                    {(['LT', 'RT'] as const).map(side => (
                      <TouchableOpacity
                        key={side}
                        style={[styles.sideBtn, offsetSide === side && styles.segmentBtnActive]}
                        onPress={() => setOffsetSide(offsetSide === side ? undefined : side)}>
                        <Text style={[styles.segmentText, offsetSide === side && styles.segmentTextActive]}>
                          {side}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                {!stationOk || !offsetOk ? (
                  <Text style={[styles.castingHint, {color: c.danger}]}>
                    {!stationOk ? 'Station: use 12+34.56 or 1234.56. ' : ''}
                    {!offsetOk ? 'Offset: a number of feet, e.g. 12.50.' : ''}
                  </Text>
                ) : null}
              </View>
            )}

            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>RIM ELEVATION (ft) — optional</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. 892.5"
                value={rimElevation}
                onChangeText={setRimElevation}
                keyboardType="decimal-pad"
                placeholderTextColor={c.placeholder}
              />
            </View>

            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>CASTING SIZE (ft)</Text>
              <View style={styles.castingRow}>
                <View style={styles.castingCol}>
                  <Text style={styles.rectLabel}>
                    {castingLength.trim() ? 'Width' : 'Diameter / Width'}
                  </Text>
                  <TextInput
                    style={styles.fieldInput}
                    placeholder="e.g. 2.0"
                    value={castingWidth}
                    onChangeText={setCastingWidth}
                    keyboardType="decimal-pad"
                    placeholderTextColor={c.placeholder}
                  />
                </View>
                <Text style={styles.castingX}>×</Text>
                <View style={styles.castingCol}>
                  <Text style={styles.rectLabel}>Length</Text>
                  <TextInput
                    style={styles.fieldInput}
                    placeholder="blank = round"
                    value={castingLength}
                    onChangeText={setCastingLength}
                    keyboardType="decimal-pad"
                    placeholderTextColor={c.placeholder}
                  />
                </View>
              </View>
              <Text style={styles.castingHint}>
                {!castingWidth.trim()
                  ? 'Round: enter the diameter only. Rectangular: enter width and length.'
                  : !castingLength.trim()
                    ? `Round, ${castingWidth.trim()}' diameter`
                    : castingLength.trim() === castingWidth.trim()
                      ? `Square, ${castingWidth.trim()}' × ${castingLength.trim()}'`
                      : `Rectangular, ${castingWidth.trim()}' × ${castingLength.trim()}'`}
              </Text>
            </View>

            {has('structureSize') && (
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>STRUCTURE SIZE (ft)</Text>
                <View style={styles.castingRow}>
                  {(
                    [
                      [sizeWidth.trim() ? 'Length' : 'DIA / Length', sizeLength, setSizeLength, 'e.g. 4.0'],
                      ['Width', sizeWidth, setSizeWidth, 'blank = round'],
                      ['Height', sizeHeight, setSizeHeight, 'e.g. 8.0'],
                    ] as const
                  ).map(([label, value, set, ph]) => (
                    <View key={label} style={styles.castingCol}>
                      <Text style={styles.rectLabel}>{label}</Text>
                      <TextInput
                        style={styles.fieldInput}
                        placeholder={ph}
                        value={value}
                        onChangeText={set}
                        keyboardType="decimal-pad"
                        placeholderTextColor={c.placeholder}
                      />
                    </View>
                  ))}
                </View>
                <Text style={styles.castingHint}>
                  Round: diameter and height. Rectangular: length, width and height.
                </Text>
              </View>
            )}

            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>STRUCTURE DEPTH (ft)</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. 6.0"
                value={depth}
                onChangeText={setDepth}
                keyboardType="decimal-pad"
                placeholderTextColor={c.placeholder}
              />
            </View>

            {has('constructionType') && (
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>CONSTRUCTION TYPE</Text>
                {chips(
                  allConstructionTypes,
                  constructionType,
                  setConstructionType,
                  <TouchableOpacity
                    style={styles.typeBtnCustom}
                    onPress={() => setConstructionModalVisible(true)}>
                    <Text style={styles.typeBtnCustomText}>+ Custom</Text>
                  </TouchableOpacity>,
                )}
              </View>
            )}

            {has('condition') && (
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>CONDITION</Text>
                {chips(lists.conditions, condition, setCondition)}
              </View>
            )}

            {has('sump') && (
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>SUMP</Text>
                {yesNo(sump, setSump)}
                {sump === true && (
                  <>
                    <Text style={[styles.fieldLabel, {marginTop: 12}]}>
                      SUMP DEPTH BELOW LOWEST INVERT (ft)
                    </Text>
                    <TextInput
                      style={styles.fieldInput}
                      placeholder="e.g. 1.50"
                      value={sumpDepth}
                      onChangeText={setSumpDepth}
                      keyboardType="decimal-pad"
                      placeholderTextColor={c.placeholder}
                    />
                  </>
                )}
              </View>
            )}

            {has('needsCleaning') && (
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>NEEDS CLEANING</Text>
                {yesNo(needsCleaning, setNeedsCleaning)}
              </View>
            )}

            {has('steps') && (
              <View style={styles.formCard}>
                <Text style={styles.fieldLabel}>STEPS</Text>
                {yesNo(steps, setSteps)}
                {steps === true && (
                  <>
                    <Text style={[styles.fieldLabel, {marginTop: 12}]}>STEPS ON WHICH SIDE</Text>
                    <View style={styles.dirGrid}>
                      {DIRECTIONS.map(dir => (
                        <TouchableOpacity
                          key={dir}
                          style={[styles.dirBtn, stepsDirection === dir && styles.dirBtnActive]}
                          onPress={() => setStepsDirection(stepsDirection === dir ? '' : dir)}>
                          <Text
                            style={[styles.dirBtnText, stepsDirection === dir && styles.dirBtnTextActive]}>
                            {dir}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}

            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>NOTES</Text>
              <TextInput
                style={[styles.fieldInput, {minHeight: 60}]}
                placeholder="Optional notes"
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholderTextColor={c.placeholder}
              />
            </View>

            <View style={styles.bottomPad} />
          </View>
        )}

        {activeTab === 'pipes' && (
          <View style={styles.formContainer}>
            {pipes.length === 0 && (
              <View style={styles.noPipesCard}>
                <Text style={styles.noPipesTitle}>No pipes recorded</Text>
                <Text style={styles.noPipesSub}>
                  This structure will be saved without pipe data. Tap "+ Add Pipe" if you need to record one.
                </Text>
              </View>
            )}

            {pipes.map((pipe, index) => (
              <View key={pipe.id} style={styles.pipeCard}>
                <View style={styles.pipeCardHeader}>
                  <Text style={styles.pipeTitle}>Pipe {index + 1}</Text>
                  <TouchableOpacity onPress={() => removePipe(pipe.id)}>
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>DIRECTION LEAVING STRUCTURE</Text>
                <View style={styles.dirGrid}>
                  {DIRECTIONS.map(dir => (
                    <TouchableOpacity
                      key={dir}
                      style={[styles.dirBtn, pipe.direction === dir && styles.dirBtnActive]}
                      onPress={() => updatePipe(pipe.id, 'direction', dir)}>
                      <Text style={[styles.dirBtnText, pipe.direction === dir && styles.dirBtnTextActive]}>
                        {dir}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[styles.fieldLabel, {marginTop: 12}]}>SIZE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.sizeRow}>
                    {allPipeSizes.map(size => (
                      <TouchableOpacity
                        key={size}
                        style={[styles.sizeBtn, pipe.size === size && styles.sizeBtnActive]}
                        onPress={() => updatePipe(pipe.id, 'size', size)}>
                        <Text style={[styles.sizeBtnText, pipe.size === size && styles.sizeBtnTextActive]}>
                          {size}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {/* A size recorded earlier that isn't in the list (still shown as selected) */}
                    {!!pipe.size && !allPipeSizes.includes(pipe.size) && (
                      <View style={[styles.sizeBtn, styles.sizeBtnActive]}>
                        <Text style={[styles.sizeBtnText, styles.sizeBtnTextActive]}>
                          {pipe.size}
                        </Text>
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.typeBtnCustom}
                      onPress={() => openCustomSize(pipe.id)}>
                      <Text style={styles.typeBtnCustomText}>+ Custom</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>

                <Text style={[styles.fieldLabel, {marginTop: 12}]}>MATERIAL</Text>
                <View style={styles.sizeRow}>
                  {allPipeMaterials.map(mat => (
                    <TouchableOpacity
                      key={mat}
                      style={[styles.sizeBtn, pipe.material === mat && styles.sizeBtnActive]}
                      onPress={() => updatePipe(pipe.id, 'material', mat)}>
                      <Text style={[styles.sizeBtnText, pipe.material === mat && styles.sizeBtnTextActive]}>
                        {mat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {/* A material recorded earlier that isn't in the list (still shown as selected) */}
                  {!!pipe.material && !allPipeMaterials.includes(pipe.material) && (
                    <View style={[styles.sizeBtn, styles.sizeBtnActive]}>
                      <Text style={[styles.sizeBtnText, styles.sizeBtnTextActive]}>
                        {pipe.material}
                      </Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.typeBtnCustom}
                    onPress={() => openCustomMaterial(pipe.id)}>
                    <Text style={styles.typeBtnCustomText}>+ Custom</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabel, {marginTop: 12}]}>
                  DEPTH BELOW RIM (ft) — enter as negative
                </Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="e.g. -6.0"
                  value={pipe.depthBelowRim === 0 ? '' : String(pipe.depthBelowRim)}
                  onChangeText={t => updatePipe(pipe.id, 'depthBelowRim', parseFloat(t) || 0)}
                  keyboardType="numbers-and-punctuation"
                  placeholderTextColor={c.placeholder}
                />
              </View>
            ))}

            <TouchableOpacity style={styles.addPipeBtn} onPress={addPipe}>
              <Text style={styles.addPipeBtnText}>
                {pipes.length === 0 ? '+ Add Pipe' : '+ Add Another Pipe'}
              </Text>
            </TouchableOpacity>

            <View style={styles.bottomPad} />
          </View>
        )}
      </ScrollView>

      {/* Custom Type Modal */}
      <Modal
        visible={customTypeModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCustomTypeModalVisible(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setCustomTypeModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Custom Type</Text>
            <TouchableOpacity onPress={handleAddCustomType}>
              <Text style={styles.modalSave}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>STRUCTURE TYPE NAME</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Flared end section"
              value={newCustomType}
              onChangeText={setNewCustomType}
              placeholderTextColor={c.placeholder}
              autoFocus
            />
            <Text style={styles.modalHint}>
              This type will be saved to this job and available for all structures within it.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Custom Pipe Size Modal */}
      <Modal
        visible={customSizePipeId !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCustomSizePipeId(null)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setCustomSizePipeId(null)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Custom Pipe Size</Text>
            <TouchableOpacity onPress={handleAddCustomSize}>
              <Text style={styles.modalSave}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>PIPE SIZE / DIMENSIONS</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={'e.g. 54   or   19" x 30"   or   4\' x 6\''}
              value={newCustomSize}
              onChangeText={setNewCustomSize}
              onSubmitEditing={handleAddCustomSize}
              returnKeyType="done"
              placeholderTextColor={c.placeholder}
              autoFocus
            />
            <Text style={styles.modalHint}>
              A plain number is treated as inches (54 → 54"). For elliptical, arch or box
              pipe, type the dimensions as you want them to appear in the CSV. The size will
              be saved to this job and available for every pipe in it.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Custom Pipe Material Modal */}
      <Modal
        visible={customMaterialPipeId !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCustomMaterialPipeId(null)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setCustomMaterialPipeId(null)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Custom Pipe Material</Text>
            <TouchableOpacity onPress={handleAddCustomMaterial}>
              <Text style={styles.modalSave}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>PIPE MATERIAL</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Brick, CIPP, ABS, Transite"
              value={newCustomMaterial}
              onChangeText={setNewCustomMaterial}
              onSubmitEditing={handleAddCustomMaterial}
              returnKeyType="done"
              autoCapitalize="words"
              placeholderTextColor={c.placeholder}
              autoFocus
            />
            <Text style={styles.modalHint}>
              The material will be saved to this job and available for every pipe in it.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Custom Construction Type Modal */}
      <Modal
        visible={constructionModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setConstructionModalVisible(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setConstructionModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Custom Construction</Text>
            <TouchableOpacity onPress={handleAddConstruction}>
              <Text style={styles.modalSave}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.modalBody}>
            <Text style={styles.fieldLabel}>CONSTRUCTION TYPE</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. HDPE, Fiberglass"
              value={newConstruction}
              onChangeText={setNewConstruction}
              onSubmitEditing={handleAddConstruction}
              returnKeyType="done"
              autoCapitalize="words"
              placeholderTextColor={c.placeholder}
              autoFocus
            />
            <Text style={styles.modalHint}>
              It will be saved to this job and available for every structure in it.
            </Text>
          </View>
        </View>
      </Modal>
    </KeyboardSafeView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bg},
  header: {
    backgroundColor: c.primary,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  backText: {color: 'rgba(255,255,255,0.85)', fontSize: 17},
  headerTitle: {fontSize: 17, fontWeight: '600', color: 'white'},
  saveText: {fontSize: 16, color: 'rgba(255,255,255,0.95)', fontWeight: '600'},
  gpsBar: {
    backgroundColor: c.primaryDark,
    paddingHorizontal: 16,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gpsDot: {width: 8, height: 8, borderRadius: 4},
  gpsText: {fontSize: 11, color: 'rgba(255,255,255,0.85)', flex: 1, fontFamily: 'monospace'},
  gpsAccuracy: {fontSize: 10, color: 'rgba(255,255,255,0.5)'},
  calLine: {backgroundColor: c.primaryDark, paddingHorizontal: 16, paddingBottom: 6},
  calLineStale: {backgroundColor: '#8A6414'},
  calLineText: {fontSize: 11, color: 'rgba(255,255,255,0.8)'},
  tabBar: {
    flexDirection: 'row',
    backgroundColor: c.card,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {borderBottomColor: c.primaryBorder},
  tabText: {fontSize: 14, color: c.textMuted, fontWeight: '500'},
  tabTextActive: {color: c.accentText},
  scroll: {flex: 1},
  formContainer: {padding: 16, gap: 12},
  formCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: c.textMuted,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  fieldInput: {
    fontSize: 15,
    color: c.text,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
    paddingBottom: 8,
  },
  typeRow: {flexDirection: 'row', gap: 8},
  typeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bg,
  },
  typeBtnActive: {backgroundColor: c.primary, borderColor: c.primaryBorder},
  typeBtnText: {fontSize: 12, color: c.textSecondary, fontWeight: '500'},
  typeBtnTextActive: {color: 'white'},
  typeBtnCustom: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.primaryBorder,
    borderStyle: 'dashed',
    backgroundColor: c.card,
  },
  typeBtnCustomText: {fontSize: 12, color: c.accentText, fontWeight: '500'},
  segmented: {flexDirection: 'row', gap: 8},
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    backgroundColor: c.bg,
  },
  segmentBtnActive: {backgroundColor: c.primary, borderColor: c.primaryBorder},
  segmentText: {fontSize: 13, color: c.textMuted, fontWeight: '500'},
  segmentTextActive: {color: 'white'},
  sizeRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  sizeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bg,
  },
  sizeBtnActive: {backgroundColor: c.primary, borderColor: c.primaryBorder},
  sizeBtnText: {fontSize: 13, color: c.textSecondary, fontWeight: '500'},
  sizeBtnTextActive: {color: 'white'},
  rectRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  rectCol: {flex: 1, gap: 8},
  rectLabel: {fontSize: 11, color: c.textMuted, textAlign: 'center'},
  rectX: {fontSize: 20, color: c.textMuted, marginTop: 28},
  castingRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 12},
  castingCol: {flex: 1, gap: 6},
  castingX: {fontSize: 18, color: c.textMuted, paddingBottom: 8},
  castingHint: {fontSize: 12, color: c.textMuted, marginTop: 10},
  sideToggle: {flexDirection: 'row', gap: 6, paddingBottom: 4},
  sideBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bg,
  },
  dirGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  dirBtn: {
    width: '22%',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    backgroundColor: c.bg,
  },
  dirBtnActive: {backgroundColor: c.primary, borderColor: c.primaryBorder},
  dirBtnText: {fontSize: 13, color: c.textSecondary, fontWeight: '600'},
  dirBtnTextActive: {color: 'white'},
  pipeCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  pipeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pipeTitle: {fontSize: 15, fontWeight: '700', color: c.text},
  removeText: {fontSize: 13, color: c.danger},
  addPipeBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: c.primaryBorder,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  addPipeBtnText: {fontSize: 14, color: c.accentText, fontWeight: '600'},
  noPipesCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
  },
  noPipesTitle: {fontSize: 15, fontWeight: '600', color: c.text},
  noPipesSub: {
    fontSize: 13,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  suggestions: {
    backgroundColor: c.card,
    borderWidth: 0.5,
    borderColor: c.border,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
  },
  suggestionText: {fontSize: 14, color: c.text},
  bottomPad: {height: 40},
  modal: {flex: 1, backgroundColor: c.bg},
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: c.card,
    borderBottomWidth: 0.5,
    borderBottomColor: c.border,
  },
  modalTitle: {fontSize: 16, fontWeight: '600', color: c.text},
  modalCancel: {fontSize: 16, color: c.textMuted},
  modalSave: {fontSize: 16, color: c.accentText, fontWeight: '600'},
  modalBody: {
    backgroundColor: c.card,
    margin: 16,
    borderRadius: 12,
    padding: 16,
  },
  modalInput: {
    fontSize: 15,
    color: c.text,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
    paddingBottom: 8,
    marginBottom: 12,
  },
  modalHint: {
    fontSize: 12,
    color: c.textMuted,
    lineHeight: 18,
  },
});