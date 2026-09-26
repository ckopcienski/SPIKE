import React, {useState, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Modal,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp} from '@react-navigation/native';
import {RootStackParamList} from '../navigation/AppNavigator';
import {useTheme, ThemeColors} from '../theme';
import {networkOfType} from '../utils/structureTypes';
import {ageText, staleness} from '../utils/calibration';
import {
  Job,
  Structure,
  loadJob,
  saveJob,
  getStructurePhotos,
  deletePhotoFiles,
} from '../storage/storage';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Structures'>;
  route: RouteProp<RootStackParamList, 'Structures'>;
};

type SortOption = 'name' | 'date' | 'northing' | 'easting';

export default function StructuresScreen({navigation, route}: Props) {
  const {colors: c} = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const {jobId} = route.params;
  const [job, setJob] = useState<Job | null>(null);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterStreet, setFilterStreet] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('date');

  useFocusEffect(
    useCallback(() => {
      loadJob(jobId).then(setJob);
    }, [jobId]),
  );

  async function handleDeleteStructure(structureId: string, name: string) {
    Alert.alert(
      'Delete Structure',
      `Delete "${name}" and all its pipe data and photos?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!job) return;
            const removed = job.structures.find(s => s.id === structureId);
            if (removed) await deletePhotoFiles(getStructurePhotos(removed));
            const updated: Job = {
              ...job,
              structures: job.structures.filter(s => s.id !== structureId),
              updatedAt: new Date().toISOString(),
            };
            await saveJob(updated);
            setJob(updated);
          },
        },
      ],
    );
  }

  function networkColor(type: string) {
    const net = networkOfType(type);
    if (net === 'sanitary') return c.sanitaryText;
    if (net === 'storm') return c.stormText;
    return c.otherText;
  }

  function networkBg(type: string) {
    const net = networkOfType(type);
    if (net === 'sanitary') return c.sanitaryBg;
    if (net === 'storm') return c.stormBg;
    return c.otherBg;
  }

  function shortType(type: string) {
    if (type === 'Sanitary manhole') return 'Sanitary';
    if (type === 'Storm manhole') return 'Storm';
    if (type === 'Catch basin') return 'Catch basin';
    if (type === 'Junction box') return 'Junction';
    return type;
  }

  function getFilteredAndSorted(structures: Structure[]): Structure[] {
    let result = [...structures];

    if (filterType) {
      result = result.filter(s => s.type === filterType);
    }
    if (filterStreet) {
      result = result.filter(s => s.street === filterStreet);
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.structureId.localeCompare(b.structureId);
        case 'northing':
          return b.latitude - a.latitude;
        case 'easting':
          return b.longitude - a.longitude;
        case 'date':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return result;
  }

  const activeFilterCount =
    (filterType ? 1 : 0) + (filterStreet ? 1 : 0);

  if (!job) return null;

  const streetCounts: Record<string, number> = {};
  for (const s of job.structures) {
    if (s.street) {
      streetCounts[s.street] = (streetCounts[s.street] || 0) + 1;
    }
  }

  const uniqueTypes = [...new Set(job.structures.map(s => s.type))];
  const uniqueStreets = [...new Set(job.structures.map(s => s.street).filter(Boolean))];
  const displayedStructures = getFilteredAndSorted(job.structures);

  const SORT_OPTIONS: {label: string; value: SortOption}[] = [
    {label: 'Date', value: 'date'},
    {label: 'Name', value: 'name'},
    {label: 'Northing', value: 'northing'},
    {label: 'Easting', value: 'easting'},
  ];

  return (
    <View style={styles.container}>

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Jobs</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{job.name}</Text>
          {job.jobNumber ? (
            <Text style={styles.headerSub}>Job #{job.jobNumber}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => navigation.navigate('DataEntry', {jobId: job.id})}>
          <Text style={styles.newBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {Object.keys(streetCounts).length > 0 && (
        <View style={styles.streetsBar}>
          <Text style={styles.streetsLabel}>Streets: </Text>
          <View style={styles.streetsList}>
            {Object.entries(streetCounts).map(([street, count]) => (
              <View key={street} style={styles.streetPill}>
                <Text style={styles.streetPillText}>
                  {street} <Text style={styles.streetPillCount}>{count}</Text>
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.statsBar}>
        <View style={styles.statCell}>
          <Text style={styles.statNum}>{job.structures.length}</Text>
          <Text style={styles.statLbl}>Structures</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statNum}>
            {job.structures.reduce((a, s) => a + s.pipes.length, 0)}
          </Text>
          <Text style={styles.statLbl}>Pipes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statNum}>
            {job.structures.reduce((a, s) => a + getStructurePhotos(s).length, 0)}
          </Text>
          <Text style={styles.statLbl}>Photos</Text>
        </View>
        <TouchableOpacity
          style={styles.summaryBtn}
          onPress={() => navigation.navigate('Summary', {jobId: job.id})}>
          <Text style={styles.summaryBtnText}>Summary</Text>
        </TouchableOpacity>
      </View>

      {/* GPS calibration status — tap to calibrate / recalibrate */}
      {(() => {
        const cal = job.calibration;
        const stale = cal ? staleness(cal) : null;
        return (
          <TouchableOpacity
            style={styles.calBar}
            onPress={() => navigation.navigate('Calibration', {jobId: job.id})}>
            <View
              style={[
                styles.calDot,
                {backgroundColor: !cal ? c.textFaint : stale ? '#E8B84B' : '#1D9E75'},
              ]}
            />
            <Text style={styles.calText} numberOfLines={1}>
              {!cal
                ? 'GPS not calibrated'
                : stale
                  ? stale
                  : `GPS calibrated at ${cal.pointName} · ${ageText(cal.createdAt)}`}
            </Text>
            <Text style={styles.calLink}>{cal ? 'Recalibrate ›' : 'Calibrate ›'}</Text>
          </TouchableOpacity>
        );
      })()}

      {/* Filter bar */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {/* Filter button */}
          <TouchableOpacity
            style={[styles.filterChip, activeFilterCount > 0 && styles.filterChipActive]}
            onPress={() => setFilterModalVisible(true)}>
            <Text style={[styles.filterChipText, activeFilterCount > 0 && styles.filterChipTextActive]}>
              ⚙ Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Text>
          </TouchableOpacity>

          <View style={styles.filterDivider} />

          {/* Sort options */}
          {SORT_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.filterChip, sortBy === opt.value && styles.filterChipActive]}
              onPress={() => setSortBy(opt.value)}>
              <Text style={[styles.filterChipText, sortBy === opt.value && styles.filterChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}

          {/* Clear filters */}
          {activeFilterCount > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => {
                setFilterType(null);
                setFilterStreet(null);
              }}>
              <Text style={styles.clearBtnText}>✕ Clear</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {displayedStructures.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            {job.structures.length === 0 ? 'No structures yet' : 'No results'}
          </Text>
          <Text style={styles.emptySub}>
            {job.structures.length === 0
              ? 'Tap "+ Add" to record your first structure'
              : 'Try adjusting your filters'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayedStructures}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({item}) => (
            <TouchableOpacity
              style={styles.structCard}
              onPress={() =>
                navigation.navigate('DataEntry', {
                  jobId: job.id,
                  structureId: item.id,
                })
              }
              onLongPress={() => handleDeleteStructure(item.id, item.structureId)}>
              <View style={styles.structCardLeft}>
                <Text style={styles.structId}>{item.structureId}</Text>
                {item.street ? (
                  <Text style={styles.structMeta}>{item.street}</Text>
                ) : null}
                <Text style={styles.structMeta}>
                  {item.pipes.length} pipe{item.pipes.length !== 1 ? 's' : ''}
                  {item.rimElevation ? ` · Rim: ${item.rimElevation} ft` : ''}
                </Text>
              </View>
              <View style={styles.structCardRight}>
                <View
                  style={[styles.typeBadge, {backgroundColor: networkBg(item.type)}]}>
                  <Text style={[styles.typeBadgeText, {color: networkColor(item.type)}]}>
                    {shortType(item.type)}
                  </Text>
                </View>
                {getStructurePhotos(item).length > 0 ? (
                  <Text style={styles.photoIndicator}>
                    📷 {getStructurePhotos(item).length}
                  </Text>
                ) : null}
                <Text style={styles.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Filter Modal */}
      <Modal
        visible={filterModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFilterModalVisible(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Filter Structures</Text>
            <TouchableOpacity
              onPress={() => {
                setFilterType(null);
                setFilterStreet(null);
                setFilterModalVisible(false);
              }}>
              <Text style={styles.modalClear}>Clear all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll}>
            {/* Filter by type */}
            {uniqueTypes.length > 0 && (
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionLabel}>STRUCTURE TYPE</Text>
                <View style={styles.filterOptions}>
                  {uniqueTypes.map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.filterOption,
                        filterType === type && styles.filterOptionActive,
                      ]}
                      onPress={() =>
                        setFilterType(filterType === type ? null : type)
                      }>
                      <Text
                        style={[
                          styles.filterOptionText,
                          filterType === type && styles.filterOptionTextActive,
                        ]}>
                        {shortType(type)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Filter by street */}
            {uniqueStreets.length > 0 && (
              <View style={styles.filterSection}>
                <Text style={styles.filterSectionLabel}>STREET</Text>
                <View style={styles.filterOptions}>
                  {uniqueStreets.map(street => (
                    <TouchableOpacity
                      key={street}
                      style={[
                        styles.filterOption,
                        filterStreet === street && styles.filterOptionActive,
                      ]}
                      onPress={() =>
                        setFilterStreet(filterStreet === street ? null : street)
                      }>
                      <Text
                        style={[
                          styles.filterOptionText,
                          filterStreet === street && styles.filterOptionTextActive,
                        ]}>
                        {street}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={styles.applyBtn}
            onPress={() => setFilterModalVisible(false)}>
            <Text style={styles.applyBtnText}>
              Apply · {displayedStructures.length} result
              {displayedStructures.length !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>
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
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  backBtn: {paddingBottom: 2},
  backText: {color: 'rgba(255,255,255,0.85)', fontSize: 17},
  headerCenter: {flex: 1},
  headerTitle: {fontSize: 18, fontWeight: '600', color: 'white'},
  headerSub: {fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1},
  newBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  newBtnText: {color: 'white', fontSize: 13, fontWeight: '500'},
  streetsBar: {
    backgroundColor: c.primaryDark,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  streetsLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  streetsList: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1},
  streetPill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  streetPillText: {fontSize: 11, color: 'rgba(255,255,255,0.85)'},
  streetPillCount: {fontWeight: '700'},
  calBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: c.card,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
  },
  calDot: {width: 8, height: 8, borderRadius: 4},
  calText: {flex: 1, fontSize: 13, color: c.textSecondary},
  calLink: {fontSize: 13, color: c.accentText, fontWeight: '600'},
  statsBar: {
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
    gap: 12,
  },
  statCell: {alignItems: 'center', flex: 1},
  statNum: {fontSize: 20, fontWeight: '700', color: c.accentText},
  statLbl: {fontSize: 10, color: c.textMuted, marginTop: 1},
  statDivider: {width: 0.5, height: 30, backgroundColor: c.divider},
  filterBar: {
    backgroundColor: c.card,
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
  },
  filterScroll: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bg,
  },
  filterChipActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryBorder,
  },
  filterChipText: {fontSize: 12, color: c.textSecondary, fontWeight: '500'},
  filterChipTextActive: {color: 'white'},
  filterDivider: {
    width: 1,
    height: 20,
    backgroundColor: c.border,
    marginHorizontal: 4,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.danger,
    backgroundColor: c.dangerBg,
  },
  clearBtnText: {fontSize: 12, color: c.danger, fontWeight: '500'},
  list: {padding: 16, gap: 10},
  structCard: {
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
  structCardLeft: {flex: 1},
  structCardRight: {
    alignItems: 'center',
    gap: 6,
    flexDirection: 'row',
  },
  structId: {fontSize: 16, fontWeight: '700', color: c.text},
  structMeta: {fontSize: 12, color: c.textMuted, marginTop: 2},
  typeBadge: {paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20},
  typeBadgeText: {fontSize: 11, fontWeight: '600'},
  photoIndicator: {fontSize: 14},
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
  modalClear: {fontSize: 16, color: c.danger},
  modalScroll: {flex: 1},
  filterSection: {
    backgroundColor: c.card,
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
  },
  filterSectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: c.textMuted,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  filterOptions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  filterOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bg,
  },
  filterOptionActive: {backgroundColor: c.primary, borderColor: c.primaryBorder},
  filterOptionText: {fontSize: 13, color: c.textSecondary, fontWeight: '500'},
  filterOptionTextActive: {color: 'white'},
  applyBtn: {
    backgroundColor: c.primary,
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
 applyBtnText: {color: 'white', fontSize: 15, fontWeight: '600'},
  summaryBtn: {
    backgroundColor: c.primaryDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  summaryBtnText: {color: 'white', fontSize: 12, fontWeight: '600'},
  
  
});