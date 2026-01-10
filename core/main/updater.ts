import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, ipcMain, app } from 'electron';
import { UPDATE_CHANNELS } from '../shared/ipc-channels';

export interface UpdaterConfig {
  autoCheckUpdates?: boolean;
}

// Store pending update info for "install on next restart"
let pendingUpdateInfo: UpdateInfo | null = null;
let updateDownloaded = false;

export function setupUpdater(mainWindow: BrowserWindow | null, config: UpdaterConfig = {}): void {
  const { autoCheckUpdates = true } = config;

  // Allows to test updates with a not packaged app
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }
 
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
    onUpdateAvailable(mainWindow, info);
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[Updater] No updates available, current version:', info.version);
    mainWindow?.webContents.send(UPDATE_CHANNELS.UPDATE_NOT_AVAILABLE, {
      currentVersion: info.version,
    });
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('[Updater] Error:', err.message);
    mainWindow?.webContents.send(UPDATE_CHANNELS.UPDATE_ERROR, {
      message: err.message,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const logMessage = `[Updater] Download progress: ${progress.percent.toFixed(1)}% (${formatBytes(progress.transferred)}/${formatBytes(progress.total)})`;
    console.log(logMessage);
    mainWindow?.webContents.send(UPDATE_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, {
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
    mainWindow?.webContents.send(UPDATE_CHANNELS.UPDATE_DOWNLOADED, {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName,
    });
  });



  // IPC handlers
  ipcMain.handle(UPDATE_CHANNELS.CHECK_FOR_UPDATES, async () => {
    try {
      console.log('[Updater] Manual check for updates triggered');
      const result = await autoUpdater.checkForUpdates();
      console.log('[Updater] Check for updates result:', result);
      return {
        updateAvailable: result?.updateInfo ? true : false,
        version: result?.updateInfo?.version,
        releaseNotes: result?.updateInfo?.releaseNotes,
        releaseDate: result?.updateInfo?.releaseDate,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Updater] Failed to check for updates:', errorMessage);
      
      // Send error event to renderer
      mainWindow?.webContents.send(UPDATE_CHANNELS.UPDATE_ERROR, {
        message: errorMessage.includes('404') || errorMessage.includes('No published versions')
          ? 'No releases found. Please check back later.'
          : errorMessage,
      });
      
      throw error;
    }
  });

  ipcMain.handle(UPDATE_CHANNELS.DOWNLOAD_UPDATE, async () => {
    try {
      console.log('[Updater] Starting update download...');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error('[Updater] Failed to download update:', error);
      throw error;
    }
  });

  ipcMain.handle(UPDATE_CHANNELS.INSTALL_UPDATE, () => {
    console.log('[Updater] Installing update and restarting...');
    // quitAndInstall(isSilent, isForceRunAfter)
    // isSilent: false = show installer window
    // isForceRunAfter: true = restart app after install
    autoUpdater.quitAndInstall(false, true);
  });

  // Mark update to be installed on next app quit
  ipcMain.handle(UPDATE_CHANNELS.QUIT_AND_INSTALL_LATER, () => {
    console.log('[Updater] Update will be installed on next app restart');
    // autoInstallOnAppQuit is already true, so update will install on quit
    return { success: true, updatePending: updateDownloaded };
  });

  // Set custom update server URL (for debug mode)
  ipcMain.handle(UPDATE_CHANNELS.SET_UPDATE_SERVER, (_, url: string | null) => {
    try {
      if (url && url.trim()) {
        console.log('[Updater] Setting custom update server URL:', url);
        autoUpdater.setFeedURL({
          provider: 'generic',
          url: url.trim(),
        });
      } else {
        // Reset to default GitHub releases
        console.log('[Updater] Resetting to default update server');
        autoUpdater.setFeedURL({
          provider: 'github',
          owner: 'echolon-app',
          repo: 'echolon',
        });
      }
      return { success: true, feedUrl: autoUpdater.getFeedURL() };
    } catch (error) {
      console.error('[Updater] Failed to set update server:', error);
      return { success: false, error: String(error) };
    }
  });

}

export function onUpdateAvailable(mainWindow: BrowserWindow | null, info: UpdateInfo): void {
  console.log('[Updater] Update available:', info.version);
  if (mainWindow) {
    mainWindow.webContents.send(UPDATE_CHANNELS.UPDATE_AVAILABLE, {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName,
    });
  }
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
