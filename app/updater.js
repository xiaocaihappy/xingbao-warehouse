const { autoUpdater } = require('electron-updater');
const { app, dialog } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 弹性下载器：断点续传 + 多镜像源 + 指数退避 + SHA256 校验
const {
  downloadWithFailover,
  fetchUpdateManifest,
  verifyManifest,
  sha256File,
  fetchBuffer,
} = require('./resilientDownloader');

// 显式设置更新源（GitHub Releases），防止 electron-updater 无法自动解析 app-update.yml
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'xiaocaihappy',
  repo: 'xingbao-warehouse',
  vPrefixedTagName: true,
  releaseType: 'release',
});

// 配置 autoUpdater
autoUpdater.autoDownload = false;          // 手动控制下载时机（使用弹性下载器）
autoUpdater.autoInstallOnAppQuit = true;   // 退出时自动安装
autoUpdater.allowDowngrade = false;
autoUpdater.disableWebInstaller = true;    // NSIS 不使用 web installer
// 关键：禁用差分下载。差分下载在弱网/中断场景下会生成不完整的 app.asar
autoUpdater.disableDifferentialDownload = true;
autoUpdater.requestHeaders = { 'User-Agent': 'xingbao-warehouse-updater/1.0' };

// ========== 更新清单配置 ==========
// 通过 GitHub API 获取最新 Release 的 update.json（兼容加速代理）
// ① ghproxy 加速的 GitHub API
// ② GitHub 官方 API（兜底）
const MANIFEST_API_URLS = [
  'https://ghproxy.com/https://api.github.com/repos/xiaocaihappy/xingbao-warehouse/releases/latest',
  'https://api.github.com/repos/xiaocaihappy/xingbao-warehouse/releases/latest',
];

