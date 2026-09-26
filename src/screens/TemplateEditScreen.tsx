import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  Switch,
} from 'react-native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp} from '@react-navigation/native';
import {RootStackParamList} from '../navigation/AppNavigator';
import KeyboardSafeView, {useKeyboardScroll} from '../components/KeyboardSafeView';
import {useTheme, ThemeColors} from '../theme';
import {makeScreenStyles} from './SettingsScreen';
import SelectField, {SelectOption} from '../components/SelectField';
import {STRUCTURE_FIELDS, StructureFieldId, cleanFieldList} from '../data/structureFields';
import {generateId, loadJob} from '../storage/storage';
import {
  JobTemplate,
  TemplateLists,
  SPIKE_TEMPLATE,
  getTemplate,
  saveTemplate,
  templateFromJob,
} from '../storage/templates';
import {
  STATE_PLANE_ZONES,
  UTM_ZONES,
  GEOGRAPHIC_ZONE,
  HORIZONTAL_DATUMS,
  VERTICAL_DATUMS,
  UNIT_OPTIONS,
  CoordinateSystem,
  CoordinateUnits,
  findZone,
} from '../data/coordinateSystems';
import {projectionFor, isGeographic} from '../utils/projection';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TemplateEdit'>;
  route: RouteProp<RootStackParamList, 'TemplateEdit'>;
};

const ZONE_OPTIONS: SelectOption[] = [
  ...STATE_PLANE_ZONES.map(z => ({value: z.id, label: z.label, group: 'State Plane (SPCS)'})),
  ...UTM_ZONES.map(z => ({value: z.id, label: z.label, group: 'UTM'})),
  {value: GEOGRAPHIC_ZONE.id, label: GEOGRAPHIC_ZONE.label, group: 'Geographic'},
];
const HDATUM_OPTIONS: SelectOption[] = HORIZONTAL_DATUMS.map(d => ({value: d.id, label: d.label}));
const VDATUM_OPTIONS: SelectOption[] = VERTICAL_DATUMS.map(d => ({value: d.id, label: d.label}));
const UNIT_SELECT: SelectOption[] = UNIT_OPTIONS.map(u => ({value: u.id, label: u.label}));

type ListKey = keyof TemplateLists;
const LIST_SECTIONS: {
  key: ListKey;
  title: string;
  placeholder: string;
  inches?: boolean;
  /** Only shown when this optional structure field is on */
  field?: StructureFieldId;
}[] = [
  {key: 'structureTypes', title: 'STRUCTURE TYPES', placeholder: 'e.g. Flared end section'},
  {key: 'pipeSizes', title: 'PIPE SIZES', placeholder: 'e.g. 54 or 19" x 30"', inches: true},
  {key: 'pipeMaterials', title: 'PIPE MATERIALS', placeholder: 'e.g. CIPP'},
  // Casting sizes are typed in on each structure now, so their lists aren't edited here
  {key: 'constructionTypes', title: 'CONSTRUCTION TYPES', placeholder: 'e.g. HDPE', field: 'constructionType'},
  {key: 'conditions', title: 'CONDITIONS', placeholder: 'e.g. Failing', field: 'condition'},
];

