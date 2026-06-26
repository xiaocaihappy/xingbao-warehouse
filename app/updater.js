const { autoUpdater } = require('electron-updater');
const { app, dialog } = require('electron');

// 显式设置更新源（GitHub Releases），防止 electron-updater 无法自动解析 app-update.yml
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'xiaocaihappy',
  repo: 'xingbao-warehouse',
  vPrefixedTagName: true,
  releaseType: 'release',
});

// 配置 autoUpdater
autoUpdater.autoDownload = false;          // 手动控制下载时机
autoUpdater.autoInstallOnAppQuit = true;  // 退出时自动安装
autoUpdater.allowDowngrade = false;
autoUpdater.disableWebInstaller = true;    // NSIS 不使用 web installer

// 添加日志（方便排查问题）
autoUpdater.logger = {
  info: (...args) => console.log('[Updater]', ...args),
  warn: (...args) => console.warn('[Updater]', ...args),
  error: (...args) => console.error('[Updater]', ...args),
  debug: (...args) => console.log('[Updater:debug]', ...args),
  verbose: (...args) => console.log('[Updater:verbose]', ...args),
  silly: (...args) => console.log('[Updater:silly]', ...args),
};

let mainWindow = null;
let updateCheckTimer = null;
let pendingUpdate = null;  // 缓存检查到的更新信息
let _isSilent = false;     // 静默模式：后台自动检查，失败不提示

// 检查间隔：24小时
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

function setMainWindow(win) {
  mainWindow = win;
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status);
  }
}

// ========== 事件监听 ==========

// 检查更新中
autoUpdater.on('checking-for-update', () => {
  if (_isSilent) return;
  sendStatus({ event: 'checking' });
});

// 发现新版本
autoUpdater.on('update-available', (info) => {
  pendingUpdate = info;
  sendStatus({ event: 'available', version: info.version, releaseNotes: info.releaseNotes });
});

// 已是最新版本
autoUpdater.on('update-not-available', () => {
  pendingUpdate = null;
  if (_isSilent) {
    sendStatus({ event: 'idle' });
    return;
  }
  sendStatus({ event: 'no-update' });
});

// 下载进度
autoUpdater.on('download-progress', (progress) => {
  sendStatus({
    event: 'progress',
    percent: Math.round(progress.percent),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
  });
});

// 下载完成
autoUpdater.on('update-downloaded', (info) => {
  pendingUpdate = info;
  sendStatus({ event: 'downloaded', version: info.version });
});

// 发生错误
autoUpdater.on('error', (err) => {
  const message = err?.message || String(err);
  console.error('[Updater] autoUpdater error:', message, err?.stack || '');

  // 开发环境下忽略
  if (message.includes('dev-app-update.yml') || message.includes('ERR_INVALID_ARG_TYPE')) {
    sendStatus({ event: 'idle', devMode: true });
    return;
  }

  // 静默检查模式下，所有网络/服务器错误都不提示用户
  if (_isSilent) {
    sendStatus({ event: 'idle' });
    return;
  }

  sendStatus({ event: 'error', message });
});

// ========== 操作函数 ==========

// 启动后台静默检查
async function checkForUpdates(silent = false) {
  console.log(`[Updater] 检查更新 (silent=${silent}, isPackaged=${app.isPackaged}, currentVersion=${app.getVersion()})`);
  if (!app.isPackaged && !silent) {
    sendStatus({ event: 'idle', devMode: true });
    return;
  }
  _isSilent = silent;
  try {
    sendStatus({ event: silent ? 'idle' : 'checking' });
    const result = await autoUpdater.checkForUpdates();
    console.log('[Updater] checkForUpdates 完成:', JSON.stringify(result?.updateInfo?.version || 'no update info'));
  } catch (err) {
    console.error('[Updater] checkForUpdates 异常:', err?.message || err);
    if (!silent) {
      sendStatus({ event: 'error', message: err?.message || '检查失败' });
    } else {
      sendStatus({ event: 'idle' });
    }
  } finally {
    _isSilent = false;
  }
}

// 开始下载
async function downloadUpdate() {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    sendStatus({ event: 'error', message: err?.message || '下载失败' });
  }
}

// 安装更新并重启
function installAndRestart() {
  autoUpdater.quitAndInstall(false, true);
}

// 用户确认后更新
async function confirmUpdate() {
  if (!pendingUpdate) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '发现新版本',
    message: `新版本 v${pendingUpdate.version} 已可用`,
    detail: '是否立即下载并安装更新？\n安装完成后应用将自动重启。',
    buttons: ['立即更新', '稍后提醒'],
    defaultId: 0,
  });
  if (result.response === 0) {
    await downloadUpdate();
  }
}

// 定时检查
function startPeriodicCheck() {
  stopPeriodicCheck();
  updateCheckTimer = setInterval(() => checkForUpdates(true), CHECK_INTERVAL);
}

function stopPeriodicCheck() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

module.exports = {
  setMainWindow,
  checkForUpdates,
  downloadUpdate,
  installAndRestart,
  confirmUpdate,
  startPeriodicCheck,
  stopPeriodicCheck,
  getPendingUpdate: () => pendingUpdate,
};

