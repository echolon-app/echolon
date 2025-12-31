import { app, Menu, shell, BrowserWindow, MenuItemConstructorOptions } from 'electron';

// IPC channel constant (duplicated here to avoid cross-rootDir import issues)
const CHECK_FOR_UPDATES = 'check-for-updates';

const isMac = process.platform === 'darwin';

export function setupMenu(mainWindow: BrowserWindow | null): void {
  const template: MenuItemConstructorOptions[] = [
    // App Menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: 'Check for Updates...',
                click: () => {
                  mainWindow?.webContents.send(CHECK_FOR_UPDATES);
                },
              },
              { type: 'separator' as const },
              {
                label: 'Settings',
                accelerator: 'Cmd+,',
                click: () => {
                  mainWindow?.webContents.send('open-settings');
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),

    // File Menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Request',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('new-request');
          },
        },
        {
          label: 'New Collection',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            mainWindow?.webContents.send('new-collection');
          },
        },
        { type: 'separator' },
        {
          label: 'Import...',
          accelerator: 'CmdOrCtrl+I',
          click: () => {
            mainWindow?.webContents.send('import-collection');
          },
        },
        {
          label: 'Export...',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            mainWindow?.webContents.send('export-collection');
          },
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },

    // Edit Menu - explicit accelerators needed for proper keyboard shortcut handling
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y' },
        { type: 'separator' },
        { role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', accelerator: 'CmdOrCtrl+V' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, accelerator: 'Cmd+Shift+V' },
              { role: 'delete' as const },
              { role: 'selectAll' as const, accelerator: 'Cmd+A' },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const, accelerator: 'Ctrl+A' },
            ]),
      ],
    },

    // View Menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            mainWindow?.webContents.send('toggle-sidebar');
          },
        },
        {
          label: 'Toggle Console',
          accelerator: 'CmdOrCtrl+`',
          click: () => {
            mainWindow?.webContents.send('toggle-console');
          },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Request Menu
    {
      label: 'Request',
      submenu: [
        {
          label: 'Send Request',
          accelerator: 'CmdOrCtrl+Return',
          click: () => {
            mainWindow?.webContents.send('send-request');
          },
        },
        {
          label: 'Save Request',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow?.webContents.send('save-request');
          },
        },
        { type: 'separator' },
        {
          label: 'Duplicate Request',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            mainWindow?.webContents.send('duplicate-request');
          },
        },
      ],
    },

    // Window Menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },

    // Help Menu
    {
      role: 'help',
      submenu: [
        {
          label: 'Documentation',
          click: async () => {
            await shell.openExternal('https://echolon.app/docs');
          },
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/echolon/echolon/issues');
          },
        },
        { type: 'separator' },
        ...(!isMac
          ? [
              {
                label: 'Check for Updates...',
                click: () => {
                  mainWindow?.webContents.send(CHECK_FOR_UPDATES);
                },
              },
            ]
          : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

