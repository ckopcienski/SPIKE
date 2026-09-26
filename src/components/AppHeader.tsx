import React from 'react';
import {
  View,
  Image,
  StyleSheet,
  StatusBar,
  Platform,
  TouchableOpacity,
} from 'react-native';
import {ProfileAvatar} from './HeaderIcons';
import {useTheme} from '../theme';

export const BRAND_BAR_COLOR = '#4D4D61';

const LOGO_HEIGHT = 36;
const LOGO_ASPECT = 4.387; // width / height of assets/spike-logo-white.png

type Props = {
  onProfilePress?: () => void;
};

/**
 * SPIKE logo bar shown above every screen (rendered once in AppNavigator),
 * with one Profile button (top right) that opens Profile & Settings.
 */
export default function AppHeader({onProfilePress}: Props) {
  const {settings} = useTheme();
  // The app draws behind the Android status bar, so leave room for it
  const statusBarHeight =
    Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 44;

  return (
    <View style={[styles.bar, {paddingTop: statusBarHeight + 6}]}>
      {/* Empty space the same width as the button, so the logo stays centred */}
      <View style={styles.iconBtn} />

      <View style={styles.logoWrap}>
        <Image
          source={require('../assets/spike-logo-white.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="SPIKE"
        />
      </View>

      <TouchableOpacity
        style={styles.iconBtn}
        onPress={onProfilePress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Profile and settings">
        <ProfileAvatar size={30} photoPath={settings.profile?.photoPath} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BRAND_BAR_COLOR,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {flex: 1, alignItems: 'center'},
  logo: {
    height: LOGO_HEIGHT,
    width: LOGO_HEIGHT * LOGO_ASPECT,
  },
});
