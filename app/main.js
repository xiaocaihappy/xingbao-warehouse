const { app, BrowserWindow, ipcMain, Tray, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');
const ExcelJS = require('exceljs');

// ===== 崩溃日志系统 =====
const CRASH_LOG_DIR = app.getPath('userData');
const CRASH_LOG_FILE = path.join(CRASH_LOG_DIR, 'crash.log');
const STARTUP_LOG_FILE = path.join(CRASH_LOG_DIR, 'startup.log');

function writeCrashLog(type, error) {
  try {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${type}] ${error?.stack || error?.message || String(error)}\n`;
    fs.appendFileSync(CRASH_LOG_FILE, entry, 'utf-8');
  } catch {}
}

function writeStartupLog(phase, detail = '') {
  try {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [STARTUP:${phase}] ${detail}\n`;
    fs.appendFileSync(STARTUP_LOG_FILE, entry, 'utf-8');
  } catch {}
}

// 清空上次启动日志
try { fs.writeFileSync(STARTUP_LOG_FILE, '', 'utf-8'); } catch {}
writeStartupLog('PROCESS_START', `PID=${process.pid} Electron=${process.versions.electron} Chrome=${process.versions.chrome} Node=${process.versions.node} Win=${process.platform}`);

// ===== 全局异常捕获（必须在最早位置注册） =====
process.on('uncaughtException', (error) => {
  writeCrashLog('UNCAUGHT_EXCEPTION', error);
  console.error('[FATAL] uncaughtException:', error.message);
  console.error(error.stack);
  try {
    fs.writeFileSync(
      path.join(CRASH_LOG_DIR, 'last-crash.txt'),
      `${new Date().toISOString()}\n${error.stack || error.message}`,
      'utf-8'
    );
  } catch {}
});

process.on('unhandledRejection', (reason) => {
  writeCrashLog('UNHANDLED_REJECTION', reason);
  console.error('[FATAL] unhandledRejection:', reason);
});

// ===== 启动优化 =====
// GPU 加速（添加黑名单检测以兼容旧显卡）
const gpuBlacklist = process.env.XINGBAO_NO_GPU === '1';
if (!gpuBlacklist) {
  try {
    app.commandLine.appendSwitch('disable-software-rasterizer');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
  } catch {}
}
// 减少启动延迟：提前初始化 GPU 进程
try { app.commandLine.appendSwitch('disable-background-timer-throttling'); } catch {}
// 禁用不必要的磁盘缓存检查
try { app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies'); } catch {}

// 设置应用名称（影响托盘提示、通知等）
try { app.setName('星堡移印仓储系统'); } catch {}
writeStartupLog('GPU_FLAGS', gpuBlacklist ? 'skipped (XINGBAO_NO_GPU=1)' : 'applied');

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  writeStartupLog('SINGLE_INSTANCE', 'already running, quitting');
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

// 主题文件路径（用于 splash 窗口读取）
const THEME_FILE = path.join(app.getPath('userData'), 'theme.json');

// 读取已保存的主题
function readSavedTheme() {
  try {
    if (fs.existsSync(THEME_FILE)) {
      return JSON.parse(fs.readFileSync(THEME_FILE, 'utf-8'));
    }
  } catch {}
  return { theme: 'dark', isLight: false };
}

function createSplashWindow() {
  try {
    const splashPath = path.join(__dirname, 'splash.html');
    writeStartupLog('SPLASH_CREATE', `loading ${splashPath}`);

    const themeData = readSavedTheme();
    const themeQuery = `?theme=${themeData.theme}&light=${themeData.isLight ? 1 : 0}`;

    splashWindow = new BrowserWindow({
      width: 460,
      height: 380,
      frame: false,
      transparent: false,
      resizable: false,
      center: true,
      show: true,
      backgroundColor: themeData.isLight ? '#f5f8fb' : '#0f131a',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
      skipTaskbar: true,
    });

    splashWindow.loadFile(splashPath, { query: { theme: themeData.theme, light: themeData.isLight ? '1' : '0' } }).catch((err) => {
      writeCrashLog('SPLASH_LOAD_FAIL', err);
      console.error('[Splash] loadFile failed:', err.message);
    });

    splashWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      writeCrashLog('SPLASH_FAIL_LOAD', new Error(`Code=${errorCode} ${errorDescription}`));
    });

    splashWindow.on('closed', () => {
      splashWindow = null;
    });
  } catch (err) {
    writeCrashLog('SPLASH_CREATE_FAIL', err);
    console.error('[Splash] createSplashWindow failed:', err.message);
  }
}

