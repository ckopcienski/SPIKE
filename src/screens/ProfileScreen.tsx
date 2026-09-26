import React, {useMemo, useState} from 'react';
import {View, Text, TouchableOpacity, ScrollView, TextInput, Alert} from 'react-native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RootStackParamList} from '../navigation/AppNavigator';
import KeyboardSafeView, {useKeyboardScroll} from '../components/KeyboardSafeView';
import {useTheme} from '../theme';
import {ProfileAvatar} from '../components/HeaderIcons';
import {UserProfile} from '../storage/settings';
import {pickProfilePhoto, deleteProfilePhoto} from '../utils/profilePhoto';
import {makeScreenStyles} from './SettingsScreen';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Profile'>;
};

/** Personal information — opened from the profile card at the top of Profile & Settings */
export default function ProfileScreen({navigation}: Props) {
  const {colors: c, settings, updateSettings} = useTheme();
  const styles = useMemo(() => makeScreenStyles(c), [c]);
  const keyboardScroll = useKeyboardScroll(); // keep the focused box above the keyboard
  const profile = settings.profile ?? {};

  // Text fields are saved when you leave the field
  const [name, setName] = useState(profile.name ?? '');
  const [title, setTitle] = useState(profile.title ?? '');
  const [firm, setFirm] = useState(profile.firm ?? '');
  const [license, setLicense] = useState(profile.license ?? '');

  function saveProfile(patch: Partial<UserProfile>) {
    updateSettings({profile: {...(settings.profile ?? {}), ...patch}});
  }

  async function setPhoto(source: 'camera' | 'library') {
    const path = await pickProfilePhoto(source);
    if (!path) return;
    const old = settings.profile?.photoPath;
    saveProfile({photoPath: path});
    await deleteProfilePhoto(old);
  }

  function handleChangePhoto() {
    const buttons: {text: string; style?: 'cancel' | 'destructive'; onPress?: () => void}[] = [
      {text: 'Take photo', onPress: () => setPhoto('camera')},
      {text: 'Choose from library', onPress: () => setPhoto('library')},
    ];
    if (profile.photoPath) {
      buttons.push({
        text: 'Remove photo',
        style: 'destructive',
        onPress: async () => {
          const old = profile.photoPath;
          saveProfile({photoPath: undefined});
          await deleteProfilePhoto(old);
        },
      });
    }
    // Android shows up to three buttons; tap outside the box to cancel
    Alert.alert('Profile picture', undefined, buttons, {cancelable: true});
  }

  const fields: {
    label: string;
    value: string;
    set: (v: string) => void;
    key: keyof UserProfile;
    placeholder: string;
    caps: 'words' | 'characters';
  }[] = [
    {label: 'NAME', value: name, set: setName, key: 'name', placeholder: 'e.g. John Smith', caps: 'words'},
    {label: 'JOB TITLE', value: title, set: setTitle, key: 'title', placeholder: 'e.g. Field Technician', caps: 'words'},
    {label: 'COMPANY / FIRM', value: firm, set: setFirm, key: 'firm', placeholder: 'e.g. Acme Utility Services', caps: 'words'},
    {label: 'LICENSE NO.', value: license, set: setLicense, key: 'license', placeholder: 'Optional', caps: 'characters'},
  ];

  return (
    <KeyboardSafeView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Personal Information</Text>
        <View style={{width: 50}} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" {...keyboardScroll}>
        <View style={[styles.card, styles.profileCard]}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handleChangePhoto}
            accessibilityLabel="Change profile picture">
            <ProfileAvatar
              size={96}
              photoPath={profile.photoPath}
              color={c.accentText}
              background={c.avatarBg}
            />
            <Text style={styles.changePhoto}>
              {profile.photoPath ? 'Change photo' : 'Add photo'}
            </Text>
          </TouchableOpacity>

          {fields.map(f => (
            <View key={f.key}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <TextInput
                style={styles.input}
                value={f.value}
                onChangeText={f.set}
                onEndEditing={() => saveProfile({[f.key]: f.value.trim()})}
                placeholder={f.placeholder}
                placeholderTextColor={c.placeholder}
                autoCapitalize={f.caps}
              />
            </View>
          ))}

          <Text style={styles.profileNote}>
            Saved on this phone. These will move to your account once sign-in is available.
          </Text>
        </View>
      </ScrollView>
    </KeyboardSafeView>
  );
}