// 下载完成 → 安装前的 asar 完整性校验
const EXPECTED_MIN_ASAR_SIZE = 80 * 1024 * 1024;
const _origQuitAndInstall = autoUpdater.quitAndInstall.bind(autoUpdater);
autoUpdater.quitAndInstall = function (...args) {
  try {
    const pendingDir = path.join(app.getPath('userData'), 'pending');
    if (fs.existsSync(pendingDir)) {
      const files = fs.readdirSync(pendingDir);
      for (const f of files) {
        if (f.endsWith('.asar') || f.endsWith('.asar.gz') || f.endsWith('.asar.bz2')) {
          const full = path.join(pendingDir, f);
          const stat = fs.statSync(full);
          console.log(`[Updater] 预安装 asar 校验: ${f} = ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
          if (stat.size < EXPECTED_MIN_ASAR_SIZE) {
            const err = `更新包文件不完整 (${(stat.size / 1024 / 1024).toFixed(1)}MB < 80MB)，已拒绝安装以保护原版本。`;
            console.error('[Updater]', err);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('update:status', { event: 'error', message: err });
            }
            try { fs.unlinkSync(full); } catch {}
            return false;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Updater] asar 预校验异常（不阻止安装）:', e.message);
  }
  return _origQuitAndInstall(...args);
};

// 日志
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
let pendingUpdate = null;       // 缓存检查到的更新信息（来自 update.json）
let pendingManifest = null;     // 缓存完整的更新清单
let _isSilent = false;
let _downloadCancelled = false;

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

function setMainWindow(win) {
  mainWindow = win;
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status);
  }
}

// ========== 更新清单检查（update.json） ==========

/**
 * 从 GitHub API 获取最新 Release，再从 Release assets 中找 update.json
 * 支持加速代理故障转移
 */
async function fetchManifestWithFailover() {
  let lastError = null;

  for (const apiUrl of MANIFEST_API_URLS) {
    try {
      console.log(`[Updater] 查询最新 Release: ${apiUrl}`);

      // 1. 调用 GitHub API 获取最新 Release 信息
      const releaseBuffer = await fetchBuffer(apiUrl, { timeout: 15_000 });
      const release = JSON.parse(releaseBuffer.toString('utf-8'));

      if (release.message) {
        throw new Error(`GitHub API: ${release.message}`);
      }

      console.log(`[Updater] 最新 Release: ${release.tag_name} (${release.assets?.length || 0} assets)`);

      // 2. 从 assets 中找 update.json
      const manifestAsset = release.assets?.find((a) => a.name === 'update.json');
      if (!manifestAsset) {
        throw new Error('最新 Release 中没有 update.json 文件');
      }

      // 3. 下载 update.json 内容（也走加速代理）
      let manifestUrl = manifestAsset.browser_download_url;
      // 如果 API 走了 ghproxy，下载也走 ghproxy
      if (apiUrl.includes('ghproxy.com') && !manifestUrl.includes('ghproxy.com')) {
        manifestUrl = `https://ghproxy.com/${manifestUrl}`;
      }

      console.log(`[Updater] 下载清单: ${manifestUrl}`);
      const manifestBuffer = await fetchBuffer(manifestUrl, { timeout: 15_000 });
      const manifest = JSON.parse(manifestBuffer.toString('utf-8'));

      // 4. 补全镜像源：如果 update.json 中的镜像 URL 没有经过加速，且我们正在用加速代理，补上
      if (apiUrl.includes('ghproxy.com') && manifest.mirrors) {
        manifest.mirrors = manifest.mirrors.map((url) => {
          // 已经是加速地址的不重复加
          if (url.includes('ghproxy.com') || url.includes('gh-proxy.com')) return url;
          return url; // 保持原样，清单里已经配好了加速地址
        });
      }

      // 5. 校验清单完整性
      const verification = await verifyManifest(manifest, manifestUrl);
      if (!verification.valid) {
        throw new Error(`清单校验失败: ${verification.reason}`);
      }

      console.log(`[Updater] 清单校验通过: v${manifest.version}`);
      return manifest;
    } catch (err) {
      lastError = err;
      console.warn(`[Updater] 清单源 ${apiUrl} 失败: ${err.message}`);
    }
  }

  throw new Error(`无法获取更新清单: ${lastError?.message || '所有源均失败'}`);
}

/**
 * 比较版本号
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

// ========== 网络诊断工具 ==========

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
    }).on('error', (e) => reject(new Error(e.message)));
  }));

  await runCheck('ghproxy 加速可达性', () => new Promise((resolve, reject) => {
    const req = https.get('https://ghproxy.com', { timeout: 8000 }, (res) => {
      resolve(`HTTP ${res.statusCode}`);
      req.destroy();
    });
    req.on('error', (e) => reject(new Error(e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('连接超时 (8秒)')); });
  }));

  await runCheck('update.json 清单可达性', async () => {
    try {
      const manifest = await fetchManifestWithFailover();
      return `版本: v${manifest.version}, SHA256: ${manifest.sha256?.substring(0, 16)}..., 镜像源: ${manifest.mirrors?.length || 0}个`;
    } catch (e) {
      throw new Error(e.message);
    }
  });

  await runCheck('当前版本信息', () => {
    return `版本=${app.getVersion()}, 打包状态=${app.isPackaged}, 平台=${process.platform}`;
  });

  const failures = results.checks.filter(c => c.status === 'fail');
  const passCount = results.checks.filter(c => c.status === 'ok').length;

  if (failures.length === 0) {
    results.summary = '✅ 所有检查通过，如果仍无法更新，请尝试清理缓存后重试';
    results.suggestion = 'cache';
  } else {
    const failedNames = failures.map(c => c.name).join(', ');
    results.summary = `⚠️ ${failures.length}/${results.checks.length} 项检查失败: ${failedNames}`;
    for (const f of failures) {
      if (f.name.includes('API') && f.detail.includes('超时')) {
        results.suggestion = 'network-timeout';
        break;
      } else if (f.name.includes('ghproxy') && f.detail.includes('超时')) {
        results.suggestion = 'mirror-timeout';
        break;
      } else if (f.name.includes('清单')) {
        results.suggestion = 'manifest-fail';
        break;
      } else {
        results.suggestion = 'unknown';
      }
    }
  }

  return results;
}

// ========== 事件监听（保留 electron-updater 事件，但下载改用弹性下载器） ==========

autoUpdater.on('checking-for-update', () => {
  if (_isSilent) return;
  sendStatus({ event: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  pendingUpdate = info;
  sendStatus({ event: 'available', version: info.version, releaseNotes: info.releaseNotes });
});

autoUpdater.on('update-not-available', () => {
  pendingUpdate = null;
  if (_isSilent) {
    sendStatus({ event: 'idle' });
    return;
  }
  sendStatus({ event: 'no-update' });
});

autoUpdater.on('error', (err) => {
  const message = err?.message || String(err);
  console.error('[Updater] autoUpdater error:', message, err?.stack || '');

  if (message.includes('dev-app-update.yml') || message.includes('ERR_INVALID_ARG_TYPE')) {
    sendStatus({ event: 'idle', devMode: true });
    return;
  }

  if (_isSilent) {
    sendStatus({ event: 'idle' });
    return;
  }

  let friendlyMessage = message;
  if (message.includes('net::') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    friendlyMessage = '无法连接到 GitHub 服务器，请检查网络连接或代理设置';
  } else if (message.includes('404') || message.includes('Not Found')) {
    friendlyMessage = 'Release 资源未找到，请联系管理员确认发布包是否完整';
  } else if (message.includes('403') || message.includes('rate limit')) {
    friendlyMessage = 'GitHub API 请求频率超限，请稍后再试';
  } else if (message.includes('socket hang up') || message.includes('timed out')) {
    friendlyMessage = '网络请求超时，请稍后重试或检查代理';
  }

  sendStatus({ event: 'error', message: friendlyMessage });
});

// ========== 操作函数 ==========

/**
 * 检查更新（优先使用 update.json 清单，回退到 electron-updater）
 */
async function checkForUpdates(silent = false) {
  console.log(`[Updater] 检查更新 (silent=${silent}, isPackaged=${app.isPackaged}, currentVersion=${app.getVersion()})`);
  if (!app.isPackaged && !silent) {
    sendStatus({ event: 'idle', devMode: true });
    return;
  }
  _isSilent = silent;
  try {
    sendStatus({ event: silent ? 'idle' : 'checking' });

    // 优先使用 update.json 清单检查（支持镜像源 + SHA256）
    try {
      const manifest = await fetchManifestWithFailover();
      const currentVersion = app.getVersion();
      const hasUpdate = compareVersions(manifest.version, currentVersion) > 0;

      if (hasUpdate) {
        pendingManifest = manifest;
        pendingUpdate = {
          version: manifest.version,
          releaseNotes: manifest.releaseNotes || '',
        };
        console.log(`[Updater] 发现新版本: v${manifest.version} (当前 v${currentVersion})`);
        sendStatus({
          event: 'available',
          version: manifest.version,
          releaseNotes: manifest.releaseNotes || '',
        });
        return;
      } else {
        pendingManifest = null;
        pendingUpdate = null;
        console.log(`[Updater] 已是最新版本: v${currentVersion}`);
        if (!silent) sendStatus({ event: 'no-update' });
        else sendStatus({ event: 'idle' });
        return;
      }
    } catch (manifestErr) {
      console.warn(`[Updater] update.json 清单检查失败，回退到 electron-updater: ${manifestErr.message}`);
      // 清单失败，回退到 electron-updater 原生检查
    }

    // 回退：使用 electron-updater 检查
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

/**
 * 下载更新（优先使用弹性下载器，支持断点续传 + 多镜像源）
 */
async function downloadUpdate() {
  _downloadCancelled = false;

  // 优先使用弹性下载器（如果有 update.json 清单）
  if (pendingManifest) {
    try {
      await downloadWithResilientDownloader(pendingManifest);
      return;
    } catch (err) {
      console.error('[Updater] 弹性下载器失败，回退到 electron-updater:', err.message);
      sendStatus({ event: 'error', message: err.message });
      // 不回退到 electron-updater，因为它的下载在国内更不可靠
      return;
    }
  }

  // 回退：使用 electron-updater 下载
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    sendStatus({ event: 'error', message: err?.message || '下载失败' });
  }
}

/**
 * 使用弹性下载器下载安装包
 */
async function downloadWithResilientDownloader(manifest) {
  const { mirrors, sha256, size, fileName } = manifest;

  if (!mirrors || mirrors.length === 0) {
    throw new Error('更新清单中没有镜像源地址');
  }

  // 下载到临时文件
  const downloadDir = path.join(app.getPath('userData'), 'downloads');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  const destPath = path.join(downloadDir, fileName || `setup-${manifest.version}.exe`);

  // 如果存在旧的损坏文件（不同版本），先清理
  if (fs.existsSync(destPath)) {
    const existingSize = fs.statSync(destPath).size;
    if (size && existingSize > size + 1024) {
      // 文件比预期大很多，可能是旧版本残留
      try { fs.unlinkSync(destPath); } catch {}
    }
  }

  console.log(`[Updater] 开始弹性下载: ${fileName || 'setup'}`);
  console.log(`[Updater] 预期大小: ${size} bytes, SHA256: ${sha256?.substring(0, 16)}...`);
  console.log(`[Updater] 镜像源: ${mirrors.length} 个`);

  let lastDownloaded = 0;
  let lastTime = Date.now();

  const result = await downloadWithFailover(mirrors, destPath, {
    expectedSize: size,
    expectedSha256: sha256,
    onProgress: (downloaded, total) => {
      if (_downloadCancelled) return;

      // 计算下载速度
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      let speed = 0;
      if (elapsed > 0.5) { // 每 0.5 秒更新一次速度
        speed = (downloaded - lastDownloaded) / elapsed;
        lastDownloaded = downloaded;
        lastTime = now;
      }

      const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      sendStatus({
        event: 'progress',
        percent,
        transferred: downloaded,
        total: total || size,
        bytesPerSecond: speed,
      });
    },
    onRetry: (attempt, error, backoffMs) => {
      sendStatus({
        event: 'progress',
        retry: attempt,
        message: `网络异常，${backoffMs / 1000}秒后重试 (${attempt}/3)`,
      });
    },
    onMirrorSwitch: (fromUrl, toUrl, error) => {
      const fromName = new URL(fromUrl).hostname;
      const toName = new URL(toUrl).hostname;
      sendStatus({
        event: 'progress',
        message: `${fromName} 不可用，切换到 ${toName}`,
      });
    },
  });

  console.log(`[Updater] 下载完成! 来源: ${result.mirrorUsed}, SHA256 校验通过`);

  // 将下载好的 exe 移动到 electron-updater 的 pending 目录
  // electron-updater 会在 quitAndInstall 时使用这个目录的文件
  const pendingDir = path.join(app.getPath('userData'), 'pending');
  if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true });
  }

  // 将安装包放到 pending 目录，electron-updater 会处理安装
  // 对于 NSIS 安装包，我们需要直接运行它而不是走 asar 替换
  // 所以我们直接标记为已下载，然后运行安装程序
  pendingUpdate = pendingUpdate || {};
  pendingUpdate.downloadedPath = destPath;

  sendStatus({
    event: 'downloaded',
    version: manifest.version,
    message: '下载完成，点击安装更新',
  });
}

