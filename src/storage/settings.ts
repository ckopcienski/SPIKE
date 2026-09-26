import RNFS from 'react-native-fs';
import type {NetworkColors} from '../data/networkColors';

// The user's details (shown on the Profile & Settings screen; later tied to their account)
export interface UserProfile {
  name?: string;
  /** Job title / role, e.g. "Field Technician" */
  title?: string;
  firm?: string;
  license?: string;
  /** Path of the profile picture saved inside the app */
  photoPath?: string;
}

// App-wide settings (not tied to a job), saved on the phone
export interface AppSettings {
  darkMode: boolean;
  /** Template chosen last time a job was created (pre-selected next time) */
  lastTemplateId?: string;
  profile?: UserProfile;
  /** Colours for the storm and sanitary networks (app and PDF report) */
  networkColors?: NetworkColors;
  /** When the last full backup was made (ISO date) */
  lastBackupAt?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
};

const SETTINGS_PATH = `${RNFS.DocumentDirectoryPath}/spike-settings.json`;

export async function loadSettings(): Promise<AppSettings> {
  try {
    if (!(await RNFS.exists(SETTINGS_PATH))) return DEFAULT_SETTINGS;
    const saved = JSON.parse(await RNFS.readFile(SETTINGS_PATH, 'utf8'));
    return {...DEFAULT_SETTINGS, ...saved};
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await RNFS.writeFile(SETTINGS_PATH, JSON.stringify(settings), 'utf8');
  } catch {
    // not critical — the setting just won't be remembered next launch
  }
}
