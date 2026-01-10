import { STORAGE_KEYS } from '../../shared/constants';
import { Collection, Environment, HistoryEntry, AppSettings, Tab, Workspace, ColorScheme } from '@/types';

class LocalStorageManager {
  private static instance: LocalStorageManager;

  private constructor() {}

  static getInstance(): LocalStorageManager {
    if (!LocalStorageManager.instance) {
      LocalStorageManager.instance = new LocalStorageManager();
    }
    return LocalStorageManager.instance;
  }

  private get<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.error(`Error reading from localStorage (${key}):`, error);
      return defaultValue;
    }
  }

  private set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Error writing to localStorage (${key}):`, error);
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Error removing from localStorage (${key}):`, error);
    }
  }

  // Collections
  getCollections(): Collection[] {
    return this.get<Collection[]>(STORAGE_KEYS.COLLECTIONS, []);
  }

  setCollections(collections: Collection[]): void {
    this.set(STORAGE_KEYS.COLLECTIONS, collections);
  }

  addCollection(collection: Collection): void {
    const collections = this.getCollections();
    collections.push(collection);
    this.setCollections(collections);
  }

  updateCollection(id: string, updates: Partial<Collection>): void {
    const collections = this.getCollections();
    const index = collections.findIndex(c => c.id === id);
    if (index !== -1) {
      collections[index] = { ...collections[index], ...updates, updatedAt: Date.now() };
      this.setCollections(collections);
    }
  }

  deleteCollection(id: string): void {
    const collections = this.getCollections().filter(c => c.id !== id);
    this.setCollections(collections);
  }

  // Environments
  getEnvironments(): Environment[] {
    return this.get<Environment[]>(STORAGE_KEYS.ENVIRONMENTS, []);
  }

  setEnvironments(environments: Environment[]): void {
    this.set(STORAGE_KEYS.ENVIRONMENTS, environments);
  }

  addEnvironment(environment: Environment): void {
    const environments = this.getEnvironments();
    environments.push(environment);
    this.setEnvironments(environments);
  }

  updateEnvironment(id: string, updates: Partial<Environment>): void {
    const environments = this.getEnvironments();
    const index = environments.findIndex(e => e.id === id);
    if (index !== -1) {
      environments[index] = { ...environments[index], ...updates };
      this.setEnvironments(environments);
    }
  }

  deleteEnvironment(id: string): void {
    const environments = this.getEnvironments().filter(e => e.id !== id);
    this.setEnvironments(environments);
  }

  // Selected environment (which one is currently in use)
  getSelectedEnvironmentId(): string | null {
    return this.get<string | null>(STORAGE_KEYS.SELECTED_ENVIRONMENT, null);
  }

  setSelectedEnvironmentId(id: string | null): void {
    this.set(STORAGE_KEYS.SELECTED_ENVIRONMENT, id);
  }

  // Legacy methods - kept for backwards compatibility
  setActiveEnvironment(id: string | null): void {
    this.setSelectedEnvironmentId(id);
  }

  getActiveEnvironment(): Environment | null {
    const selectedId = this.getSelectedEnvironmentId();
    if (!selectedId) return null;
    return this.getEnvironments().find(e => e.id === selectedId) || null;
  }

  // History - Now persisted to disk via FileStorageManager
  // These methods are kept for backwards compatibility but defer to file storage
  /** @deprecated History is now persisted to disk via FileStorageManager */
  getHistory(): HistoryEntry[] {
    // Clear any existing history from localStorage (migrated to disk)
    this.remove(STORAGE_KEYS.HISTORY);
    return [];
  }

  /** @deprecated History is now persisted to disk via FileStorageManager */
  setHistory(_history: HistoryEntry[]): void {
    // No-op - history stored on disk now
  }

  /** @deprecated History is now persisted to disk via FileStorageManager */
  addHistoryEntry(_entry: HistoryEntry): void {
    // No-op - history stored on disk now
  }

  /** @deprecated History is now persisted to disk via FileStorageManager */
  clearHistory(): void {
    this.remove(STORAGE_KEYS.HISTORY);
  }

  // Settings
  getSettings(): AppSettings {
    const defaultSettings: AppSettings = {
      theme: 'dark',
      colorScheme: 'midnight',
      fontSize: 13,
      tabSize: 2,
      wordWrap: true,
      autoSave: true,
      requestTimeout: 30000,
      followRedirects: true,
      validateSSL: true,
      proxyEnabled: false,
      debugMode: false,
    };
    return this.get<AppSettings>(STORAGE_KEYS.SETTINGS, defaultSettings);
  }

  setSettings(settings: AppSettings): void {
    this.set(STORAGE_KEYS.SETTINGS, settings);
  }

  updateSettings(updates: Partial<AppSettings>): void {
    const settings = this.getSettings();
    this.setSettings({ ...settings, ...updates });
  }

  // Theme
  getTheme(): 'light' | 'dark' | 'system' {
    return this.get<'light' | 'dark' | 'system'>(STORAGE_KEYS.THEME, 'dark');
  }

  setTheme(theme: 'light' | 'dark' | 'system'): void {
    this.set(STORAGE_KEYS.THEME, theme);
  }

  // Color Scheme
  getColorScheme(): ColorScheme {
    return this.get<ColorScheme>(STORAGE_KEYS.COLOR_SCHEME, 'terminal');
  }

  setColorScheme(scheme: ColorScheme): void {
    this.set(STORAGE_KEYS.COLOR_SCHEME, scheme);
  }

  // Tabs
  getTabs(): Tab[] {
    return this.get<Tab[]>(STORAGE_KEYS.TABS, []);
  }

  setTabs(tabs: Tab[]): void {
    this.set(STORAGE_KEYS.TABS, tabs);
  }

  // Active Tab ID
  getActiveTabId(): string | null {
    return this.get<string | null>(STORAGE_KEYS.ACTIVE_TAB, null);
  }

  setActiveTabId(tabId: string | null): void {
    this.set(STORAGE_KEYS.ACTIVE_TAB, tabId);
  }

  // Panel Sizes
  getPanelSizes(): {
    leftPanelWidth: number;
    consoleHeight: number;
    responseHeight: number;
    responseWidth: number;
    codePanelWidth: number;
  } {
    return this.get(STORAGE_KEYS.PANEL_SIZES, {
      leftPanelWidth: 280,
      consoleHeight: 200,
      responseHeight: 300,
      responseWidth: 500,
      codePanelWidth: 400,
    });
  }

  setPanelSizes(sizes: {
    leftPanelWidth?: number;
    consoleHeight?: number;
    responseHeight?: number;
    responseWidth?: number;
    codePanelWidth?: number;
  }): void {
    const current = this.getPanelSizes();
    this.set(STORAGE_KEYS.PANEL_SIZES, { ...current, ...sizes });
  }

  // Sidebar View
  getSidebarView(): 'collections' | 'environments' | 'history' | 'mocking' | 'git' | 'socket' | 'graphql' {
    return this.get<'collections' | 'environments' | 'history' | 'mocking' | 'git' | 'socket' | 'graphql'>(STORAGE_KEYS.SIDEBAR_VIEW, 'collections');
  }

  setSidebarView(view: 'collections' | 'environments' | 'history' | 'mocking' | 'git' | 'socket' | 'graphql'): void {
    this.set(STORAGE_KEYS.SIDEBAR_VIEW, view);
  }

  // Sample Collection Created Flag (stored in settings)
  isSampleCreated(): boolean {
    const settings = this.getSettings();
    return settings.sampleCreated ?? false;
  }

  setSampleCreated(created: boolean): void {
    this.updateSettings({ sampleCreated: created });
  }

  // Workspaces
  getWorkspaces(): Workspace[] {
    return this.get<Workspace[]>(STORAGE_KEYS.WORKSPACES, []);
  }

  setWorkspaces(workspaces: Workspace[]): void {
    this.set(STORAGE_KEYS.WORKSPACES, workspaces);
  }

  addWorkspace(workspace: Workspace): void {
    const workspaces = this.getWorkspaces();
    workspaces.push(workspace);
    this.setWorkspaces(workspaces);
  }

  updateWorkspace(id: string, updates: Partial<Workspace>): void {
    const workspaces = this.getWorkspaces();
    const index = workspaces.findIndex(w => w.id === id);
    if (index !== -1) {
      workspaces[index] = { ...workspaces[index], ...updates, updatedAt: Date.now() };
      this.setWorkspaces(workspaces);
    }
  }

  deleteWorkspace(id: string): void {
    const workspaces = this.getWorkspaces().filter(w => w.id !== id);
    this.setWorkspaces(workspaces);
  }

  getActiveWorkspaceId(): string | null {
    return this.get<string | null>(STORAGE_KEYS.ACTIVE_WORKSPACE, null);
  }

  setActiveWorkspaceId(id: string | null): void {
    this.set(STORAGE_KEYS.ACTIVE_WORKSPACE, id);
  }

  // Custom HTTP Methods
  getCustomHttpMethods(): string[] {
    return this.get<string[]>(STORAGE_KEYS.CUSTOM_HTTP_METHODS, []);
  }

  setCustomHttpMethods(methods: string[]): void {
    this.set(STORAGE_KEYS.CUSTOM_HTTP_METHODS, methods);
  }

  addCustomHttpMethod(method: string): void {
    const methods = this.getCustomHttpMethods();
    const upperMethod = method.toUpperCase();
    if (!methods.includes(upperMethod)) {
      methods.push(upperMethod);
      this.setCustomHttpMethods(methods);
    }
  }

  removeCustomHttpMethod(method: string): void {
    const methods = this.getCustomHttpMethods().filter(m => m !== method.toUpperCase());
    this.setCustomHttpMethods(methods);
  }

  // Clear all data
  clearAll(): void {
    Object.values(STORAGE_KEYS).forEach(key => this.remove(key));
  }

  // Export all data for backup
  exportData(): string {
    const data = {
      collections: this.getCollections(),
      environments: this.getEnvironments(),
      history: this.getHistory(),
      settings: this.getSettings(),
      tabs: this.getTabs(),
      workspaces: this.getWorkspaces(),
      activeWorkspaceId: this.getActiveWorkspaceId(),
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
  }

  // Import data from backup
  importData(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (data.collections) this.setCollections(data.collections);
      if (data.environments) this.setEnvironments(data.environments);
      if (data.history) this.setHistory(data.history);
      if (data.settings) this.setSettings(data.settings);
      if (data.tabs) this.setTabs(data.tabs);
      if (data.workspaces) this.setWorkspaces(data.workspaces);
      if (data.activeWorkspaceId) this.setActiveWorkspaceId(data.activeWorkspaceId);
      return true;
    } catch (error) {
      console.error('Error importing data:', error);
      return false;
    }
  }
}

export const storageManager = LocalStorageManager.getInstance();
export default storageManager;

