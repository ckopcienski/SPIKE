import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import {loadSettings, saveSettings, AppSettings, DEFAULT_SETTINGS} from './storage/settings';
import {resolveNetworkColors} from './data/networkColors';

// ─── Colours ────────────────────────────────────────────────────────────────
// Every screen takes its colours from here, so light/dark mode is one switch.

export const lightColors = {
  bg: '#F5F3EE', // screen background, unselected chips
  card: '#FFFFFF', // cards, modal headers, list rows
  text: '#1a1a1a',
  textSecondary: '#666666',
  textMuted: '#888888',
  textFaint: '#CCCCCC',
  placeholder: '#999999',
  border: '#DDDDDD',
  divider: '#EEEEEE',

  primary: '#4D4D61', // brand slate: header bars, filled buttons, selected chips
  primaryDark: '#3A3A4C',
  primaryBorder: '#4D4D61', // outlines on cards (dashed add buttons, export cards)
  accentText: '#4D4D61', // brand-coloured text/numbers on cards
  avatarBg: 'rgba(77,77,97,0.12)', // circle behind the profile symbol
  neutralPill: '#ECEAE4', // small grey status label

  danger: '#A32D2D',
  dangerBg: '#FDF0F0',

  // Network colour coding — defaults (sanitary = green, storm = blue, other = grey).
  // Replaced by the user's choice in Profile & Settings → Network colours.
  sanitaryText: '#085041',
  sanitaryBg: '#E1F5EE',
  sanitaryDot: '#1D9E75',
  stormText: '#0C447C',
  stormBg: '#E6F1FB',
  stormDot: '#185FA5',
  otherText: '#55555F',
  otherBg: '#ECEAE4',
};

export type ThemeColors = typeof lightColors;

export const darkColors: ThemeColors = {
  bg: '#15151B',
  card: '#22222C',
  text: '#ECECF1',
  textSecondary: '#B4B4C0',
  textMuted: '#8E8E9C',
  textFaint: '#55555F',
  placeholder: '#6E6E7A',
  border: '#3A3A46',
  divider: '#2E2E38',

  primary: '#4D4D61',
  primaryDark: '#3A3A4C',
  primaryBorder: '#8C8CA6',
  accentText: '#B9B9D2',
  avatarBg: 'rgba(185,185,210,0.16)',
  neutralPill: '#2E2E38',

  danger: '#EF8A8A',
  dangerBg: 'rgba(163,45,45,0.25)',

  sanitaryText: '#6FD3B0',
  sanitaryBg: 'rgba(29,158,117,0.18)',
  sanitaryDot: '#1D9E75',
  stormText: '#8CBDF0',
  stormBg: 'rgba(24,95,165,0.25)',
  stormDot: '#185FA5',
  otherText: '#B4B4C0',
  otherBg: 'rgba(140,140,166,0.20)',
};

// ─── Context ────────────────────────────────────────────────────────────────

type ThemeContextValue = {
  colors: ThemeColors;
  isDark: boolean;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  isDark: false,
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
});

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const isDark = settings.darkMode;
    const base = isDark ? darkColors : lightColors;
    const net = resolveNetworkColors(settings.networkColors);
    const shade = (o: {light: {text: string; bg: string}; dark: {text: string; bg: string}}) =>
      isDark ? o.dark : o.light;
    const colors: ThemeColors = {
      ...base,
      sanitaryText: shade(net.sanitary).text,
      sanitaryBg: shade(net.sanitary).bg,
      sanitaryDot: net.sanitary.swatch,
      stormText: shade(net.storm).text,
      stormBg: shade(net.storm).bg,
      stormDot: net.storm.swatch,
      otherText: shade(net.other).text,
      otherBg: shade(net.other).bg,
    };
    return {
      colors,
      isDark,
      settings,
      updateSettings: patch => {
        setSettings(prev => {
          const next = {...prev, ...patch};
          saveSettings(next);
          return next;
        });
      },
    };
  }, [settings]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
