/**
 * Environment detection utilities
 * 
 * Provides stable methods to detect the runtime environment (Electron vs Web)
 * and access build-time injected values.
 */

// Build-time injected version from package.json
declare const __APP_VERSION__: string;

/**
 * App version from package.json (injected at build time)
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

/**
 * Check if running in Electron environment
 * 
 * This checks for the presence of the electronAPI on the window object,
 * which is exposed via the preload script.
 */
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && 
    window.electronAPI !== undefined && 
    typeof window.electronAPI.getAppVersion === 'function';
};

/**
 * Check if running in web browser (not Electron)
 */
export const isWeb = (): boolean => {
  return !isElectron();
};

/**
 * Get environment name
 */
export const getEnvironment = (): 'electron' | 'web' => {
  return isElectron() ? 'electron' : 'web';
};

