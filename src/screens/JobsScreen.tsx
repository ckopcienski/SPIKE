import React, {useState, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList} from '../navigation/AppNavigator';
import KeyboardSafeView, {useKeyboardScroll} from '../components/KeyboardSafeView';
import {useTheme, ThemeColors} from '../theme';
import {jobNetworkLabel} from '../utils/structureTypes';
import {
  Job,
  loadAllJobs,
  saveJob,
  deleteJob,
  generateId,
} from '../storage/storage';
import {
  JobTemplate,
  SPIKE_TEMPLATE,
  loadTemplates,
  templateLabel,
  templateSummary,
  jobFieldsFromTemplate,
} from '../storage/templates';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Jobs'>;
};

export default function JobsScreen({navigation}: Props) {
  const {colors: c, settings, updateSettings} = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const keyboardScroll = useKeyboardScroll(); // keep the focused box above the keyboard
  const [jobs, setJobs] = useState<Job[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [jobName, setJobName] = useState('');
  const [jobNumber, setJobNumber] = useState('');
  const [crew, setCrew] = useState('');
  const [templates, setTemplates] = useState<JobTemplate[]>([SPIKE_TEMPLATE]);
  const [templateId, setTemplateId] = useState(SPIKE_TEMPLATE.id);

  useFocusEffect(
    useCallback(() => {
      loadAllJobs().then(setJobs);
      loadTemplates().then(setTemplates);
    }, []),
  );

  // Open the New Job box with the last-used template pre-selected
  async function openNewJob() {
    const list = await loadTemplates();
    setTemplates(list);
    const last = list.find(t => t.id === settings.lastTemplateId);
    setTemplateId((last ?? SPIKE_TEMPLATE).id);
    setModalVisible(true);
  }

  async function handleCreateJob() {
    if (!jobName.trim()) {
      Alert.alert('Required', 'Please enter a job name.');
      return;
    }
    const template = templates.find(t => t.id === templateId) ?? SPIKE_TEMPLATE;
    const newJob: Job = {
      id: generateId(),
      name: jobName.trim(),
      jobNumber: jobNumber.trim(),
      crew: crew.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      streets: [],
      structures: [],
      // The job gets its own copy of the template's lists and coordinate system
      ...jobFieldsFromTemplate(template),
    };
    await saveJob(newJob);
    updateSettings({lastTemplateId: template.id});
    setJobs(await loadAllJobs());
    setModalVisible(false);
    setJobName('');
    setJobNumber('');
    setCrew('');
  }

  async function handleDeleteJob(jobId: string, jobName: string) {
    Alert.alert(
      'Delete Job',
      `Are you sure you want to delete "${jobName}" and all its data? This cannot be undone.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteJob(jobId);
            setJobs(await loadAllJobs());
          },
        },
      ],
    );
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function networkColor(type: string) {
    if (type === 'Sanitary') return c.sanitaryText;
    if (type === 'Storm') return c.stormText;
    return c.otherText;
  }

  function networkBg(type: string) {
    if (type === 'Sanitary') return c.sanitaryBg;
    if (type === 'Storm') return c.stormBg;
    return c.otherBg;
  }

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SPIKE</Text>
          <Text style={styles.headerSub}>
            Structure, Pipe & Invert Knowledge Entry
          </Text>
        </View>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={openNewJob}>
          <Text style={styles.newBtnText}>+ New Job</Text>
        </TouchableOpacity>
      </View>

      {/* Job list */}
      {jobs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No jobs yet</Text>
          <Text style={styles.emptySub}>
            Tap "New Job" to create your first job site
          </Text>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({item}) => (
            <TouchableOpacity
              style={styles.jobCard}
              onPress={() =>
                navigation.navigate('Structures', {jobId: item.id})
              }
              onLongPress={() => handleDeleteJob(item.id, item.name)}>
              <View style={styles.jobCardLeft}>
                <Text style={styles.jobName}>{item.name}</Text>
                {item.jobNumber ? (
                  <Text style={styles.jobMeta}>Job #{item.jobNumber}</Text>
                ) : null}
                <Text style={styles.jobMeta}>
                  {item.structures.length} structure
                  {item.structures.length !== 1 ? 's' : ''} ·{' '}
                  {item.crew ? `Crew: ${item.crew} · ` : ''}
                  {formatDate(item.updatedAt)}
                </Text>
              </View>
              <View style={styles.jobCardRight}>
                {/* Network comes from the structures recorded (Sanitary / Storm / Both) */}
                {jobNetworkLabel(item) ? (
                  <View
                    style={[
                      styles.networkBadge,
                      {backgroundColor: networkBg(jobNetworkLabel(item))},
                    ]}>
                    <Text
                      style={[
                        styles.networkBadgeText,
                        {color: networkColor(jobNetworkLabel(item))},
                      ]}>
                      {jobNetworkLabel(item)}
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* New Job Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}>
        <KeyboardSafeView style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Job</Text>
            <TouchableOpacity onPress={handleCreateJob}>
              <Text style={styles.modalSave}>Create</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" {...keyboardScroll}>
          <View style={styles.formSection}>
            <Text style={styles.formLabel}>TEMPLATE</Text>
            {templates.map(t => {
              const selected = t.id === templateId;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.templateRow, selected && styles.templateRowActive]}
                  onPress={() => setTemplateId(t.id)}>
                  <View style={[styles.radio, selected && styles.radioActive]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                  <View style={{flex: 1}}>
                    <Text style={styles.templateName}>{templateLabel(t)}</Text>
                    <Text style={styles.templateMeta}>{templateSummary(t)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.formSection}>
            <Text style={styles.formLabel}>JOB NAME *</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. Westfield Trunk Sewer"
              value={jobName}
              onChangeText={setJobName}
              placeholderTextColor={c.placeholder}
            />
          </View>

          <View style={styles.formSection}>
            <Text style={styles.formLabel}>JOB NUMBER</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. 2026-047"
              value={jobNumber}
              onChangeText={setJobNumber}
              placeholderTextColor={c.placeholder}
            />
          </View>

          <View style={styles.formSection}>
            <Text style={styles.formLabel}>CREW MEMBER</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. J. Harris"
              value={crew}
              onChangeText={setCrew}
              placeholderTextColor={c.placeholder}
            />
          </View>

          <View style={{height: 40}} />
          </ScrollView>
        </KeyboardSafeView>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bg},
  header: {
    backgroundColor: c.primary,
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: 'white',
    letterSpacing: 1,
  },
  headerSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 2,
  },
  newBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  newBtnText: {color: 'white', fontSize: 14, fontWeight: '500'},
  list: {padding: 16, gap: 10},
  jobCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  jobCardLeft: {flex: 1},
  jobCardRight: {alignItems: 'flex-end', gap: 8},
  jobName: {fontSize: 16, fontWeight: '600', color: c.text},
  jobMeta: {fontSize: 12, color: c.textMuted, marginTop: 3},
  networkBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  networkBadgeText: {fontSize: 11, fontWeight: '600'},
  chevron: {fontSize: 22, color: c.textFaint, lineHeight: 22},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8},
  emptyTitle: {fontSize: 18, fontWeight: '600', color: c.text},
  emptySub: {fontSize: 14, color: c.textMuted, textAlign: 'center', paddingHorizontal: 40},
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
  formSection: {
    backgroundColor: c.card,
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
  },
  formLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: c.textMuted,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  formInput: {
    fontSize: 15,
    color: c.text,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
    paddingBottom: 8,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 4,
  },
  templateRowActive: {borderColor: c.primaryBorder, backgroundColor: c.bg},
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {borderColor: c.accentText},
  radioDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: c.accentText},
  templateName: {fontSize: 14, fontWeight: '600', color: c.text},
  templateMeta: {fontSize: 11, color: c.textMuted, marginTop: 2},
  segmented: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    backgroundColor: c.bg,
  },
  segmentBtnActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryBorder,
  },
  segmentText: {fontSize: 13, color: c.textMuted, fontWeight: '500'},
  segmentTextActive: {color: 'white'},
});