/**
 * 安装更新并重启
 * 如果是弹性下载器下载的安装包，直接运行安装程序；
 * 否则使用 electron-updater 的 quitAndInstall
 */
function installAndRestart() {
  if (pendingUpdate?.downloadedPath) {
    // 弹性下载器下载的安装包，直接运行
    const installerPath = pendingUpdate.downloadedPath;
    console.log(`[Updater] 运行安装程序: ${installerPath}`);

    if (!fs.existsSync(installerPath)) {
      sendStatus({ event: 'error', message: '安装包文件不存在，请重新下载' });
      return;
    }

    // 使用 child_process 运行 NSIS 安装程序（静默安装 + 自动重启）
    const { spawn } = require('child_process');
    const child = spawn(installerPath, ['/S', '--updated'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // 退出当前应用，让安装程序接管
    app.quit();
    return;
  }

  // 回退：使用 electron-updater 安装
  autoUpdater.quitAndInstall(false, true);
}

/**
 * 用户确认后更新
 */
async function confirmUpdate() {
  if (!pendingUpdate) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '发现新版本',
    message: `新版本 v${pendingUpdate.version} 已可用`,
    detail: '是否立即下载并安装更新？\n下载支持断点续传和多镜像源加速。\n安装完成后应用将自动重启。',
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
