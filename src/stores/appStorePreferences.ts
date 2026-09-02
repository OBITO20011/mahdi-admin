export const APP_STORE_STORAGE_KEY = 'nawasrah_bm_state_v1';

export const VALID_ACTIVE_TABS = [
  'home',
  'orders',
  'products',
  'accounts',
  'more',
  'dashboard',
  'pos',
  'inventory',
  'expenses',
  'shifts',
  'reports',
  'users',
  'purchases',
  'assistant',
] as const;

export type ActiveTab = (typeof VALID_ACTIVE_TABS)[number];
export type ThemeMode = 'dark' | 'light';

export interface PersistedAppPreferences {
  version: 1;
  activeTab: ActiveTab;
  themeMode: ThemeMode;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isActiveTab = (value: unknown): value is ActiveTab =>
  typeof value === 'string' &&
  (VALID_ACTIVE_TABS as readonly string[]).includes(value);

export const readPersistedAppPreferences = (
  saved: string | null,
): Partial<PersistedAppPreferences> => {
  if (!saved) return {};

  try {
    const parsed: unknown = JSON.parse(saved);
    if (!isRecord(parsed)) return {};

    const legacyCurrentUser = isRecord(parsed.currentUser)
      ? parsed.currentUser
      : null;
    const storedThemeMode = parsed.themeMode ?? legacyCurrentUser?.themeMode;

    return {
      ...(isActiveTab(parsed.activeTab) ? { activeTab: parsed.activeTab } : {}),
      ...(storedThemeMode === 'light' || storedThemeMode === 'dark'
        ? { themeMode: storedThemeMode }
        : {}),
    };
  } catch (error) {
    console.warn('[Store preferences read warning]:', error);
    return {};
  }
};

export const loadPersistedAppPreferences = () => {
  try {
    return readPersistedAppPreferences(
      localStorage.getItem(APP_STORE_STORAGE_KEY),
    );
  } catch (error) {
    console.warn('[Store preferences storage warning]:', error);
    return {};
  }
};

export const serializeAppPreferences = (
  activeTab: ActiveTab,
  themeMode: ThemeMode,
) => JSON.stringify({ version: 1, activeTab, themeMode });

export const writePersistedAppPreferences = (serialized: string) => {
  try {
    localStorage.setItem(APP_STORE_STORAGE_KEY, serialized);
    return true;
  } catch (error) {
    console.warn('[Store preferences write warning]:', error);
    return false;
  }
};
