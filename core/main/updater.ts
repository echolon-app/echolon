import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';

// IPC channel constants (duplicated here to avoid cross-rootDir import issues)
const IPC_CHANNELS = {
  CHECK_FOR_UPDATES: 'check-for-updates',
  UPDATE_AVAILABLE: 'update-available',
  UPDATE_NOT_AVAILABLE: 'update-not-available',
  UPDATE_DOWNLOADED: 'update-downloaded',
  UPDATE_ERROR: 'update-error',
  DOWNLOAD_UPDATE: 'download-update',
  INSTALL_UPDATE: 'install-update',
  QUIT_AND_INSTALL_LATER: 'quit-and-install-later',
  GET_APP_VERSION: 'get-app-version',
  UPDATE_DOWNLOAD_PROGRESS: 'update-download-progress',
} as const;

export interface UpdaterConfig {
  autoCheckUpdates?: boolean;
}

// Store pending update info for "install on next restart"
let pendingUpdateInfo: UpdateInfo | null = null;
let updateDownloaded = false;

export function setupUpdater(mainWindow: BrowserWindow | null, config: UpdaterConfig = {}): void {
  const { autoCheckUpdates = true } = config;
  
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  
  // Allow pre-release updates if current version is pre-release
  autoUpdater.allowPrerelease = false;
  
  // Check for updates on startup (after a delay) only if enabled
  if (autoCheckUpdates) {
    setTimeout(() => {
      console.log('[Updater] Auto-checking for updates...');
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[Updater] Auto-check failed:', err);
      });
    }, 10000); // 10 second delay for startup
  }

  // Handle update events
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[Updater] Update available:', info.version);
    mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_AVAILABLE, {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[Updater] No updates available, current version:', info.version);
    mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, {
      currentVersion: info.version,
    });
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('[Updater] Error:', err.message);
    mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_ERROR, {
      message: err.message,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const logMessage = `[Updater] Download progress: ${progress.percent.toFixed(1)}% (${formatBytes(progress.transferred)}/${formatBytes(progress.total)})`;
    console.log(logMessage);
    mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[Updater] Update downloaded:', info.version);
    pendingUpdateInfo = info;
    updateDownloaded = true;
    mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOADED, {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName,
    });
  });

  // IPC handlers
  ipcMain.handle(IPC_CHANNELS.CHECK_FOR_UPDATES, async () => {
    try {
      console.log('[Updater] Manual check for updates triggered');
      const result = await autoUpdater.checkForUpdates();
      return {
        updateAvailable: result?.updateInfo ? true : false,
        version: result?.updateInfo?.version,
        releaseNotes: result?.updateInfo?.releaseNotes,
        releaseDate: result?.updateInfo?.releaseDate,
      };
    } catch (error) {
      console.error('[Updater] Failed to check for updates:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_UPDATE, async () => {
    try {
      console.log('[Updater] Starting update download...');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error('[Updater] Failed to download update:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.INSTALL_UPDATE, () => {
    console.log('[Updater] Installing update and restarting...');
    // quitAndInstall(isSilent, isForceRunAfter)
    // isSilent: false = show installer window
    // isForceRunAfter: true = restart app after install
    autoUpdater.quitAndInstall(false, true);
  });

  // Mark update to be installed on next app quit
  ipcMain.handle(IPC_CHANNELS.QUIT_AND_INSTALL_LATER, () => {
    console.log('[Updater] Update will be installed on next app restart');
    // autoInstallOnAppQuit is already true, so update will install on quit
    return { success: true, updatePending: updateDownloaded };
  });

  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, () => {
    return autoUpdater.currentVersion.version;
  });
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Export for checking pending updates
export function hasPendingUpdate(): boolean {
  return updateDownloaded;
}

export function getPendingUpdateInfo(): UpdateInfo | null {
  return pendingUpdateInfo;
}
