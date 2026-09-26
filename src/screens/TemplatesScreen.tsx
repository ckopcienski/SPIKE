import React, {useCallback, useMemo, useState} from 'react';
import {View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList} from '../navigation/AppNavigator';
import {useTheme, ThemeColors} from '../theme';
import {makeScreenStyles} from './SettingsScreen';
import {
  JobTemplate,
  SPIKE_TEMPLATE_ID,
  loadTemplates,
  removeTemplate,
  templateLabel,
  templateSummary,
} from '../storage/templates';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Templates'>;
};

export default function TemplatesScreen({navigation}: Props) {
  const {colors: c, settings, updateSettings} = useTheme();
  const screen = useMemo(() => makeScreenStyles(c), [c]);
  const styles = useMemo(() => makeStyles(c), [c]);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadTemplates().then(setTemplates);
    }, []),
  );

  function handleRemove(t: JobTemplate) {
    Alert.alert(
      'Remove template',
      `Remove "${t.name}"?\n\nJobs already created with it won't change.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await removeTemplate(t.id);
            if (settings.lastTemplateId === t.id) {
              updateSettings({lastTemplateId: SPIKE_TEMPLATE_ID});
            }
            setTemplates(await loadTemplates());
          },
        },
      ],
    );
  }

  return (
    <View style={screen.container}>
      <View style={screen.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={screen.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={screen.headerTitle}>Templates</Text>
        <View style={{width: 70}} />
      </View>

      <ScrollView contentContainerStyle={screen.scroll}>
        <Text style={styles.intro}>
          A template is the set of structure types, pipe sizes, materials, casting sizes and
          coordinate system a new job starts with. Jobs keep their own copy, so editing or
          removing a template only affects jobs created afterwards.
        </Text>

        {templates.map(t => (
          <View key={t.id} style={styles.card}>
            <View style={styles.titleRow}>
              <Text style={styles.name}>{t.name}</Text>
              {t.builtIn && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>DEFAULT</Text>
                </View>
              )}
            </View>
            <Text style={styles.meta}>{templateLabel(t)}</Text>
            <Text style={styles.meta}>{templateSummary(t)}</Text>

            <View style={styles.actions}>
              {!t.builtIn && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => navigation.navigate('TemplateEdit', {templateId: t.id})}>
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => navigation.navigate('TemplateEdit', {copyFromId: t.id})}>
                <Text style={styles.actionText}>Duplicate</Text>
              </TouchableOpacity>
              {!t.builtIn && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.removeBtn]}
                  onPress={() => handleRemove(t)}>
                  <Text style={[styles.actionText, styles.removeText]}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
            {t.builtIn && (
              <Text style={styles.lockNote}>
                The S.P.I.K.E template can't be edited or removed — duplicate it to make your own.
              </Text>
            )}
          </View>
        ))}

        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => navigation.navigate('TemplateEdit', {})}>
          <Text style={styles.newBtnText}>+ New Template</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    intro: {fontSize: 13, color: c.textMuted, lineHeight: 18, marginBottom: 4},
    card: {backgroundColor: c.card, borderRadius: 12, padding: 16, gap: 3},
    titleRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2},
    name: {fontSize: 16, fontWeight: '700', color: c.text},
    badge: {
      backgroundColor: c.primary,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    badgeText: {color: 'white', fontSize: 9, fontWeight: '700', letterSpacing: 0.5},
    meta: {fontSize: 12, color: c.textMuted},
    actions: {flexDirection: 'row', gap: 8, marginTop: 10},
    actionBtn: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.primaryBorder,
    },
    actionText: {fontSize: 13, fontWeight: '600', color: c.accentText},
    removeBtn: {borderColor: c.danger, backgroundColor: c.dangerBg},
    removeText: {color: c.danger},
    lockNote: {fontSize: 11, color: c.textMuted, marginTop: 8, fontStyle: 'italic'},
    newBtn: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: c.primaryBorder,
      borderRadius: 12,
      padding: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    newBtnText: {fontSize: 14, color: c.accentText, fontWeight: '600'},
  });
