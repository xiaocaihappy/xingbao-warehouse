const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const path = require('path');
const updater = require('./updater');
const ExcelJS = require('exceljs');
const https = require('https');
const http = require('http');

// ===== 启动优化 =====
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies');

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let splashWindow = null;
let tray = null;
let isQuiting = false;
let closeTimeout = null;
let closeClickCount = 0;
const CLOSE_TIMEOUT_MS = 1500;
const DOUBLE_CLICK_MS = 800;
let lastCloseClickTime = 0;

// ===== 创建启动画面 =====
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
  splashWindow.on('closed', () => { splashWindow = null; });
}

// ===== 创建主窗口 =====
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

  // ===== 关闭处理：带超时兜底 + 双击即退 =====
  mainWindow.on('close', (event) => {
    if (isQuiting) return;

    // 双击关闭按钮 → 立即强制退出（断网应急）
    const now = Date.now();
    if (now - lastCloseClickTime < DOUBLE_CLICK_MS) {
      isQuiting = true;
      app.quit();
      return;
    }
    lastCloseClickTime = now;

    event.preventDefault();

    // 检查渲染进程是否已崩溃/销毁
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed() || mainWindow.webContents.isCrashed()) {
      isQuiting = true;
      app.quit();
      return;
    }

    // 发送关闭请求到渲染进程
    try {
      mainWindow.webContents.send('window:close-request');
    } catch (e) {
      console.error('[Close] 发送关闭请求失败:', e.message);
      isQuiting = true;
      app.quit();
      return;
    }

    // 超时保护：1.5 秒后强制退出
    clearTimeout(closeTimeout);
    closeTimeout = setTimeout(() => {
      if (!isQuiting) {
        console.warn('[Close] 渲染进程超时未响应，强制退出');
        isQuiting = true;
        app.quit();
      }
    }, CLOSE_TIMEOUT_MS);
  });

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    mainWindow.show();
    if (app.isPackaged) {
      setTimeout(() => updater.checkForUpdates(true), 3000);
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
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

  updater.setMainWindow(mainWindow);
}

// ===== 系统托盘 =====
function createTray() {
  const iconPath = path.join(__dirname, 'XBlogo.png');
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => { if (mainWindow) mainWindow.show(); } },
    { label: '退出', click: () => { isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('星堡移印样品仓储系统');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if (mainWindow) mainWindow.show(); });
}

// ===== IPC 处理器 =====

// 关闭确认
ipcMain.on('window:close-confirm', (event, action) => {
  clearTimeout(closeTimeout);
  if (action === 'quit') {
    isQuiting = true;
    app.quit();
  } else if (action === 'minimize') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      if (!tray) createTray();
    }
  } else if (action === 'cancel') {
    // 取消关闭，什么都不做
  }
});

// Excel 导出（含嵌入图片）
ipcMain.handle('export:excel', async (event, items) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('星堡移印样品');

    // 表头
    sheet.columns = [
      { header: '货架号', key: 'shelf_number', width: 12 },
      { header: '移印编号', key: 'stamp_code', width: 16 },
      { header: '销售渠道', key: 'sales_channel', width: 12 },
      { header: '人员', key: 'staff_name', width: 12 },
      { header: '格子号', key: 'grid_number', width: 10 },
      { header: '产品货号', key: 'product_code', width: 16 },
      { header: '图片', key: 'image', width: 20 },
      { header: '创建时间', key: 'created_at', width: 18 },
    ];

    // 表头样式
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // 数据行
    for (const item of items) {
      const row = sheet.addRow({
        shelf_number: item.shelf_number || '',
        stamp_code: item.stamp_code || '',
        sales_channel: item.sales_channel || '',
        staff_name: item.staff_name || '',
        grid_number: item.grid_number || '',
        product_code: item.product_code || '',
        image: '',
        created_at: item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '',
      });

      row.alignment = { vertical: 'middle' };
      row.height = 60;

      // 嵌入图片
      if (item.image_url && item.image_url !== 'EMPTY' && item.image_url.startsWith('http')) {
        try {
          const imageBuffer = await downloadImage(item.image_url);
          if (imageBuffer) {
            const imageId = workbook.addImage({
              buffer: imageBuffer,
              extension: item.image_url.endsWith('.png') ? 'png' : 'jpeg',
            });
            sheet.addImage(imageId, {
              tl: { col: 6, row: row.number - 1 },
              br: { col: 7, row: row.number },
              editAs: 'oneCell',
            });
          }
        } catch (imgErr) {
          console.warn('[Excel] 图片下载失败:', item.image_url, imgErr.message);
          row.getCell(7).value = '(图片加载失败)';
        }
      }
    }

    // 生成 Buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return { success: true, buffer: Buffer.from(buffer) };
  } catch (err) {
    console.error('[Excel] 导出失败:', err);
    return { success: false, error: err.message };
  }
});

// 下载图片辅助函数
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const chunks = [];
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ===== App 生命周期 =====
app.whenReady().then(() => {
  createSplashWindow();
  setImmediate(() => {
    createWindow();

    ipcMain.handle('update:check', async () => { await updater.checkForUpdates(); });
    ipcMain.handle('update:download', async () => { await updater.downloadUpdate(); });
    ipcMain.handle('update:install', () => { updater.installAndRestart(); });
    ipcMain.handle('app:version', () => app.getVersion());

    updater.startPeriodicCheck();
  });
});

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

app.on('before-quit', () => {
  isQuiting = true;
  if (tray) tray.destroy();
});
