import React, {useMemo, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  StyleSheet,
} from 'react-native';
import {useTheme, ThemeColors} from '../theme';

export type SelectOption = {
  value: string;
  label: string;
  /** Optional heading the option is grouped under (e.g. "State Plane") */
  group?: string;
};

type Props = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Show a search box (useful for long lists like State Plane zones) */
  searchable?: boolean;
  hint?: string;
};

/** A dropdown: shows the current choice; tapping opens a full-screen list to pick from. */
export default function SelectField({
  label,
  value,
  options,
  onChange,
  searchable,
  hint,
}: Props) {
  const {colors: c} = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find(o => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      o =>
        o.label.toLowerCase().includes(q) ||
        (o.group ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)}>
        <Text style={styles.fieldValue} numberOfLines={1}>
          {selected ? selected.label : value || 'Select…'}
        </Text>
        <Text style={styles.caret}>▾</Text>
      </TouchableOpacity>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={close}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {label}
            </Text>
            <View style={{width: 50}} />
          </View>

          {searchable && (
            <TextInput
              style={styles.search}
              placeholder="Search…"
              placeholderTextColor={c.placeholder}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
          )}

          <FlatList
            data={filtered}
            keyExtractor={o => o.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({item, index}) => {
              const showGroup =
                !!item.group &&
                (index === 0 || filtered[index - 1].group !== item.group);
              const isSelected = item.value === value;
              return (
                <View>
                  {showGroup && <Text style={styles.group}>{item.group}</Text>}
                  <TouchableOpacity
                    style={[styles.option, isSelected && styles.optionSelected]}
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}>
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}>
                      {item.label}
                    </Text>
                    {isSelected && <Text style={styles.check}>✓</Text>}
                  </TouchableOpacity>
                </View>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>No matches</Text>}
          />
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    fieldLabel: {
      fontSize: 10,
      fontWeight: '600',
      color: c.textMuted,
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 11,
      backgroundColor: c.bg,
    },
    fieldValue: {flex: 1, fontSize: 14, color: c.text},
    caret: {fontSize: 14, color: c.textMuted, marginLeft: 8},
    hint: {fontSize: 11, color: c.textMuted, marginTop: 4},
    modal: {flex: 1, backgroundColor: c.bg},
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      backgroundColor: c.card,
      borderBottomWidth: 0.5,
      borderBottomColor: c.border,
      gap: 12,
    },
    modalTitle: {flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: c.text},
    modalCancel: {fontSize: 16, color: c.textMuted},
    search: {
      margin: 12,
      backgroundColor: c.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: c.text,
    },
    group: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.5,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 6,
      textTransform: 'uppercase',
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 13,
      backgroundColor: c.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    optionSelected: {backgroundColor: c.bg},
    optionText: {flex: 1, fontSize: 15, color: c.text},
    optionTextSelected: {fontWeight: '600', color: c.accentText},
    check: {fontSize: 16, color: c.accentText, marginLeft: 8},
    empty: {textAlign: 'center', color: c.textMuted, padding: 24},
  });
