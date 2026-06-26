const { autoUpdater } = require('electron-updater');
const { app, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');

// ===== 常量 =====
const TOKEN_FILENAME = 'token.txt';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const NETWORK_TIMEOUT = 18000;
const SILENT_TIMEOUT = 8000;
const RETRY_MAX = 3;
const RETRY_BASE_MS = 2000;
const MANUAL_YMLL_TIMEOUT = 20000;
const GITHUB_API_LATEST = 'https://api.github.com/repos/xiaocaihappy/xingbao-warehouse/releases/latest';
const GITHUB_YML_LATEST = 'https://github.com/xiaocaihappy/xingbao-warehouse/releases/latest/download/latest.yml';

// ===== Token 查找（多路径兜底） =====
let ghToken = '';

function findTokenFile() {
  const candidates = [];
  // 1. 开发环境：项目根目录
  candidates.push(path.join(__dirname, '..', TOKEN_FILENAME));
  // 2. 生产环境：exe 同目录
  try { candidates.push(path.join(path.dirname(app.getPath('exe')), TOKEN_FILENAME)); } catch {}
  // 3. 生产环境：resources 目录（ASAR 外部）
  try { candidates.push(path.join(process.resourcesPath || '', TOKEN_FILENAME)); } catch {}
  // 4. 用户数据目录
  try { candidates.push(path.join(app.getPath('userData'), TOKEN_FILENAME)); } catch {}

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8').trim();
        if (content && content.length > 10) {
          console.log(`[Updater] 在 ${p} 找到 GitHub Token`);
          return content;
        }
      }
    } catch {}
  }
  return '';
}

try {
  ghToken = findTokenFile();
  if (!ghToken) {
    console.log('[Updater] 未找到 token.txt，将使用未认证 API（60次/小时限速）');
  }
} catch (e) {
  console.log('[Updater] 读取 token.txt 异常:', e.message);
}

// ===== 更新源配置 =====
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'xiaocaihappy',
  repo: 'xingbao-warehouse',
  vPrefixedTagName: true,
  releaseType: 'release',
  token: ghToken || undefined,
});

// ===== autoUpdater 全局配置 =====
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;
autoUpdater.disableWebInstaller = true;

// ===== 日志系统 =====
autoUpdater.logger = {
  info: (...args) => console.log('[Updater]', ...args),
  warn: (...args) => console.warn('[Updater]', ...args),
  error: (...args) => console.error('[Updater]', ...args),
  debug: (...args) => console.log('[Updater:debug]', ...args),
  verbose: (...args) => console.log('[Updater:verbose]', ...args),
  silly: (...args) => console.log('[Updater:silly]', ...args),
};

// ===== 状态变量 =====
let mainWindow = null;
let updateCheckTimer = null;
let pendingUpdate = null;
let _isSilent = false;
let _retryCount = 0;          // 当前重试次数
let _checkInProgress = false;  // 是否正在检查

function setMainWindow(win) {
  mainWindow = win;
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('update:status', status);
    } catch {}
  }
}

function pushDiagnosticLog(level, step, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('update:diagnostic-log', {
        timestamp: new Date().toISOString(),
        level,
        step,
        detail,
      });
    } catch {}
  }
  const prefix = level === 'error' ? '[Diag ERROR]' : level === 'warn' ? '[Diag WARN]' : '[Diag]';
  console.log(`${prefix} ${step}:`, detail);
}

// ===== 辅助：延迟 =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== 解析 latest.yml 内容 =====
function parseLatestYml(content) {
  try {
    const verMatch = content.match(/version:\s*(\S+)/);
    const shaMatch = content.match(/sha512:\s*(\S+)/);
    const sizeMatch = content.match(/size:\s*(\d+)/);
    const urlMatch = content.match(/url:\s*(\S+)/);
    return {
      version: verMatch ? verMatch[1] : null,
      sha512: shaMatch ? shaMatch[1] : null,
      size: sizeMatch ? parseInt(sizeMatch[1]) : null,
      url: urlMatch ? urlMatch[1] : null,
      raw: content,
    };
  } catch {
    return null;
  }
}

