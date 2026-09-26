import React, {useMemo} from 'react';
import {View, StatusBar, StyleSheet} from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import JobsScreen from '../screens/JobsScreen';
import StructuresScreen from '../screens/StructuresScreen';
import DataEntryScreen from '../screens/DataEntryScreen';
import SummaryScreen from '../screens/SummaryScreen';
import PhotoScreen from '../screens/PhotoScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import TemplatesScreen from '../screens/TemplatesScreen';
import TemplateEditScreen from '../screens/TemplateEditScreen';
import CalibrationScreen from '../screens/CalibrationScreen';
import AppHeader from '../components/AppHeader';
import {useTheme} from '../theme';

export type RootStackParamList = {
  Jobs: undefined;
  Structures: {jobId: string};
  DataEntry: {jobId: string; structureId?: string};
  Summary: {jobId: string};
  Photo: {jobId: string; structureId: string};
  Settings: undefined;
  /** Personal information (name, job title, company, license, photo) */
  Profile: undefined;
  Templates: undefined;
  /**
   * templateId = edit that template; copyFromId = new template copied from it;
   * fromJobId = new template built from a job ("Save as Template"); none = new copy of S.P.I.K.E
   */
  TemplateEdit: {templateId?: string; copyFromId?: string; fromJobId?: string};
  /** GPS calibration on a known control point, for one job */
  Calibration: {jobId: string};
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Lets the logo bar (which sits outside the screens) open Profile & Settings
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function openSettings() {
  if (navigationRef.isReady()) navigationRef.navigate('Settings');
}

export default function AppNavigator() {
  const {colors: c, isDark} = useTheme();

  // Background shown behind screens during transitions — match the theme
  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {...base.colors, background: c.bg, card: c.card, text: c.text, border: c.border},
    };
  }, [c, isDark]);

  return (
    <View style={[styles.root, {backgroundColor: c.bg}]}>
      {/* Light status-bar icons to sit on the slate logo bar */}
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      {/* SPIKE logo — stays in place while screens change below it */}
      <AppHeader onProfilePress={openSettings} />

      <View style={styles.screens}>
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <Stack.Navigator
            initialRouteName="Jobs"
            screenOptions={{headerShown: false}}>
            <Stack.Screen name="Jobs" component={JobsScreen} />
            <Stack.Screen name="Structures" component={StructuresScreen} />
            <Stack.Screen name="DataEntry" component={DataEntryScreen} />
            <Stack.Screen name="Calibration" component={CalibrationScreen} />
            <Stack.Screen name="Summary" component={SummaryScreen} />
            <Stack.Screen name="Photo" component={PhotoScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Templates" component={TemplatesScreen} />
            <Stack.Screen name="TemplateEdit" component={TemplateEditScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  screens: {flex: 1},
});
