const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let mainWindow = null;
let flaskProcess = null;

const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'http://127.0.0.1:5010';
const APP_ICON_PATH = path.join(__dirname, 'favicon.svg');

function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${APP_URL}/health`, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 300);
      req.destroy();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServerReady(maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await checkServerRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

function startFlask() {
  if (flaskProcess) return;

  let cmd;
  let args;
  let cwd;
  const env = { ...process.env };

  if (app.isPackaged) {
    // In packaged mode, use the bundled server binary placed in extraResources/server/
    const serverDir = path.join(process.resourcesPath, 'server');
    const binaryName = process.platform === 'win32' ? 'server.exe' : 'server';
    cmd = path.join(serverDir, binaryName);
    args = [];
    cwd = serverDir;
    // Point writable user data to Electron's userData directory
    env.HGWRITER_DATA_DIR = app.getPath('userData');
  } else {
    // Development mode: spawn system Python
    cmd = process.platform === 'win32' ? 'python' : 'python3';
    args = ['app.py'];
    cwd = ROOT;
  }

  flaskProcess = spawn(cmd, args, {
    cwd,
    env,
    stdio: 'ignore',
    detached: false,
  });
}

function stopFlask() {
  if (!flaskProcess) return;
  flaskProcess.kill();
  flaskProcess = null;
}

function createMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    icon: APP_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.webContents.on('context-menu', () => {
    const contextTemplate = [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ];
    const contextMenu = Menu.buildFromTemplate(contextTemplate);
    contextMenu.popup();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupContextMenu() {
  const template = process.platform === 'darwin'
    ? [
      { role: 'appMenu' },
      {
        label: 'Bestand',
        submenu: [
          {
            label: 'Open',
            click: () => createMainWindow(),
          },
          { type: 'separator' },
          { role: 'quit', label: 'Afsluiten' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]
    : [
      {
        label: 'Bestand',
        submenu: [
          {
            label: 'Open',
            click: () => createMainWindow(),
          },
          { type: 'separator' },
          { role: 'quit', label: 'Afsluiten' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
    ];

  const menu = Menu.buildFromTemplate(template);

  Menu.setApplicationMenu(menu);

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(menu);
  }

  if (process.platform === 'win32') {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: '--open',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Open',
        description: 'Open Holy Ghostwriter',
      },
      {
        program: process.execPath,
        arguments: '--quit',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Afsluiten',
        description: 'Sluit Holy Ghostwriter af',
      },
    ]);
  }
}

app.whenReady().then(async () => {
  if (process.argv.includes('--quit')) {
    app.quit();
    return;
  }

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON_PATH);
  }

  const alreadyRunning = await checkServerRunning();
  if (!alreadyRunning) {
    startFlask();
    await waitForServerReady();
  }

  createMainWindow();
  setupContextMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopFlask();
});