// ===== 手动下载 latest.yml（绕过 electron-updater） =====
async function fetchLatestYmlManually(versionTag) {
  // 构建备用 URL 列表（优先级递减）
  const urls = [];
  // 1. 最新 release 的 latest.yml（GitHub CDN 直链）
  urls.push(GITHUB_YML_LATEST);
  // 2. 如果知道具体版本号，尝试版本直链
  if (versionTag) {
    urls.push(`https://github.com/xiaocaihappy/xingbao-warehouse/releases/download/${versionTag}/latest.yml`);
  }

  for (const url of urls) {
    console.log(`[Updater] 手动下载 latest.yml: ${url}`);
    try {
      const result = await new Promise((resolve) => {
        const req = net.request({ url, method: 'GET' });
        let body = '';
        const timer = setTimeout(() => {
          req.abort();
          resolve({ ok: false, error: `timeout (${MANUAL_YMLL_TIMEOUT / 1000}s)` });
        }, MANUAL_YMLL_TIMEOUT);

        req.on('response', (res) => {
          clearTimeout(timer);
          if (res.statusCode >= 300 && res.statusCode < 400) {
            // 跟随重定向
            const redirectUrl = res.headers['location'];
            if (redirectUrl) {
              resolve({ ok: false, redirect: redirectUrl });
              return;
            }
          }
          res.on('data', (chunk) => { body += chunk.toString(); });
          res.on('end', () => {
            if (res.statusCode === 200 && body.includes('version:') && body.includes('sha512:')) {
              resolve({ ok: true, statusCode: 200, data: body });
            } else {
              resolve({ ok: false, statusCode: res.statusCode, body: body.substring(0, 200) });
            }
          });
        });
        req.on('error', (err) => {
          clearTimeout(timer);
          resolve({ ok: false, error: err.message });
        });
        req.end();
      });

      if (result.ok) {
        console.log('[Updater] latest.yml 手动获取成功');
        return result;
      }
      // 如果是重定向，跟进
      if (result.redirect) {
        console.log(`[Updater] 跟随重定向: ${result.redirect}`);
        try {
          const redirectResult = await new Promise((resolve) => {
            const req = net.request({ url: result.redirect, method: 'GET' });
            let body = '';
            const timer = setTimeout(() => {
              req.abort();
              resolve({ ok: false, error: `redirect timeout (${MANUAL_YMLL_TIMEOUT / 1000}s)` });
            }, MANUAL_YMLL_TIMEOUT);
            req.on('response', (res) => {
              clearTimeout(timer);
              res.on('data', (chunk) => { body += chunk.toString(); });
              res.on('end', () => {
                if (res.statusCode === 200 && body.includes('version:') && body.includes('sha512:')) {
                  resolve({ ok: true, statusCode: 200, data: body });
                } else {
                  resolve({ ok: false, statusCode: res.statusCode, body: body.substring(0, 200) });
                }
              });
            });
            req.on('error', (err) => {
              clearTimeout(timer);
              resolve({ ok: false, error: err.message });
            });
            req.end();
          });
          if (redirectResult.ok) return redirectResult;
        } catch {}
      }
    } catch (e) {
      console.error(`[Updater] 手动下载 latest.yml 异常 (${url}):`, e.message);
    }
  }

  return null;
}

