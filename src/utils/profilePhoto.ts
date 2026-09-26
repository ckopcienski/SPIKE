import {Alert, Linking, PermissionsAndroid, Platform} from 'react-native';
import RNFS from 'react-native-fs';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';

async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const perm = PermissionsAndroid.PERMISSIONS.CAMERA;
  if (await PermissionsAndroid.check(perm)) return true;
  const result = await PermissionsAndroid.request(perm);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    Alert.alert('Camera blocked', 'Enable camera access in Settings → Apps → SPIKE → Permissions.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Open Settings', onPress: () => Linking.openSettings()},
    ]);
  }
  return false;
}

/**
 * Let the user take or choose a profile picture. The picture is copied into
 * the app (so it survives the phone clearing its cache) and its path returned,
 * or null if they cancelled.
 */
export async function pickProfilePhoto(source: 'camera' | 'library'): Promise<string | null> {
  const options = {
    mediaType: 'photo' as const,
    maxWidth: 600,
    maxHeight: 600,
    quality: 0.8 as const,
  };

  let response;
  if (source === 'camera') {
    if (!(await ensureCameraPermission())) return null;
    response = await launchCamera({...options, cameraType: 'front', saveToPhotos: false});
  } else {
    response = await launchImageLibrary(options);
  }
  if (response.didCancel) return null;
  if (response.errorCode) {
    Alert.alert('Photo error', response.errorMessage || 'Could not get the photo.');
    return null;
  }
  const uri = response.assets?.[0]?.uri;
  if (!uri) return null;

  // New file name each time so the header picture refreshes immediately
  const dest = `${RNFS.DocumentDirectoryPath}/profile-photo-${Date.now()}.jpg`;
  await RNFS.copyFile(uri.replace(/^file:\/\//, ''), dest);
  return dest;
}

export async function deleteProfilePhoto(path?: string): Promise<void> {
  if (!path) return;
  try {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  } catch {
    // leftover file is harmless
  }
}
