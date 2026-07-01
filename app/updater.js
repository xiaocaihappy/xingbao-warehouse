const { autoUpdater } = require('electron-updater');
const { app, dialog } = require('electron');
const https = require('https');

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
autoUpdater.autoInstallOnAppQuit = true;   // 退出时自动安装
autoUpdater.allowDowngrade = false;
autoUpdater.disableWebInstaller = true;    // NSIS 不使用 web installer
// 增加请求超时时间（国内网络可能较慢）
autoUpdater.requestHeaders = { 'User-Agent': 'xingbao-warehouse-updater/1.0' };

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

// ========== 网络诊断工具 ==========

/**
 * 诊断网络连接问题，返回详细报告
 */
async function runDiagnostic() {
  const results = { checks: [], summary: '', suggestion: '' };

  const runCheck = async (name, fn) => {
    try {
      const result = await fn();
      results.checks.push({ name, status: 'ok', detail: result });
      return result;
    } catch (err) {
      results.checks.push({ name, status: 'fail', detail: err.message });
      return null;
    }
  };

  await runCheck('GitHub API 可达性', () => new Promise((resolve, reject) => {
    const req = https.get('https://api.github.com', { timeout: 8000 }, (res) => {
      resolve(`HTTP ${res.statusCode}, X-RateLimit-Remaining: ${res.headers['x-ratelimit-remaining'] || 'N/A'}`);
      req.destroy();
    });
    req.on('error', (e) => reject(new Error(e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('连接超时 (8秒)')); });
  }));

  await runCheck('Release 列表可读', () => new Promise((resolve, reject) => {
    const url = 'https://api.github.com/repos/xiaocaihappy/xingbao-warehouse/releases?per_page=2';
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (Array.isArray(json)) {
            resolve(`${json.length} 个 Release, 最新: ${json[0]?.tag_name || 'N/A'}, assets: ${json[0]?.assets?.length || 0}个`);
          } else {
            resolve(`响应异常: ${data.substring(0, 100)}`);
          }
        } catch (e) { resolve(`解析失败: ${data.substring(0, 80)}`); }
      });
    }).on('error', (e) => reject(new Error(e.message)))
     .on('timeout', () => { /* handled */ });
  }));

  await runCheck('v1.1.17 Release 详情', () => new Promise((resolve, reject) => {
    const url = 'https://api.github.com/repos/xiaocaihappy/xingbao-warehouse/releases/tags/v1.1.17';
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.message) { reject(new Error(r.message)); return; }
          const assets = r.assets || [];
          const names = assets.map(a => a.name);
          const hasYml = names.includes('latest.yml');
          const hasExe = names.some(n => n.endsWith('.exe'));
          resolve(
            `Draft:${r.draft} | Assets:${names.join(', ') || '(无)'}` +
            `\n  latest.yml: ${hasYml ? '✅ 有' : '❌ 缺失! (这是导致更新失败的主因!)'}` +
            `\n  安装包: ${hasExe ? '✅ 有' : '❌ 缺失'}`
          );
        } catch (e) { reject(new Error(String(e))); }
      });
    }).on('error', (e) => reject(new Error(e.message)));
  }));

  await runCheck('当前版本信息', () => {
    return `版本=${app.getVersion()}, 打包状态=${app.isPackaged}, 平台=${process.platform}`;
  });

  // 生成总结和建议
  const failures = results.checks.filter(c => c.status === 'fail');
  const passCount = results.checks.filter(c => c.status === 'ok').length;

  if (failures.length === 0) {
    results.summary = '✅ 所有检查通过，如果仍无法更新，请尝试清理缓存后重试';
    results.suggestion = 'cache';
  } else {
    const failedNames = failures.map(c => c.name).join(', ');
    results.summary = `⚠️ ${failures.length}/${results.checks.length} 项检查失败: ${failedNames}`;

    // 根据具体错误给出建议
    for (const f of failures) {
      if (f.name.includes('API') && f.detail.includes('超时')) {
        results.suggestion = 'network-timeout';
        break;
      } else if (f.name.includes('v1.1.17') && f.detail.includes('latest.yml')) {
        results.suggestion = 'missing-yml';
        break;
      } else if (f.name.includes('API') && f.detail.includes('ECONNREFUSED')) {
        results.suggestion = 'network-blocked';
        break;
      } else {
        results.suggestion = 'unknown';
      }
    }
  }

  return results;
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

  // 友好的错误消息映射
  let friendlyMessage = message;
  if (message.includes('net::') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    friendlyMessage = '无法连接到 GitHub 服务器，请检查网络连接或代理设置';
  } else if (message.includes('404') || message.includes('Not Found')) {
    friendlyMessage = 'Release 资源未找到，请联系管理员确认发布包是否完整（缺少 latest.yml）';
  } else if (message.includes('403') || message.includes('rate limit')) {
    friendlyMessage = 'GitHub API 请求频率超限，请稍后再试';
  } else if (message.includes('socket hang up') || message.includes('timed out')) {
    friendlyMessage = '网络请求超时（可能是 GitHub 访问较慢），请稍后重试或检查代理';
  } else if (message.includes('ERR_TLS')) {
    friendlyMessage = 'SSL/TLS 连接失败，可能是网络环境问题';
  }

  sendStatus({ event: 'error', message: friendlyMessage });
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
  runDiagnostic,
};