// ===== 获取最新 Release 标签（用于构建备用 URL） =====
async function fetchLatestReleaseTag() {
  try {
    const headers = { 'User-Agent': 'Xingbao-Warehouse/Updater' };
    if (ghToken) headers['Authorization'] = `token ${ghToken}`;

    const result = await new Promise((resolve) => {
      const req = net.request({ url: GITHUB_API_LATEST, method: 'GET' });
      let body = '';
      const timer = setTimeout(() => {
        req.abort();
        resolve(null);
      }, 10000);
      req.on('response', (res) => {
        clearTimeout(timer);
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve(json.tag_name || null);
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      Object.entries(headers).forEach(([k, v]) => req.setHeader(k, v));
      req.end();
    });
    return result;
  } catch {
    return null;
  }
}

// ===== 版本比较（semver 简易实现） =====
function isNewerVersion(newVer, currentVer) {
  const n = (newVer || '').split('.').map(Number);
  const c = (currentVer || '').split('.').map(Number);
  for (let i = 0; i < Math.max(n.length, c.length); i++) {
    const a = n[i] || 0;
    const b = c[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false; // 相等
}

// ========== autoUpdater 事件监听 ==========

autoUpdater.on('checking-for-update', () => {
  pushDiagnosticLog('info', '连接更新源', `请求 latest.yml${_retryCount > 0 ? ` (第 ${_retryCount + 1} 次)` : ''}...`);
  if (_isSilent) return;
  sendStatus({ event: 'checking', retry: _retryCount });
});

autoUpdater.on('update-available', (info) => {
  pendingUpdate = info;
  _retryCount = 0;
  _checkInProgress = false;
  pushDiagnosticLog('info', '发现新版本', `v${info.version} (当前 v${app.getVersion()})`);
  sendStatus({ event: 'available', version: info.version, releaseNotes: info.releaseNotes });
});

autoUpdater.on('update-not-available', () => {
  pendingUpdate = null;
  _retryCount = 0;
  _checkInProgress = false;
  pushDiagnosticLog('info', '版本检查', `已是最新 v${app.getVersion()}`);
  if (_isSilent) {
    sendStatus({ event: 'idle' });
    return;
  }
  sendStatus({ event: 'no-update' });
});

autoUpdater.on('download-progress', (progress) => {
  sendStatus({
    event: 'progress',
    percent: Math.round(progress.percent),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  pendingUpdate = info;
  pushDiagnosticLog('info', '下载完成', `v${info.version} 已下载，SHA512 校验通过`);
  sendStatus({ event: 'downloaded', version: info.version });
});

autoUpdater.on('error', (err) => {
  const message = err?.message || String(err);
  console.error('[Updater] autoUpdater error:', message, err?.stack || '');

  // 开发环境忽略
  if (message.includes('dev-app-update.yml') || message.includes('ERR_INVALID_ARG_TYPE')) {
    pushDiagnosticLog('info', '开发模式', '开发环境跳过更新');
    sendStatus({ event: 'idle', devMode: true });
    _checkInProgress = false;
    return;
  }

  // 分类错误消息
  let userMessage = '检查更新失败';
  let diagLevel = 'error';
  if (message.includes('net::ERR_') || message.includes('ENOTFOUND') || message.includes('ETIMEDOUT') || message.includes('ECONNREFUSED') || message.includes('NETWORK_TIMEOUT')) {
    userMessage = `网络连接超时 (已重试 ${_retryCount} 次)`;
    diagLevel = 'warn';
  } else if (message.includes('403') || message.includes('rate limit')) {
    userMessage = 'GitHub API 限速，请在安装目录放置 token.txt';
  } else if (message.includes('404')) {
    userMessage = '未找到发布版本或 latest.yml，请先发布新版本';
  } else if (message.includes('SHA512') || message.includes('checksum')) {
    userMessage = '更新包完整性校验失败，已自动回滚';
    diagLevel = 'error';
    // SHA512 校验失败 → 清理已下载的临时文件
    cleanupDownloadCache();
  } else if (message.includes('permission') || message.includes('EACCES') || message.includes('EPERM')) {
    userMessage = '文件写入权限不足，请以管理员身份运行';
  } else {
    userMessage = message;
  }

  pushDiagnosticLog(diagLevel, '更新错误', message);

  if (_isSilent) {
    sendStatus({ event: 'idle', message: userMessage, retry: _retryCount });
  } else {
    sendStatus({ event: 'error', message: userMessage, retry: _retryCount });
  }
});

// ========== 清理已下载的更新缓存（安全回滚） ==========
function cleanupDownloadCache() {
  try {
    // electron-updater 的缓存目录
    const cacheDir = path.join(app.getPath('userData'), 'pending');
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      files.forEach((f) => {
        try { fs.unlinkSync(path.join(cacheDir, f)); } catch {}
      });
      console.log('[Updater] 已清理下载缓存，回滚到当前版本');
      pushDiagnosticLog('info', '安全回滚', `已清理 ${files.length} 个缓存文件`);
    }
  } catch (e) {
    console.error('[Updater] 清理缓存失败:', e.message);
  }
}

// ===== 操作函数 =====

async function checkForUpdates(silent = false) {
  console.log(`[Updater] 检查更新 (silent=${silent}, isPackaged=${app.isPackaged}, currentVersion=${app.getVersion()})`);
  pushDiagnosticLog('info', '开始检查', `当前版本 v${app.getVersion()} | 打包: ${app.isPackaged}`);

  if (!app.isPackaged && !silent) {
    sendStatus({ event: 'idle', devMode: true });
    pushDiagnosticLog('info', '跳过', '非打包环境');
    return;
  }

  // 防止并发检查
  if (_checkInProgress) {
    console.log('[Updater] 已有检查在进行中，跳过');
    return;
  }
  _checkInProgress = true;
  _retryCount = 0;

  _isSilent = silent;
  let lastError = null;

  // 静默模式（启动/后台）使用更短的超时和更少的重试，避免断网下占用资源
  const effectiveTimeout = silent ? SILENT_TIMEOUT : NETWORK_TIMEOUT;
  const maxRetries = silent ? 1 : RETRY_MAX;

  // ===== 重试循环 =====
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    _retryCount = attempt;
    try {
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * attempt;
        pushDiagnosticLog('warn', '重试准备', `等待 ${delay / 1000}s 后第 ${attempt + 1}/${maxRetries} 次重试...`);
        sendStatus({ event: 'checking', retry: attempt, message: `重试 ${attempt + 1}/${maxRetries}...` });
        await sleep(delay);
      }

      // 核心调用：带超时保护
      const result = await Promise.race([
        autoUpdater.checkForUpdates(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AUTOUPDATER_TIMEOUT')), effectiveTimeout)
        ),
      ]);

      // 成功：事件已触发，直接返回
      pushDiagnosticLog('info', '检查成功', `latest.yml ${result?.updateInfo?.version || '已是最新'}`);
      _retryCount = 0;
      _checkInProgress = false;
      return;

    } catch (err) {
      const msg = err?.message || String(err);
      console.error(`[Updater] 第 ${attempt + 1}/${RETRY_MAX} 次尝试失败:`, msg);

      if (msg === 'AUTOUPDATER_TIMEOUT') {
        lastError = new Error('NETWORK_TIMEOUT');
        pushDiagnosticLog('warn', '请求超时', `第 ${attempt + 1}/${RETRY_MAX} 次: latest.yml 下载超时 (>${NETWORK_TIMEOUT / 1000}s)`);
      } else {
        lastError = err;
        pushDiagnosticLog('error', '检查异常', `第 ${attempt + 1}/${RETRY_MAX} 次: ${msg}`);
      }

      // 非超时错误 → 不重试
      if (msg !== 'AUTOUPDATER_TIMEOUT') {
        // 如果 autoUpdater 已经发出了 error 事件，_checkInProgress 可能已被重置
        // 需要额外重置
        _checkInProgress = false;
        _retryCount = 0;
        if (!silent) {
          sendStatus({ event: 'error', message: msg });
        } else {
          sendStatus({ event: 'idle', message: msg });
        }
        return;
      }
    }
  }

  // ===== 所有重试失败 → 手动兜底 =====
  pushDiagnosticLog('warn', '手动兜底', 'autoUpdater 重试全部失败，尝试直接下载 latest.yml...');
  sendStatus({ event: 'checking', retry: RETRY_MAX, message: '切换备用方案...' });

  try {
    // 先获取最新 release 标签（用于构建备用 URL）
    const latestTag = await fetchLatestReleaseTag();
    if (latestTag) {
      pushDiagnosticLog('info', 'Release 标签', `最新: ${latestTag}`);
    }

    const manualYml = await fetchLatestYmlManually(latestTag);

    if (manualYml && manualYml.ok && manualYml.data) {
      const parsed = parseLatestYml(manualYml.data);

      if (parsed && parsed.version && parsed.sha512) {
        const currentVer = app.getVersion();
        console.log(`[Updater] 手动解析: latest.yml 版本=${parsed.version}, 当前=${currentVer}`);

        if (isNewerVersion(parsed.version, currentVer)) {
          // 有新版本
          pendingUpdate = {
            version: parsed.version,
            files: [{ url: parsed.url, sha512: parsed.sha512, size: parsed.size }],
          };
          pushDiagnosticLog('info', '发现新版本', `v${parsed.version} > v${currentVer} (手动兜底成功)`);
          sendStatus({ event: 'available', version: parsed.version });
        } else {
          pendingUpdate = null;
          pushDiagnosticLog('info', '已是最新', `v${parsed.version} <= v${currentVer}`);
          sendStatus({ event: 'no-update' });
        }
        _checkInProgress = false;
        _retryCount = 0;
        return;
      }
    }

    // 手动兜底也失败
    pushDiagnosticLog('error', '手动兜底失败', '无法获取 latest.yml，请检查网络或稍后重试');
    sendStatus({ event: 'error', message: '无法连接更新服务器，请检查网络后重试' });

  } catch (manualErr) {
    pushDiagnosticLog('error', '手动兜底异常', manualErr.message);
    sendStatus({ event: 'error', message: '更新检查异常，请稍后重试' });
  }

  _checkInProgress = false;
  _retryCount = 0;
}

async function downloadUpdate() {
  if (!pendingUpdate) {
    pushDiagnosticLog('error', '下载中止', '没有可用的更新信息');
    sendStatus({ event: 'error', message: '没有可用的更新，请先检查更新' });
    return;
  }

  const ver = pendingUpdate.version;
  const fileSize = pendingUpdate.files?.[0]?.size || 0;
  const expectedSha = pendingUpdate.files?.[0]?.sha512 || pendingUpdate.sha512 || '';
  pushDiagnosticLog('info', '开始下载', `v${ver} ${fileSize > 0 ? `(${(fileSize / 1024 / 1024).toFixed(1)} MB)` : ''}`);

  try {
    await autoUpdater.downloadUpdate();
    // 下载完成后 autoUpdater 会自动校验 SHA512
    // 如果校验失败，'error' 事件会被触发（已在上面处理，会自动清理缓存）
  } catch (err) {
    const msg = err?.message || String(err);
    pushDiagnosticLog('error', '下载失败', msg);
    // 下载异常也清理可能的残留文件
    cleanupDownloadCache();
    sendStatus({ event: 'error', message: msg || '下载失败，请重试' });
  }
}

function installAndRestart() {
  pushDiagnosticLog('info', '安装更新', '正在安装并重启...');
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    pushDiagnosticLog('error', '安装失败', e.message);
    sendStatus({ event: 'error', message: '安装失败: ' + e.message });
  }
}

// 用户确认后更新（显示对话框）
async function confirmUpdate() {
  if (!pendingUpdate) return;
  pushDiagnosticLog('info', '用户确认', `确认下载 v${pendingUpdate.version}`);

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '发现新版本',
    message: `新版本 v${pendingUpdate.version} 已可用`,
    detail: `当前版本: v${app.getVersion()}\n是否立即下载并安装更新？\n安装完成后应用将自动重启。`,
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
  pushDiagnosticLog('info', '定时检查', `间隔 ${CHECK_INTERVAL / 3600000} 小时`);
  updateCheckTimer = setInterval(() => checkForUpdates(true), CHECK_INTERVAL);
}

function stopPeriodicCheck() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

// ===== 在线更新诊断引擎 =====
async function runDiagnostic() {
  const results = [];
  const startTime = Date.now();

  function addResult(step, status, detail) {
    results.push({ step, status, detail, elapsed: Date.now() - startTime });
    pushDiagnosticLog(status === 'ok' ? 'info' : status === 'warn' ? 'warn' : 'error', step, detail);
  }

  // 1. 应用环境
  addResult('应用环境', 'ok', `v${app.getVersion()} | 打包: ${app.isPackaged} | 平台: ${process.platform}`);

  // 2. Token 文件
  if (ghToken) {
    addResult('GitHub Token', 'ok', '已加载（认证请求，5000次/小时）');
  } else {
    addResult('GitHub Token', 'warn', '未找到 token.txt（60次/小时限速，仅检查更新通常够用）');
  }

  // 3. 网络连通性
  let netOk = false;
  try {
    const netResult = await new Promise((resolve) => {
      const req = net.request({ url: 'https://api.github.com', method: 'GET' });
      req.on('response', (res) => resolve({ ok: true, status: res.statusCode }));
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      const timer = setTimeout(() => { req.abort(); resolve({ ok: false, error: 'timeout (10s)' }); }, 10000);
      req.on('response', () => clearTimeout(timer));
      req.on('error', () => clearTimeout(timer));
      req.end();
    });
    netOk = netResult.ok;
    if (netOk) {
      addResult('网络连通性', 'ok', `GitHub API 可达 (HTTP ${netResult.status})`);
    } else {
      addResult('网络连通性', 'error', `GitHub API 不可达: ${netResult.error}`);
    }
  } catch (e) {
    addResult('网络连通性', 'error', e.message);
  }

  // 4. Releases API 检查
  let latestTag = null;
  if (netOk) {
    try {
      const apiResult = await new Promise((resolve) => {
        const headers = { 'User-Agent': 'Xingbao-Warehouse/Diagnostic' };
        if (ghToken) headers['Authorization'] = `token ${ghToken}`;
        const req = net.request({ url: GITHUB_API_LATEST, method: 'GET' });
        let body = '';
        req.on('response', (res) => {
          res.on('data', (chunk) => { body += chunk.toString(); });
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              if (res.statusCode === 200) {
                const tag = json.tag_name || 'unknown';
                const assets = (json.assets || []).map(a => `${a.name}(${(a.size / 1024).toFixed(0)}KB)`).join(', ');
                latestTag = tag;
                resolve({ ok: true, tag, assets_count: (json.assets || []).length, assets });
              } else if (res.statusCode === 403 && body.includes('rate limit')) {
                resolve({ ok: false, error: 'API 限速 (403)', detail: '请放置 token.txt' });
              } else if (res.statusCode === 404) {
                resolve({ ok: false, error: '未找到 Release (404)', detail: '请先发布版本' });
              } else {
                resolve({ ok: false, error: `HTTP ${res.statusCode}`, detail: body.substring(0, 200) });
              }
            } catch {
              resolve({ ok: false, error: 'JSON 解析失败' });
            }
          });
        });
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        const timer = setTimeout(() => { req.abort(); resolve({ ok: false, error: 'timeout (12s)' }); }, 12000);
        req.on('response', () => clearTimeout(timer));
        req.on('error', () => clearTimeout(timer));
        Object.entries(headers).forEach(([k, v]) => req.setHeader(k, v));
        req.end();
      });

      if (apiResult.ok) {
        addResult('Release API', 'ok', `标签 ${apiResult.tag} | ${apiResult.assets_count} 资产: ${apiResult.assets}`);
      } else {
        addResult('Release API', 'error', `${apiResult.error}${apiResult.detail ? ': ' + apiResult.detail : ''}`);
      }
    } catch (e) {
      addResult('Release API', 'error', e.message);
    }
  }

  // 5. latest.yml 可访问性（使用与 electron-updater 一致的 URL）
  if (netOk) {
    // 先试最新版 URL，再试版本直链
    const ymlUrls = [GITHUB_YML_LATEST];
    if (latestTag) {
      ymlUrls.push(`https://github.com/xiaocaihappy/xingbao-warehouse/releases/download/${latestTag}/latest.yml`);
    }

    let ymlOk = false;
    for (const ymlUrl of ymlUrls) {
      if (ymlOk) break;
      try {
        const ymlResult = await new Promise((resolve) => {
          const req = net.request({ url: ymlUrl, method: 'GET' });
          let body = '';
          let redirected = false;
          req.on('response', (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400) {
              const loc = res.headers['location'];
              if (loc) {
                redirected = true;
                // 简易重定向跟进
                resolve({ ok: false, redirect: loc });
                return;
              }
            }
            res.on('data', (chunk) => { body += chunk.toString(); });
            res.on('end', () => {
              if (res.statusCode === 200 && body.includes('version:') && body.includes('sha512:')) {
                const verMatch = body.match(/version:\s*(.+)/);
                const shaMatch = body.match(/sha512:\s*(.+)/);
                resolve({ ok: true, version: verMatch?.[1] || '?', hasSHA: !!shaMatch, source: ymlUrl });
              } else {
                resolve({ ok: false, status: res.statusCode, body: body.substring(0, 100) });
              }
            });
          });
          req.on('error', (err) => resolve({ ok: false, error: err.message }));
          const timer = setTimeout(() => {
            req.abort();
            resolve({ ok: false, error: `timeout (${MANUAL_YMLL_TIMEOUT / 1000}s)` });
          }, 15000);
          req.on('response', () => clearTimeout(timer));
          req.on('error', () => clearTimeout(timer));
          req.end();
        });

        // 跟进重定向
        if (ymlResult.redirect) {
          try {
            const redirectResult = await new Promise((resolve2) => {
              const req2 = net.request({ url: ymlResult.redirect, method: 'GET' });
              let body2 = '';
              req2.on('response', (res) => {
                res.on('data', (chunk) => { body2 += chunk.toString(); });
                res.on('end', () => {
                  if (res.statusCode === 200 && body2.includes('version:') && body2.includes('sha512:')) {
                    const v = body2.match(/version:\s*(.+)/)?.[1] || '?';
                    const s = body2.match(/sha512:\s*(.+)/)?.[1];
                    resolve2({ ok: true, version: v, hasSHA: !!s, source: ymlUrl });
                  } else {
                    resolve2({ ok: false, status: res.statusCode, body: body2.substring(0, 100) });
                  }
                });
              });
              req2.on('error', (e2) => resolve2({ ok: false, error: e2.message }));
              req2.end();
            });
            if (redirectResult.ok) {
              ymlOk = true;
              Object.assign(ymlResult, redirectResult);
              ymlResult.redirect = undefined;
            }
          } catch {}
        }

        if (ymlResult.ok) {
          ymlOk = true;
          const currentVer = app.getVersion();
          const isNewer = ymlResult.version && isNewerVersion(ymlResult.version, currentVer);
          addResult('latest.yml', 'ok',
            `版本 ${ymlResult.version} | SHA512: ${ymlResult.hasSHA ? '存在' : '缺失'} | ${isNewer ? '> 有新版本!' : '= 已是最新'}`);
        }
      } catch (e) {
        // continue to next URL
      }
    }

    if (!ymlOk) {
      addResult('latest.yml', 'error', `无法获取 (已尝试 ${ymlUrls.length} 个 URL)，网络 CDN 可能较慢`);
    }
  }

  // 6. 写入权限检查
  try {
    const testPath = path.join(app.getPath('temp'), 'xingbao_update_test.tmp');
    fs.writeFileSync(testPath, 'test');
    fs.unlinkSync(testPath);
    addResult('写入权限', 'ok', `临时目录可写`);
  } catch (e) {
    addResult('写入权限', 'error', e.message);
  }

  // 7. electron-updater 配置
  try {
    const config = {
      provider: 'github',
      owner: 'xiaocaihappy',
      repo: 'xingbao-warehouse',
      autoDownload: autoUpdater.autoDownload,
      allowDowngrade: autoUpdater.allowDowngrade,
      retryMax: RETRY_MAX,
      timeout: `${NETWORK_TIMEOUT / 1000}s`,
    };
    addResult('更新配置', 'ok', JSON.stringify(config));
  } catch (e) {
    addResult('更新配置', 'error', e.message);
  }

  // 8. 综合评分
  const okCount = results.filter(r => r.status === 'ok').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const errCount = results.filter(r => r.status === 'error').length;
  const totalDuration = Date.now() - startTime;

  results.push({
    step: '__SUMMARY__',
    status: errCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
    detail: `通过 ${okCount}/${results.length - 1} 项 | ${errCount > 0 ? `${errCount} 项异常` : warnCount > 0 ? `${warnCount} 项警告` : '一切正常'} | 耗时 ${totalDuration}ms`,
    elapsed: totalDuration,
  });

  return results;
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
