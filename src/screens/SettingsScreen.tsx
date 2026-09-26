import React, {useMemo, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList} from '../navigation/AppNavigator';
import {useTheme, ThemeColors} from '../theme';
import {ProfileAvatar} from '../components/HeaderIcons';
import {exportBackup, shareBackup, pickBackupFile, restoreBackup} from '../utils/backup';
import {
  NETWORK_COLOR_OPTIONS,
  NetworkColorId,
  NetworkColors,
  DEFAULT_NETWORK_COLORS,
} from '../data/networkColors';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Settings'>;
};

const APP_VERSION = '1.0';

/** Profile & Settings — opened from the profile button in the top-right corner */
export default function SettingsScreen({navigation}: Props) {
  const {colors: c, settings, updateSettings} = useTheme();
  const styles = useMemo(() => makeScreenStyles(c), [c]);
  const profile = settings.profile ?? {};
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);

  async function handleBackup() {
    setBusy('backup');
    try {
      const b = await exportBackup();
      updateSettings({lastBackupAt: b.createdAt});
      Alert.alert(
        'Backup saved',
        `${b.jobCount} job${b.jobCount !== 1 ? 's' : ''} and ${b.photoCount} photo${
          b.photoCount !== 1 ? 's' : ''
        } saved to ${b.location} as\n${b.fileName}\n\nTo keep it safe if this phone is lost, share a copy to Google Drive or email.`,
        [
          {text: 'Done', style: 'cancel'},
          {
            text: 'Share copy',
            onPress: () =>
              shareBackup(b.path).catch(e =>
                Alert.alert('Share failed', e?.message || 'Could not share the backup.'),
              ),
          },
        ],
      );
    } catch (e: any) {
      Alert.alert('Backup failed', e?.message || 'Could not make the backup. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function handleRestore() {
    Alert.alert(
      'Restore from backup',
      "Choose a SPIKE backup file. Jobs and templates in it are added to this phone. " +
        "Nothing is deleted — if a job is on both, the most recently changed copy is kept.",
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Choose file', onPress: runRestore},
      ],
    );
  }

  async function runRestore() {
    let path: string | null = null;
    try {
      path = await pickBackupFile();
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message || 'Could not open that file.');
      return;
    }
    if (!path) return; // cancelled
    setBusy('restore');
    try {
      const r = await restoreBackup(path);
      if (Object.keys(r.settingsPatch).length > 0) updateSettings(r.settingsPatch);
      const lines = [
        `${r.added} job${r.added !== 1 ? 's' : ''} added`,
        r.updated > 0 ? `${r.updated} updated from the backup` : '',
        r.keptPhone > 0
          ? `${r.keptPhone} already on this phone (kept the phone's copy — same or newer)`
          : '',
        r.templatesAdded > 0 ? `${r.templatesAdded} template${r.templatesAdded !== 1 ? 's' : ''} added` : '',
      ].filter(Boolean);
      const from = r.backupDate ? `Backup from ${new Date(r.backupDate).toLocaleString()}\n\n` : '';
      Alert.alert('Restore complete', from + lines.join('\n'));
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message || 'Could not restore that backup.');
    } finally {
      setBusy(null);
    }
  }

  const lastBackup = settings.lastBackupAt
    ? `Last backup ${new Date(settings.lastBackupAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : 'No backup yet — saves every job, photo and template';

  const netColors: NetworkColors = {...DEFAULT_NETWORK_COLORS, ...settings.networkColors};

  // Picking the colour the other network already uses swaps the two,
  // so storm and sanitary always look different
  function pickNetworkColor(network: keyof NetworkColors, color: NetworkColorId) {
    const other: keyof NetworkColors = network === 'storm' ? 'sanitary' : 'storm';
    const next = {...netColors, [network]: color};
    if (netColors[other] === color) next[other] = netColors[network];
    updateSettings({networkColors: next});
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile & Settings</Text>
        <View style={{width: 50}} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Profile summary — tap to edit personal information */}
        <TouchableOpacity
          style={[styles.card, styles.summaryCard]}
          onPress={() => navigation.navigate('Profile')}
          accessibilityLabel="Edit personal information">
          <View style={styles.summaryRow}>
            <ProfileAvatar
              size={72}
              photoPath={profile.photoPath}
              color={c.accentText}
              background={c.avatarBg}
            />
            <View style={styles.summaryText}>
              <Text style={[styles.summaryName, !profile.name && styles.summaryPlaceholder]}>
                {profile.name || 'Add your name'}
              </Text>
              {profile.title ? <Text style={styles.summaryTitle}>{profile.title}</Text> : null}
              {profile.firm ? <Text style={styles.summaryFirm}>{profile.firm}</Text> : null}
              {!profile.title && !profile.firm ? (
                <Text style={styles.summaryFirm}>Add your job title and company</Text>
              ) : null}
            </View>
            <Text style={styles.chevron}>›</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>Saved on this phone</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>TEMPLATES</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('Templates')}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowTitle}>Templates</Text>
              <Text style={styles.rowSub}>
                Pick lists and coordinate systems for new jobs
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>APPEARANCE</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowTitle}>Dark mode</Text>
              <Text style={styles.rowSub}>Darker screens for low light</Text>
            </View>
            <Switch
              value={settings.darkMode}
              onValueChange={v => updateSettings({darkMode: v})}
              trackColor={{false: c.border, true: c.primaryBorder}}
              thumbColor={settings.darkMode ? c.accentText : '#FFFFFF'}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>NETWORK COLORS</Text>
        <View style={styles.card}>
          {(['storm', 'sanitary'] as const).map((network, i) => (
            <View key={network} style={[styles.row, i > 0 && swatchStyles.rowDivider, {borderTopColor: c.divider}]}>
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowTitle}>{network === 'storm' ? 'Storm' : 'Sanitary'}</Text>
                <Text style={styles.rowSub}>
                  {NETWORK_COLOR_OPTIONS.find(o => o.id === netColors[network])?.label}
                </Text>
              </View>
              <View style={swatchStyles.swatchRow}>
                {NETWORK_COLOR_OPTIONS.map(o => {
                  const selected = netColors[network] === o.id;
                  return (
                    <TouchableOpacity
                      key={o.id}
                      onPress={() => pickNetworkColor(network, o.id)}
                      accessibilityLabel={`${network} color ${o.label}`}
                      accessibilityState={{selected}}
                      style={[
                        swatchStyles.swatchRing,
                        {borderColor: selected ? c.text : 'transparent'},
                      ]}>
                      <View style={[swatchStyles.swatch, {backgroundColor: o.swatch}]}>
                        {selected ? <Text style={swatchStyles.check}>✓</Text> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
          <Text style={[styles.rowSub, swatchStyles.note]}>
            Used on the job and structure lists, the Summary and the PDF report.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>BACKUP</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={handleBackup} disabled={busy !== null}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowTitle}>Back up all jobs</Text>
              <Text style={styles.rowSub}>{lastBackup}</Text>
            </View>
            {busy === 'backup' ? (
              <ActivityIndicator color={c.accentText} />
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, swatchStyles.rowDivider, {borderTopColor: c.divider}]}
            onPress={handleRestore}
            disabled={busy !== null}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowTitle}>Restore from backup</Text>
              <Text style={styles.rowSub}>Add jobs from a SPIKE backup file</Text>
            </View>
            {busy === 'restore' ? (
              <ActivityIndicator color={c.accentText} />
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.rowTitle}>S.P.I.K.E</Text>
              <Text style={styles.rowSub}>Version {APP_VERSION}</Text>
            </View>
          </View>
        </View>

        <View style={{height: 40}} />
      </ScrollView>
    </View>
  );
}

const swatchStyles = StyleSheet.create({
  rowDivider: {borderTopWidth: 0.5},
  swatchRow: {flexDirection: 'row', gap: 6},
  swatchRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {color: 'white', fontSize: 15, fontWeight: '700'},
  note: {paddingHorizontal: 16, paddingBottom: 12, marginTop: 0},
});

/** Shared by Profile & Settings and the Templates screens */
export const makeScreenStyles = (c: ThemeColors) =>
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
    scroll: {padding: 16, gap: 8},
    sectionLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: c.textMuted,
      letterSpacing: 0.5,
      marginTop: 8,
      marginLeft: 4,
    },
    card: {backgroundColor: c.card, borderRadius: 12, overflow: 'hidden'},
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    rowTextWrap: {flex: 1},
    rowTitle: {fontSize: 16, color: c.text, fontWeight: '500'},
    rowSub: {fontSize: 12, color: c.textMuted, marginTop: 2},
    chevron: {fontSize: 24, color: c.textFaint, lineHeight: 24},
    body: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10},
    title: {fontSize: 18, fontWeight: '600', color: c.text, marginTop: 6},
    sub: {fontSize: 14, color: c.textMuted, textAlign: 'center', paddingHorizontal: 32},
    profileCard: {padding: 16},
    summaryCard: {padding: 16, gap: 12},
    summaryRow: {flexDirection: 'row', alignItems: 'center', gap: 16},
    summaryText: {flex: 1, gap: 3},
    summaryName: {fontSize: 18, fontWeight: '700', color: c.text},
    summaryPlaceholder: {color: c.textMuted, fontWeight: '600'},
    summaryTitle: {fontSize: 14, color: c.textSecondary},
    summaryFirm: {fontSize: 13, color: c.textMuted},
    pill: {
      alignSelf: 'flex-start',
      backgroundColor: c.neutralPill,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    pillText: {fontSize: 12, color: c.textSecondary, fontWeight: '500'},
    avatarWrap: {alignItems: 'center', marginBottom: 12, gap: 8},
    changePhoto: {fontSize: 13, fontWeight: '600', color: c.accentText},
    fieldLabel: {
      fontSize: 10,
      fontWeight: '600',
      color: c.textMuted,
      letterSpacing: 0.5,
      marginTop: 12,
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
    profileNote: {fontSize: 11, color: c.textMuted, marginTop: 12, fontStyle: 'italic'},
  });
