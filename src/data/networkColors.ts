// Colours the user can pick for the storm and sanitary networks
// (Profile & Settings → Network colours). Used on screen and in the PDF report.

export type NetworkColorId = 'blue' | 'green' | 'orange' | 'purple';

export interface NetworkColors {
  storm: NetworkColorId;
  sanitary: NetworkColorId;
}

export const DEFAULT_NETWORK_COLORS: NetworkColors = {storm: 'blue', sanitary: 'green'};

interface Shades {
  /** Label text on a tinted background */
  text: string;
  /** Tinted background behind labels / badges */
  bg: string;
}

export interface NetworkColorOption {
  id: NetworkColorId;
  label: string;
  /** Solid colour for the picker swatch and small dots */
  swatch: string;
  light: Shades;
  dark: Shades;
  /** Colour used in the PDF report (network name, stripe, structure outline) */
  pdf: string;
}

export const NETWORK_COLOR_OPTIONS: NetworkColorOption[] = [
  {
    id: 'blue',
    label: 'Blue',
    swatch: '#185FA5',
    light: {text: '#0C447C', bg: '#E6F1FB'},
    dark: {text: '#8CBDF0', bg: 'rgba(24,95,165,0.25)'},
    pdf: '#0C447C',
  },
  {
    id: 'green',
    label: 'Green',
    swatch: '#1D9E75',
    light: {text: '#085041', bg: '#E1F5EE'},
    dark: {text: '#6FD3B0', bg: 'rgba(29,158,117,0.18)'},
    pdf: '#085041',
  },
  {
    id: 'orange',
    label: 'Orange',
    swatch: '#E07B1F',
    light: {text: '#8A4A0B', bg: '#FCEEDD'},
    dark: {text: '#F5B26B', bg: 'rgba(224,123,31,0.22)'},
    pdf: '#B35F12',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatch: '#7B55C0',
    light: {text: '#5C3D8F', bg: '#EDE8F8'},
    dark: {text: '#C4AEF0', bg: 'rgba(92,61,143,0.28)'},
    pdf: '#5C3D8F',
  },
];

/** Structures that are neither storm nor sanitary — neutral grey so they never clash */
export const OTHER_NETWORK_COLOR = {
  swatch: '#8C8CA6',
  light: {text: '#55555F', bg: '#ECEAE4'},
  dark: {text: '#B4B4C0', bg: 'rgba(140,140,166,0.20)'},
  pdf: '#6B6B78',
};

export function networkColorOption(id: NetworkColorId | undefined, fallback: NetworkColorId): NetworkColorOption {
  return (
    NETWORK_COLOR_OPTIONS.find(o => o.id === id) ??
    NETWORK_COLOR_OPTIONS.find(o => o.id === fallback)!
  );
}

/** The user's choice, with defaults filled in */
export function resolveNetworkColors(saved?: Partial<NetworkColors>) {
  return {
    storm: networkColorOption(saved?.storm, DEFAULT_NETWORK_COLORS.storm),
    sanitary: networkColorOption(saved?.sanitary, DEFAULT_NETWORK_COLORS.sanitary),
    other: OTHER_NETWORK_COLOR,
  };
}
