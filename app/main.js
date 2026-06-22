const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const updater = require('./updater');

// ===== 启动优化 =====
// GPU 加速
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// 减少启动延迟：提前初始化 GPU 进程
app.commandLine.appendSwitch('disable-background-timer-throttling');
// 禁用不必要的磁盘缓存检查
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies');

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let splashWindow = null;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 380,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: '#0f131a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    skipTaskbar: true,
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  // 如果 splash 加载失败，直接销毁
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0f131a',
    icon: path.join(__dirname, 'tubiao.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      sandbox: false,
      webSecurity: true,
    },
    title: '星堡移印样品仓储系统',
    autoHideMenuBar: true,
  });

  mainWindow.once('ready-to-show', () => {
    // 关闭启动画面
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }

    mainWindow.show();

    // 生产环境下启动后 3 秒静默检查更新
    if (app.isPackaged) {
      setTimeout(() => updater.checkForUpdates(true), 3000);
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
    // 开发环境直接关闭 splash
    if (splashWindow && !splashWindow.isDestroyed()) {
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      }, 800);
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    updater.stopPeriodicCheck();
  });

  // 注册 updater 窗口引用
  updater.setMainWindow(mainWindow);
}

// ===== App 生命周期 =====
app.whenReady().then(() => {
  // 先显示启动画面
  createSplashWindow();

  // 微延迟后再创建主窗口（让启动画面先渲染）
  setImmediate(() => {
    createWindow();

    // 注册 IPC 处理器
    ipcMain.handle('update:check', async () => { await updater.checkForUpdates(); });
    ipcMain.handle('update:download', async () => { await updater.downloadUpdate(); });
    ipcMain.handle('update:install', () => { updater.installAndRestart(); });

    // 启动后台定时检查（每24小时）
    updater.startPeriodicCheck();
  });
});

// 第二个实例被激活
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
