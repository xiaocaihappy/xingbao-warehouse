const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');
const ExcelJS = require('exceljs');

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
let tray = null;
let isQuiting = false;
let closeTimeout = null;
let closeClickCount = 0;
const CLOSE_TIMEOUT_MS = 1500;
const DOUBLE_CLICK_MS = 800;
let lastCloseClickTime = 0;

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

  // ===== 关闭处理：带超时兜底 + 双击即退，防止网络阻塞导致无法退出 =====
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

    // 超时保护：1.5 秒后强制退出（断网应急兜底）
    clearTimeout(closeTimeout);
    closeTimeout = setTimeout(() => {
      if (!isQuiting) {
        console.warn('[Close] 渲染进程超时未响应，强制退出');
        isQuiting = true;
        app.quit();
      }
    }, CLOSE_TIMEOUT_MS);
  });

  mainWindow.on('closed', () => {
    clearTimeout(closeTimeout);
    closeTimeout = null;
    mainWindow = null;
    updater.stopPeriodicCheck();
  });

  // 注册 updater 窗口引用
  updater.setMainWindow(mainWindow);
}

function createTray() {
  const iconPath = path.join(__dirname, 'tubiao.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('星堡移印仓储系统');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ===== Excel 导出（含嵌入图片） =====
async function exportExcel(items) {
  const IMG_ROW_HEIGHT = 105;
  const BATCH_SIZE = 8; // 每批下载图片数

  const workbook = new ExcelJS.Workbook();
  workbook.creator = '星堡移印仓储系统';
  const ws = workbook.addWorksheet('移印样品数据');

  // 列定义
  ws.columns = [
    { header: '货架号', key: 'shelf', width: 14 },
    { header: '移印编号', key: 'stamp', width: 22 },
    { header: '销售', key: 'channel', width: 12 },
    { header: '人员', key: 'staff', width: 12 },
    { header: '格子号', key: 'grid', width: 10 },
    { header: '产品货号', key: 'product', width: 20 },
    { header: '图片', key: 'image', width: 22 },
    { header: '创建时间', key: 'time', width: 22 },
  ];

  // 表头样式
  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF0078D4' }, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FFD0D7E8' } },
    };
  });

  // 写入数据行
  items.forEach((item) => {
    const timeStr = item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '';
    const row = ws.addRow({
      shelf: item.shelf_number || '',
      stamp: item.stamp_code || '',
      channel: item.sales_channel || '',
      staff: item.staff_name || '',
      grid: item.grid_number || '',
      product: item.product_code || '',
      image: (item.image_url && item.image_url !== 'EMPTY') ? '图片加载中...' : '无图片',
      time: timeStr,
    });
    row.height = 80;
    row.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (colNumber === 2) {
        cell.font = { bold: true, color: { argb: 'FF0078D4' } };
      }
      if (colNumber === 7) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });
  });

  // 下载并嵌入图片
  const withImages = items.filter(i => i.image_url && i.image_url !== 'EMPTY');
  let downloaded = 0;
  let failed = 0;

  if (withImages.length > 0) {
    const { net } = require('electron');

    for (let batch = 0; batch < withImages.length; batch += BATCH_SIZE) {
      const batchItems = withImages.slice(batch, batch + BATCH_SIZE);
      const promises = batchItems.map((item) => {
        return new Promise((resolve) => {
          const request = net.request({ url: item.image_url, method: 'GET' });
          const chunks = [];
          request.on('response', (response) => {
            if (response.statusCode !== 200) {
              resolve({ item, buffer: null, error: `HTTP ${response.statusCode}` });
              return;
            }
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
              resolve({ item, buffer: Buffer.concat(chunks), error: null });
            });
            response.on('error', (err) => {
              resolve({ item, buffer: null, error: err.message });
            });
          });
          request.on('error', (err) => {
            resolve({ item, buffer: null, error: err.message });
          });
          request.setHeader('User-Agent', 'Xingbao-Warehouse/1.0');
          request.end();
        });
      });

      const results = await Promise.all(promises);

      for (const { item, buffer, error } of results) {
        const rowNum = items.findIndex(s => s.id === item.id) + 2; // +2 = header + 1-based
        if (rowNum < 2) continue;

        if (error || !buffer) {
          failed++;
          ws.getCell(rowNum, 7).value = '⚠ 加载失败';
          continue;
        }

        try {
          // 从魔数判断格式
          const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
          const ext = isPNG ? 'png' : 'jpeg';

          const imageId = workbook.addImage({ buffer, extension: ext });

          // 图片嵌入 G 列，自适应
          ws.addImage(imageId, {
            tl: { col: 6, row: rowNum - 1 },
            br: { col: 7, row: rowNum },
            editAs: 'oneCell',
          });
          ws.getRow(rowNum).height = IMG_ROW_HEIGHT;
          ws.getCell(rowNum, 7).value = ''; // 清除占位文字
          downloaded++;
        } catch (imgErr) {
          failed++;
          ws.getCell(rowNum, 7).value = '⚠ 嵌入失败';
        }
      }
    }
  }

  console.log(`[Excel] 导出完成: ${items.length} 条数据, ${downloaded} 张图片嵌入成功, ${failed} 失败`);
  return await workbook.xlsx.writeBuffer();
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
    ipcMain.handle('app:version', () => app.getVersion());
    // 在线更新诊断
    ipcMain.handle('update:diagnose', async () => {
      try {
        const results = await updater.runDiagnostic();
        return { success: true, results };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
    // 手动清理更新缓存（安全回滚）
    ipcMain.handle('update:cleanup-cache', async () => {
      try {
        const { app: appModule } = require('electron');
        const cacheDir = path.join(appModule.getPath('userData'), 'pending');
        let count = 0;
        if (fs.existsSync(cacheDir)) {
          const files = fs.readdirSync(cacheDir);
          files.forEach((f) => { try { fs.unlinkSync(path.join(cacheDir, f)); count++; } catch {} });
        }
        return { success: true, cleaned: count, message: `已清理 ${count} 个缓存文件` };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    // Excel 导出（含嵌入图片）
    ipcMain.handle('excel:export', async (_event, items) => {
      try {
        const result = await exportExcel(items);
        return { success: true, buffer: result };
      } catch (e) {
        console.error('[Excel] 导出失败:', e.message);
        return { success: false, error: e.message };
      }
    });

    // 关闭窗口确认（收到渲染进程响应后清除超时）
    ipcMain.on('window:confirm-close', (_event, action) => {
      clearTimeout(closeTimeout);
      closeTimeout = null;
      if (action === 'quit') {
        isQuiting = true;
        app.quit();
      } else if (action === 'minimize') {
        mainWindow.hide();
      }
      // 'cancel' 什么都不做
    });

    // 创建系统托盘
    createTray();

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

app.on('before-quit', () => {
  isQuiting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 应用退出前销毁托盘
app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
