/**
 * Environment detection utilities
 * 
 * Provides stable methods to detect the runtime environment (Electron vs Web)
 * and access build-time injected values.
 */

// Build-time injected values
declare const __APP_VERSION__: string;
declare const __BUILD_TIMESTAMP__: string;

/**
 * App version from package.json (injected at build time)
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

/**
 * Build timestamp (injected at build time)
 * Format: YYYY-MM-DD HH:mm:ss (UTC)
 */
export const BUILD_TIMESTAMP = typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__ : 'dev';

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

/**
 * Check if running as standalone web app (web.echolon.app)
 * vs embedded viewer (*.api.echolon.app or other domains)
 * 
 * Returns true only when running at web.echolon.app
 * Returns false for embedded public spec viewers or other domains
 */
export const isWebStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (isElectron()) return false;
  
  const hostname = window.location.hostname;
  
  // Standalone web app domains
  const standaloneDomains = [
    'web.echolon.app',
    'localhost', // For local development
    '127.0.0.1',
  ];
  
  return standaloneDomains.includes(hostname);
};

/**
 * Check if running as embedded viewer (e.g., *.api.echolon.app)
 */
export const isWebEmbed = (): boolean => {
  return isWeb() && !isWebStandalone();
};