function createWindow() {
  try {
    writeStartupLog('MAIN_WINDOW_CREATE', 'start');

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
        sandbox: true,
        webSecurity: true,
      },
      title: '星堡移印仓储系统',
      autoHideMenuBar: true,
    });

    // ===== 渲染进程崩溃/加载失败监听 =====
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      const url = validatedURL || 'unknown';
      writeCrashLog('MAIN_FAIL_LOAD', new Error(`Code=${errorCode} ${errorDescription} URL=${url}`));
      console.error(`[MainWindow] did-fail-load: code=${errorCode} desc=${errorDescription} url=${url}`);
    });

    // 渲染进程 console 转发到 crash.log（用于诊断"白屏只剩背景"问题）
    // 这能抓到 <script type="module"> 加载失败、JS 运行时错误等 did-fail-load 抓不到的问题
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const levelName = ['LOG', 'WARN', 'ERROR'][level] || `LVL${level}`;
      const src = sourceId ? sourceId.replace(/^file:\/\/\/[A-Za-z]:/, '') : '';
      const lineInfo = line > 0 ? `:${line}` : '';
      try {
        fs.appendFileSync(
          CRASH_LOG_FILE,
          `[${new Date().toISOString()}] [RENDERER_CONSOLE:${levelName}] ${message}${src ? ` (${src}${lineInfo})` : ''}\n`,
          'utf-8'
        );
      } catch {}
      // ERROR 级别同时输出到 stdout 方便调试
      if (level === 2) console.error(`[Renderer] ${message} (${src}${lineInfo})`);
    });

    // 捕获渲染进程未处理的异步错误
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      writeCrashLog('RENDER_PROCESS_GONE_MAIN_WINDOW', new Error(`reason=${details.reason} exitCode=${details.exitCode}`));
    });

    mainWindow.webContents.on('crashed', (event, killed) => {
      writeCrashLog('RENDERER_CRASHED', new Error(`killed=${killed}`));
      console.error('[MainWindow] Renderer process crashed! killed=', killed);
    });

    mainWindow.webContents.on('unresponsive', () => {
      writeCrashLog('RENDERER_UNRESPONSIVE', new Error('WebContents unresponsive'));
      console.warn('[MainWindow] Renderer process unresponsive');
    });

    mainWindow.webContents.on('responsive', () => {
      writeStartupLog('RENDERER_RESPONSIVE', 'recovered');
    });

    mainWindow.once('ready-to-show', () => {
      writeStartupLog('MAIN_WINDOW_READY', 'closing splash');
      // 关闭启动画面
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }

      mainWindow.show();

      // 生产环境下启动后 3 秒静默检查更新
      if (app.isPackaged) {
        setTimeout(() => {
          try { updater.checkForUpdates(true); } catch {}
        }, 3000);
      }
    });

    if (process.env.NODE_ENV === 'development') {
      const devUrl = 'http://localhost:5173';
      writeStartupLog('MAIN_LOAD_URL', devUrl);
      mainWindow.loadURL(devUrl).catch((err) => {
        writeCrashLog('MAIN_LOAD_URL_FAIL', err);
        console.error('[MainWindow] loadURL failed:', err.message);
      });
      mainWindow.webContents.openDevTools();
      // 开发环境直接关闭 splash
      if (splashWindow && !splashWindow.isDestroyed()) {
        setTimeout(() => {
          if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        }, 800);
      }
    } else {
      const distPath = path.join(__dirname, 'dist', 'index.html');
      writeStartupLog('MAIN_LOAD_FILE', distPath);
      if (!fs.existsSync(distPath)) {
        writeCrashLog('DIST_MISSING', new Error(`File not found: ${distPath}`));
        console.error('[MainWindow] dist/index.html not found — 请先执行 npm run build');
      }
      mainWindow.loadFile(distPath).catch((err) => {
        writeCrashLog('MAIN_LOAD_FILE_FAIL', err);
        console.error('[MainWindow] loadFile failed:', err.message);
      });
    }

  // ===== 关闭处理：弹窗让用户选择，不强制超时 =====
  mainWindow.on('close', (event) => {
    if (isQuiting) return;

    // 双击关闭按钮 → 立即强制退出
    const now = Date.now();
    if (now - lastCloseClickTime < DOUBLE_CLICK_MS) {
      isQuiting = true;
      app.quit();
      return;
    }
    lastCloseClickTime = now;

    event.preventDefault();

    // 检查渲染进程是否已崩溃/销毁 → 直接退出
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed() || mainWindow.webContents.isCrashed()) {
      isQuiting = true;
      app.quit();
      return;
    }

    // 发送关闭请求到渲染进程（断网时 IPC 不受影响，弹窗照常出现）
    try {
      mainWindow.webContents.send('window:close-request');
    } catch (e) {
      console.error('[Close] 发送关闭请求失败:', e.message);
      isQuiting = true;
      app.quit();
    }
    // 等待用户选择（不再自动超时退出）
  });

  mainWindow.on('closed', () => {
    clearTimeout(closeTimeout);
    closeTimeout = null;
    mainWindow = null;
    updater.stopPeriodicCheck();
  });

  // 注册 updater 窗口引用
  updater.setMainWindow(mainWindow);
  } catch (err) {
    writeCrashLog('CREATE_WINDOW_FAIL', err);
    console.error('[MainWindow] createWindow failed:', err.message);
  }
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'tubiao.ico');
    if (!fs.existsSync(iconPath)) {
      writeCrashLog('TRAY_ICON_MISSING', new Error(`Icon not found: ${iconPath}`));
      console.warn('[Tray] tubiao.ico not found, skipping tray creation');
      return;
    }
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
    writeStartupLog('TRAY_CREATED', 'ok');
  } catch (err) {
    writeCrashLog('TRAY_CREATE_FAIL', err);
    console.error('[Tray] createTray failed:', err.message);
  }
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