export default function TemplateEditScreen({navigation, route}: Props) {
  const {templateId, copyFromId, fromJobId} = route.params ?? {};
  const {colors: c} = useTheme();
  const screen = useMemo(() => makeScreenStyles(c), [c]);
  const styles = useMemo(() => makeStyles(c), [c]);
  const keyboardScroll = useKeyboardScroll(); // keep the focused box above the keyboard

  const [draft, setDraft] = useState<JobTemplate | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [newItems, setNewItems] = useState<Partial<Record<ListKey, string>>>({});
  const dirty = useRef(false);

  // Load the template being edited, or build a new one (copy of another template)
  useEffect(() => {
    (async () => {
      if (templateId) {
        const t = await getTemplate(templateId);
        if (t && !t.builtIn) {
          setDraft(JSON.parse(JSON.stringify(t)));
          setIsNew(false);
          return;
        }
      }
      // "Save as Template" from a job: start from the job's lists + coordinate system
      if (fromJobId) {
        const job = await loadJob(fromJobId);
        if (job) {
          const t = templateFromJob(job);
          t.id = generateId();
          setDraft(t);
          setIsNew(true);
          dirty.current = true;
          return;
        }
      }
      const source = (copyFromId && (await getTemplate(copyFromId))) || SPIKE_TEMPLATE;
      const copy: JobTemplate = JSON.parse(JSON.stringify(source));
      copy.id = generateId();
      copy.name = copyFromId ? `${source.name} copy` : 'New template';
      copy.version = 0;
      copy.owner = 'device';
      copy.builtIn = false;
      setDraft(copy);
      setIsNew(true);
      dirty.current = true;
    })();
  }, [templateId, copyFromId, fromJobId]);

  // Warn before leaving with unsaved changes (back button, swipe, or ‹ Cancel)
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      if (!dirty.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'Your changes to this template haven\'t been saved.', [
        {text: 'Keep editing', style: 'cancel'},
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            dirty.current = false;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return unsubscribe;
  }, [navigation]);

  if (!draft) return <View style={screen.container} />;

  function update(patch: Partial<JobTemplate>) {
    dirty.current = true;
    setDraft(d => (d ? {...d, ...patch} : d));
  }

  function updateCS(patch: Partial<CoordinateSystem>) {
    update({coordinateSystem: {...draft!.coordinateSystem, ...patch}});
  }

  function addItem(key: ListKey, inches?: boolean) {
    let value = (newItems[key] ?? '').trim();
    if (!value) return;
    if (inches && /^\d+(\.\d+)?$/.test(value)) value = `${value}"`;
    setNewItems(n => ({...n, [key]: ''}));
    const list = draft![key];
    if (list.some(v => v.toLowerCase() === value.toLowerCase())) return;
    update({[key]: [...list, value]} as Partial<JobTemplate>);
  }

  function toggleField(id: StructureFieldId, on: boolean) {
    const current = draft!.structureFields;
    const next = on ? [...current, id] : current.filter(f => f !== id);
    update({structureFields: cleanFieldList(next)}); // keep the standard order
  }

  function removeItem(key: ListKey, value: string) {
    update({[key]: draft![key].filter(v => v !== value)} as Partial<JobTemplate>);
  }

  async function handleSave() {
    const name = draft!.name.trim();
    if (!name) {
      Alert.alert('Name required', 'Please give this template a name.');
      return;
    }
    if (draft!.structureTypes.length === 0) {
      Alert.alert('Structure types', 'Add at least one structure type.');
      return;
    }
    await saveTemplate({
      ...draft!,
      name,
      version: (draft!.version || 0) + 1,
      updatedAt: new Date().toISOString(),
    });
    dirty.current = false;
    navigation.goBack();
    if (fromJobId) {
      Alert.alert(
        'Template saved',
        `"${name}" is now available when you create a new job, and under Settings → Templates.`,
      );
    }
  }

  const cs = draft.coordinateSystem;
  const zone = findZone(cs.zoneId);
  const noNad27Zone = projectionFor(cs) === null && !!zone;

  return (
    <KeyboardSafeView style={screen.container}>
      <View style={screen.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={screen.backText}>‹ Cancel</Text>
        </TouchableOpacity>
        <Text style={screen.headerTitle}>{isNew ? 'New Template' : 'Edit Template'}</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={screen.scroll} keyboardShouldPersistTaps="handled" {...keyboardScroll}>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>TEMPLATE NAME</Text>
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={name => update({name})}
            placeholder="e.g. Acme Surveying — County work"
            placeholderTextColor={c.placeholder}
          />
        </View>

        <Text style={screen.sectionLabel}>CSV EXPORT — COORDINATE SYSTEM</Text>
        <View style={[styles.card, {gap: 14}]}>
          <SelectField
            label="ZONE / PROJECTION"
            value={cs.zoneId}
            options={ZONE_OPTIONS}
            onChange={zoneId => updateCS({zoneId})}
            searchable
          />
          <SelectField
            label="HORIZONTAL DATUM"
            value={cs.horizontalDatum}
            options={HDATUM_OPTIONS}
            onChange={horizontalDatum => updateCS({horizontalDatum})}
            hint="Phone GPS is accurate to a few metres, so NAD83 realizations, WGS 84 and ITRF give the same coordinates here — the choice is recorded on the export. NAD27 is converted approximately."
          />
          {noNad27Zone && (
            <Text style={styles.warning}>
              ⚠ {zone!.label} has no NAD27 definition — Northing/Easting will be left blank.
              Choose a NAD83 datum or another zone.
            </Text>
          )}
          <SelectField
            label="VERTICAL DATUM"
            value={cs.verticalDatum}
            options={VDATUM_OPTIONS}
            onChange={verticalDatum => updateCS({verticalDatum})}
            hint="Recorded on the export for your rim elevations — elevations aren't converted."
          />
          {!isGeographic(cs) && (
            <SelectField
              label="NORTHING / EASTING UNITS"
              value={cs.units}
              options={UNIT_SELECT}
              onChange={units => updateCS({units: units as CoordinateUnits})}
            />
          )}
        </View>

        <Text style={screen.sectionLabel}>STRUCTURE DETAIL FIELDS</Text>
        <View style={[styles.card, {paddingVertical: 4}]}>
          <Text style={[styles.emptyText, {fontStyle: 'normal', marginTop: 8, marginBottom: 4}]}>
            Fields that are on appear when recording a structure and on the PDF data sheets.
          </Text>
          {STRUCTURE_FIELDS.map(f => {
            const on = draft.structureFields.includes(f.id);
            return (
              <View key={f.id} style={styles.fieldRow}>
                <View style={{flex: 1}}>
                  <Text style={styles.fieldRowTitle}>{f.label}</Text>
                  <Text style={styles.fieldRowHint}>{f.hint}</Text>
                </View>
                <Switch
                  value={on}
                  onValueChange={v => toggleField(f.id, v)}
                  trackColor={{false: c.border, true: c.primaryBorder}}
                  thumbColor={on ? c.accentText : '#FFFFFF'}
                />
              </View>
            );
          })}
        </View>

        {LIST_SECTIONS.filter(
          section => !section.field || draft.structureFields.includes(section.field),
        ).map(section => (
          <View key={section.key}>
            <Text style={screen.sectionLabel}>{section.title}</Text>
            <View style={styles.card}>
              <View style={styles.chips}>
                {draft[section.key].map(item => (
                  <View key={item} style={styles.chip}>
                    <Text style={styles.chipText}>{item}</Text>
                    <TouchableOpacity
                      onPress={() => removeItem(section.key, item)}
                      hitSlop={8}
                      accessibilityLabel={`Remove ${item}`}>
                      <Text style={styles.chipX}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {draft[section.key].length === 0 && (
                  <Text style={styles.emptyText}>None yet</Text>
                )}
              </View>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, {flex: 1}]}
                  placeholder={section.placeholder}
                  placeholderTextColor={c.placeholder}
                  value={newItems[section.key] ?? ''}
                  onChangeText={t => setNewItems(n => ({...n, [section.key]: t}))}
                  onSubmitEditing={() => addItem(section.key, section.inches)}
                  returnKeyType="done"
                  blurOnSubmit={false}
                />
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => addItem(section.key, section.inches)}>
                  <Text style={styles.addBtnText}>+ Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}

        <View style={{height: 40}} />
      </ScrollView>
    </KeyboardSafeView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    saveText: {color: 'white', fontSize: 17, fontWeight: '600'},
    card: {backgroundColor: c.card, borderRadius: 12, padding: 16},
    fieldLabel: {
      fontSize: 10,
      fontWeight: '600',
      color: c.textMuted,
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: c.text,
      backgroundColor: c.bg,
    },
    warning: {fontSize: 12, color: c.danger, lineHeight: 17},
    chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12},
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 20,
      paddingLeft: 12,
      paddingRight: 10,
      paddingVertical: 6,
    },
    chipText: {fontSize: 13, color: c.text, fontWeight: '500'},
    chipX: {fontSize: 12, color: c.textMuted, fontWeight: '700'},
    emptyText: {fontSize: 13, color: c.textMuted, fontStyle: 'italic'},
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 12,
      borderTopWidth: 0.5,
      borderTopColor: c.divider,
    },
    fieldRowTitle: {fontSize: 15, color: c.text, fontWeight: '500'},
    fieldRowHint: {fontSize: 12, color: c.textMuted, marginTop: 2},
    addRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
    addBtn: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    addBtnText: {color: 'white', fontSize: 13, fontWeight: '600'},
  });
