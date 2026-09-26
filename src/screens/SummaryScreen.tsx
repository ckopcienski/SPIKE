import React, {useState, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp} from '@react-navigation/native';
import {RootStackParamList} from '../navigation/AppNavigator';
import {useTheme, ThemeColors} from '../theme';
import {
  Job,
  loadJob,
  getStructurePhotos,
} from '../storage/storage';
import {saveCSV} from '../utils/csvExport';
import {jobCoordinateSystem} from '../storage/templates';
import {networkOfType, jobNetworkLabel} from '../utils/structureTypes';
import {describeCoordinateSystem} from '../data/coordinateSystems';
import {exportJobPhotosZip} from '../utils/photoExport';
import {exportReportPdf} from '../utils/reportExport';
import {shareJob, ShareWhat} from '../utils/shareExport';
import ShareIcon from '../components/ShareIcon';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Summary'>;
  route: RouteProp<RootStackParamList, 'Summary'>;
};

export default function SummaryScreen({navigation, route}: Props) {
  const {colors: c, settings} = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const {jobId} = route.params;
  const [job, setJob] = useState<Job | null>(null);
  const [exportingPhotos, setExportingPhotos] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [sharing, setSharing] = useState<ShareWhat | null>(null);

  // Open Android's share sheet with just this file (CSV or photo ZIP)
  async function handleShare(what: ShareWhat) {
    if (!job || sharing) return;
    setSharing(what);
    try {
      await shareJob(job, what, settings.profile);
    } catch (e: any) {
      Alert.alert('Share failed', e?.message || 'Could not share. Please try again.');
    } finally {
      setSharing(null);
    }
  }

  async function handleExportReport() {
    if (!job || exportingReport) return;
    setExportingReport(true);
    try {
      const r = await exportReportPdf(job, settings.profile);
      Alert.alert('Report Exported', `Saved to:\n${r.location}/${r.fileName}`);
    } catch (e: any) {
      Alert.alert('Export Failed', e?.message || 'Could not create the report. Please try again.');
    } finally {
      setExportingReport(false);
    }
  }

  async function handleExportPhotos() {
    if (!job || exportingPhotos) return;
    setExportingPhotos(true);
    try {
      const r = await exportJobPhotosZip(job);
      Alert.alert(
        'Photos Exported',
        `${r.photoCount} photo${r.photoCount !== 1 ? 's' : ''} saved to:\n${r.location}/${r.fileName}`,
      );
    } catch (e: any) {
      Alert.alert('Export Failed', e?.message || 'Could not export photos. Please try again.');
    } finally {
      setExportingPhotos(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      loadJob(jobId).then(setJob);
    }, [jobId]),
  );

  async function handleExportCSV() {
    if (!job) return;
    try {
      const path = await saveCSV(job);
      Alert.alert(
        'CSV Exported',
        `File saved to:\n${path}`,
        [{text: 'OK'}],
      );
    } catch {
      Alert.alert('Export Failed', 'Could not export CSV. Please try again.');
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  if (!job) return null;

  const totalPipes = job.structures.reduce(
    (a, s) => a + s.pipes.length,
    0,
  );
  const totalPhotos = job.structures.reduce(
    (a, s) => a + getStructurePhotos(s).length,
    0,
  );

  const streetCounts: Record<string, number> = {};
  for (const s of job.structures) {
    if (s.street) {
      streetCounts[s.street] = (streetCounts[s.street] || 0) + 1;
    }
  }

  // Badge colours follow the network colours chosen in Settings
  function badgeColors(label: string) {
    if (label === 'Sanitary') return {text: c.sanitaryText, bg: c.sanitaryBg};
    if (label === 'Storm') return {text: c.stormText, bg: c.stormBg};
    return {text: c.otherText, bg: c.otherBg};
  }

  const sanitaryCount = job.structures.filter(
    s => networkOfType(s.type) === 'sanitary',
  ).length;
  const stormCount = job.structures.filter(
    s => networkOfType(s.type) === 'storm',
  ).length;

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Job Summary</Text>
        <View style={{width: 50}} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Job info */}
        <View style={styles.jobInfoCard}>
          <Text style={styles.jobName}>{job.name}</Text>
          {job.jobNumber ? (
            <Text style={styles.jobMeta}>Job #{job.jobNumber}</Text>
          ) : null}
          {job.crew ? (
            <Text style={styles.jobMeta}>Crew: {job.crew}</Text>
          ) : null}
          <Text style={styles.jobMeta}>
            Created {formatDate(job.createdAt)} · Updated{' '}
            {formatDate(job.updatedAt)}
          </Text>
          {jobNetworkLabel(job) ? (
            <View style={styles.networkRow}>
              <View
                style={[
                  styles.networkBadge,
                  {backgroundColor: badgeColors(jobNetworkLabel(job)).bg},
                ]}>
                <Text
                  style={[
                    styles.networkBadgeText,
                    {color: badgeColors(jobNetworkLabel(job)).text},
                  ]}>
                  {jobNetworkLabel(job)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Stats grid */}
        <Text style={styles.sectionLabel}>SURVEY TOTALS</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{job.structures.length}</Text>
            <Text style={styles.statLbl}>Structures</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{totalPipes}</Text>
            <Text style={styles.statLbl}>Pipes</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{totalPhotos}</Text>
            <Text style={styles.statLbl}>Photos</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>
              {Object.keys(streetCounts).length}
            </Text>
            <Text style={styles.statLbl}>Streets</Text>
          </View>
        </View>

        {/* Network breakdown */}
        {(sanitaryCount > 0 || stormCount > 0) && (
          <>
            <Text style={styles.sectionLabel}>NETWORK BREAKDOWN</Text>
            <View style={styles.card}>
              {sanitaryCount > 0 && (
                <View style={styles.breakdownRow}>
                  <View
                    style={[
                      styles.breakdownDot,
                      {backgroundColor: c.sanitaryDot},
                    ]}
                  />
                  <Text style={styles.breakdownLabel}>Sanitary</Text>
                  <Text style={styles.breakdownCount}>
                    {sanitaryCount} structure
                    {sanitaryCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              )}
              {stormCount > 0 && (
                <View style={styles.breakdownRow}>
                  <View
                    style={[
                      styles.breakdownDot,
                      {backgroundColor: c.stormDot},
                    ]}
                  />
                  <Text style={styles.breakdownLabel}>Storm</Text>
                  <Text style={styles.breakdownCount}>
                    {stormCount} structure
                    {stormCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Streets surveyed */}
        {Object.keys(streetCounts).length > 0 && (
          <>
            <Text style={styles.sectionLabel}>STREETS SURVEYED</Text>
            <View style={styles.card}>
              {Object.entries(streetCounts).map(([street, count], index) => (
                <View
                  key={street}
                  style={[
                    styles.streetRow,
                    index < Object.keys(streetCounts).length - 1 &&
                      styles.streetRowBorder,
                  ]}>
                  <Text style={styles.streetName}>{street}</Text>
                  <Text style={styles.streetCount}>
                    {count} structure{count !== 1 ? 's' : ''}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Export */}
        <Text style={styles.sectionLabel}>EXPORT</Text>
        <View style={styles.exportRow}>
          <TouchableOpacity
            style={[styles.exportBtn, {flex: 1}]}
            onPress={handleExportCSV}>
            <Text style={styles.exportBtnIcon}>📊</Text>
            <View>
              <Text style={styles.exportBtnTitle}>Export CSV</Text>
              <Text style={styles.exportBtnSub}>
                Civil3D-ready · {describeCoordinateSystem(jobCoordinateSystem(job))}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={() => handleShare('csv')}
            disabled={sharing !== null}
            accessibilityLabel="Share CSV">
            {sharing === 'csv' ? (
              <ActivityIndicator color="white" />
            ) : (
              <ShareIcon size={22} color="white" />
            )}
            <Text style={styles.shareBtnText}>Share</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.exportRow, styles.exportBtnSpacing]}>
        <TouchableOpacity
          style={[styles.exportBtn, {flex: 1}, totalPhotos === 0 && {opacity: 0.5}]}
          onPress={handleExportPhotos}
          disabled={exportingPhotos || totalPhotos === 0}>
          <Text style={styles.exportBtnIcon}>🗜</Text>
          <View style={{flex: 1}}>
            <Text style={styles.exportBtnTitle}>
              {exportingPhotos ? 'Exporting Photos…' : 'Export Photos (ZIP)'}
            </Text>
            <Text style={styles.exportBtnSub}>
              {totalPhotos === 0
                ? 'No photos in this job yet'
                : `All ${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''} → Downloads/SPIKE`}
            </Text>
          </View>
          {exportingPhotos && <ActivityIndicator color={c.accentText} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.shareBtn, totalPhotos === 0 && {opacity: 0.5}]}
          onPress={() => handleShare('photos')}
          disabled={sharing !== null || totalPhotos === 0}
          accessibilityLabel="Share photos">
          {sharing === 'photos' ? (
            <ActivityIndicator color="white" />
          ) : (
            <ShareIcon size={22} color="white" />
          )}
          <Text style={styles.shareBtnText}>Share</Text>
        </TouchableOpacity>
        </View>

        {/* PDF report: every structure with plan & section drawings and a pipe table */}
        <View style={[styles.exportRow, styles.exportBtnSpacing]}>
          <TouchableOpacity
            style={[styles.exportBtn, {flex: 1}]}
            onPress={handleExportReport}
            disabled={exportingReport}>
            <Text style={styles.exportBtnIcon}>📄</Text>
            <View style={{flex: 1}}>
              <Text style={styles.exportBtnTitle}>
                {exportingReport ? 'Creating Report…' : 'Export Report (PDF)'}
              </Text>
              <Text style={styles.exportBtnSub}>
                All structures with drawings, pipes, depths & inverts
              </Text>
            </View>
            {exportingReport && <ActivityIndicator color={c.accentText} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={() => handleShare('report')}
            disabled={sharing !== null}
            accessibilityLabel="Share report">
            {sharing === 'report' ? (
              <ActivityIndicator color="white" />
            ) : (
              <ShareIcon size={22} color="white" />
            )}
            <Text style={styles.shareBtnText}>Share</Text>
          </TouchableOpacity>
        </View>

        {/* Save this job's lists + coordinate system as a reusable template */}
        <Text style={styles.sectionLabel}>TEMPLATE</Text>
        <TouchableOpacity
          style={styles.exportBtn}
          onPress={() => navigation.navigate('TemplateEdit', {fromJobId: job.id})}>
          <Text style={styles.exportBtnIcon}>📋</Text>
          <View style={{flex: 1}}>
            <Text style={styles.exportBtnTitle}>Save as Template</Text>
            <Text style={styles.exportBtnSub}>
              Reuse this job's structure types, pipe sizes, materials and coordinate system
              {job.templateName ? ` · started from ${job.templateName}` : ''}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.bottomPad} />
      </ScrollView>
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
    justifyContent: 'space-between',
  },
  backText: {color: 'rgba(255,255,255,0.85)', fontSize: 17},
  headerTitle: {fontSize: 17, fontWeight: '600', color: 'white'},
  scroll: {padding: 16, gap: 12},
  jobInfoCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  jobName: {fontSize: 20, fontWeight: '700', color: c.text},
  jobMeta: {fontSize: 13, color: c.textMuted, marginTop: 3},
  networkRow: {marginTop: 10},
  networkBadge: {
    backgroundColor: c.sanitaryBg,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  networkBadgeText: {fontSize: 12, fontWeight: '600', color: c.sanitaryText},
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: c.textMuted,
    letterSpacing: 0.5,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  statNum: {fontSize: 24, fontWeight: '700', color: c.accentText},
  statLbl: {fontSize: 10, color: c.textMuted, marginTop: 2},
  card: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  breakdownDot: {width: 10, height: 10, borderRadius: 5},
  breakdownLabel: {flex: 1, fontSize: 14, color: c.text},
  breakdownCount: {fontSize: 13, color: c.textMuted},
  streetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  streetRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: c.divider,
  },
  streetName: {flex: 1, fontSize: 14, color: c.text, fontWeight: '500'},
  streetCount: {fontSize: 13, color: c.textMuted},
  exportBtn: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: c.primaryBorder,
  },
  exportBtnSpacing: {marginTop: 10},
  exportRow: {flexDirection: 'row', gap: 10},
  shareBtn: {
    backgroundColor: c.primary,
    borderRadius: 12,
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  shareBtnText: {color: 'white', fontSize: 12, fontWeight: '600'},
  exportBtnIcon: {fontSize: 28},
  exportBtnTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: c.accentText,
  },
  exportBtnSub: {fontSize: 11, color: c.textMuted, marginTop: 2},
  bottomPad: {height: 40},
});