// ===== 渲染进程崩溃全局监听 =====
app.on('render-process-gone', (_event, webContents, details) => {
  const reason = details.reason;
  const exitCode = details.exitCode;
  writeCrashLog('RENDER_PROCESS_GONE', new Error(`reason=${reason} exitCode=${exitCode}`));
  console.error(`[App] Render process gone: reason=${reason} exitCode=${exitCode}`);
});

// ===== App 生命周期 =====
app.whenReady().then(() => {
  writeStartupLog('APP_READY', 'begin');
  // 先显示启动画面
  createSplashWindow();

  // 微延迟后再创建主窗口（让启动画面先渲染）
  setImmediate(() => {
    try {
      writeStartupLog('SET_IMMEDIATE', 'begin');
      createWindow();

      // 注册 IPC 处理器
      ipcMain.handle('update:check', async () => { await updater.checkForUpdates(); });
      ipcMain.handle('update:download', async () => { await updater.downloadUpdate(); });
      ipcMain.handle('update:install', () => { updater.installAndRestart(); });
      ipcMain.handle('app:version', () => app.getVersion());
      // 在线更新诊断
      ipcMain.handle('update:diagnose', async () => {
        try {
          const diag = await updater.runDiagnostic();
          // 统一返回格式供前端使用
          return { success: true, results: diag.checks, summary: diag.summary, suggestion: diag.suggestion };
        } catch (e) {
          return { success: false, error: e.message };
        }
      });
      // 手动清理更新缓存（安全回滚）
      ipcMain.handle('update:cleanup-cache', async () => {
        try {
          const cacheDir = path.join(app.getPath('userData'), 'pending');
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

      // 保存主题到文件（供 splash 窗口启动时读取）
      ipcMain.handle('theme:save', (_event, data) => {
        try {
          fs.writeFileSync(THEME_FILE, JSON.stringify(data), 'utf-8');
          return { success: true };
        } catch (e) {
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

      writeStartupLog('SET_IMMEDIATE', 'done');
    } catch (err) {
      writeCrashLog('APP_INIT_FAIL', err);
      console.error('[FATAL] App initialization failed:', err.message);
    }
  });
}).catch((err) => {
  writeCrashLog('APP_WHEN_READY_FAIL', err);
  console.error('[FATAL] app.whenReady failed:', err.message);
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
