/**
 * resilientDownloader.js
 * 弹性下载器：断点续传 + 多镜像源故障转移 + 指数退避重试 + SHA256 校验
 *
 * 用于替代 electron-updater 默认下载逻辑，解决国内 GitHub 下载慢/中断问题。
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// ========== 配置常量 ==========

// 单次 Range 请求超时（毫秒）
const REQUEST_TIMEOUT_MS = 30_000;
// 单次 Range 请求无数据超时（毫秒，超过这么久没收到数据认为连接卡死）
const STALL_TIMEOUT_MS = 15_000;
// 指数退避初始间隔（毫秒）
const INITIAL_BACKOFF_MS = 1_000;
// 指数退避最大间隔（毫秒）
const MAX_BACKOFF_MS = 8_000;
// 单个镜像源最大重试次数
const MAX_RETRIES_PER_MIRROR = 3;
// 分片大小：2MB，断点续传的最小粒度
const CHUNK_SIZE = 2 * 1024 * 1024;

// ========== 工具函数 ==========

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 计算文件的 SHA256
 * @param {string} filePath
 * @returns {Promise<string>} hex digest
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 简单的 HTTP/HTTPS GET 请求（返回 Buffer），支持超时
 */
function fetchBuffer(url, { headers = {}, timeout = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.get(parsed, { headers, timeout }, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        res.destroy();
        fetchBuffer(redirectUrl, { headers, timeout }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.destroy();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`请求超时 (${timeout}ms): ${url}`));
    });
  });
}

/**
 * 发送 Range 请求，下载文件的指定字节范围
 * @param {string} url - 下载地址
 * @param {number} start - 起始字节偏移
 * @param {number} end - 结束字节偏移（可选，不传表示到文件末尾）
 * @param {object} options
 * @param {function} options.onProgress - 进度回调 (receivedBytes)
 * @param {AbortSignal} options.signal - 取消信号
 * @returns {Promise<{buffer: Buffer, totalSize: number, contentRange: string}>}
 */
function fetchRange(url, start, end, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const rangeHeader = end !== undefined ? `bytes=${start}-${end}` : `bytes=${start}-`;
    const options = {
      headers: { Range: rangeHeader },
      timeout: REQUEST_TIMEOUT_MS,
    };

    let receivedBytes = 0;
    let totalSize = 0;
    let stallTimer = null;
    const chunks = [];

    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        req.destroy();
        reject(new Error(`数据流停滞超时 (${STALL_TIMEOUT_MS}ms 无数据)`));
      }, STALL_TIMEOUT_MS);
    };

    const req = lib.get(parsed, options, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        res.destroy();
        if (stallTimer) clearTimeout(stallTimer);
        fetchRange(redirectUrl, start, end, { onProgress, signal }).then(resolve, reject);
        return;
      }

      // 200 表示服务器不支持 Range，返回完整文件
      if (res.statusCode === 200 && start === 0) {
        totalSize = parseInt(res.headers['content-length'] || '0', 10);
        resetStallTimer();
        res.on('data', (chunk) => {
          chunks.push(chunk);
          receivedBytes += chunk.length;
          if (stallTimer) resetStallTimer();
          onProgress?.(receivedBytes);
        });
        res.on('end', () => {
          if (stallTimer) clearTimeout(stallTimer);
          resolve({ buffer: Buffer.concat(chunks), totalSize, contentRange: `bytes 0-${receivedBytes - 1}/${totalSize}` });
        });
        res.on('error', (err) => {
          if (stallTimer) clearTimeout(stallTimer);
          reject(err);
        });
        return;
      }

      // 206 Partial Content = 支持 Range
      if (res.statusCode !== 206) {
        res.destroy();
        if (stallTimer) clearTimeout(stallTimer);
        reject(new Error(`Range 请求失败: HTTP ${res.statusCode} (服务器可能不支持断点续传)`));
        return;
      }

      // 解析 Content-Range: bytes start-end/total
      const contentRange = res.headers['content-range'] || '';
      const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (match) {
        totalSize = parseInt(match[3], 10);
      }

      resetStallTimer();
      res.on('data', (chunk) => {
        chunks.push(chunk);
        receivedBytes += chunk.length;
        if (stallTimer) resetStallTimer();
        onProgress?.(receivedBytes);
      });
      res.on('end', () => {
        if (stallTimer) clearTimeout(stallTimer);
        resolve({ buffer: Buffer.concat(chunks), totalSize, contentRange });
      });
      res.on('error', (err) => {
        if (stallTimer) clearTimeout(stallTimer);
        reject(err);
      });
    });

    req.on('error', (err) => {
      if (stallTimer) clearTimeout(stallTimer);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      if (stallTimer) clearTimeout(stallTimer);
      reject(new Error(`请求超时 (${REQUEST_TIMEOUT_MS}ms)`));
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy();
        if (stallTimer) clearTimeout(stallTimer);
        reject(new Error('下载已取消'));
      });
    }
  });
}

// ========== 弹性下载器主逻辑 ==========

/**
 * 从单个镜像源下载文件（带断点续传 + 指数退避重试）
 *
 * @param {string} url - 下载地址
 * @param {string} destPath - 目标文件路径
 * @param {object} options
 * @param {number} options.expectedSize - 文件预期大小（字节）
 * @param {string} options.expectedSha256 - 预期 SHA256（可选，用于最终校验）
 * @param {function} options.onProgress - 进度回调 (downloadedBytes, totalBytes)
 * @param {function} options.onRetry - 重试回调 (attempt, error, backoffMs)
 * @param {AbortSignal} options.signal - 取消信号
 * @param {number} options.maxRetries - 最大重试次数
 * @returns {Promise<{success: boolean, downloaded: number, verified: boolean, sha256: string}>}
 */
async function downloadFromMirror(url, destPath, options = {}) {
  const {
    expectedSize,
    expectedSha256,
    onProgress,
    onRetry,
    signal,
    maxRetries = MAX_RETRIES_PER_MIRROR,
  } = options;

  let attempt = 0;
  // 已下载的字节数（用于断点续传）
  let downloadedBytes = 0;

  while (attempt <= maxRetries) {
    try {
      // 检查已存在文件的大小（断点续传）
      if (fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        downloadedBytes = stat.size;
        // 如果文件已完整，直接跳到校验
        if (expectedSize && downloadedBytes >= expectedSize) {
          downloadedBytes = expectedSize;
          break;
        }
        console.log(`[Downloader] 断点续传: ${url} 已有 ${downloadedBytes} 字节`);
      } else {
        downloadedBytes = 0;
      }

      // 打开文件用于追加写入
      const fileStream = fs.createWriteStream(destPath, { flags: 'a' });

      try {
        let totalSize = expectedSize || 0;
        let rangeReceived = 0;

        const { buffer, totalSize: respTotalSize } = await fetchRange(url, downloadedBytes, undefined, {
          onProgress: (received) => {
            rangeReceived = received;
            onProgress?.(downloadedBytes + received, totalSize || respTotalSize);
          },
          signal,
        });

        if (respTotalSize) totalSize = respTotalSize;

        // 写入数据
        fileStream.write(buffer);
        fileStream.end();
        await new Promise((resolve, reject) => {
          fileStream.on('finish', resolve);
          fileStream.on('error', reject);
        });

        downloadedBytes += buffer.length;
        onProgress?.(downloadedBytes, totalSize);

        // 检查是否下载完整
        if (totalSize > 0 && downloadedBytes >= totalSize) {
          break; // 下载完成
        }

        // 如果还没下完但请求正常结束，继续下一轮
        if (downloadedBytes < totalSize) {
          console.log(`[Downloader] 分片下载完成 ${downloadedBytes}/${totalSize}，继续...`);
          continue;
        }
        break;
      } finally {
        if (!fileStream.destroyed) {
          fileStream.destroy();
        }
      }
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        throw new Error(`镜像源下载失败 (${maxRetries + 1}次): ${err.message}`);
      }

      const backoffMs = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      console.warn(`[Downloader] 第 ${attempt}/${maxRetries} 次失败: ${err.message}，${backoffMs}ms 后重试`);
      onRetry?.(attempt, err, backoffMs);

      await sleep(backoffMs);

      // 如果是文件写入问题，删除部分文件重新开始
      if (err.message.includes('EACCES') || err.message.includes('ENOENT')) {
        try { fs.unlinkSync(destPath); } catch {}
        downloadedBytes = 0;
      }
    }
  }

  // ========== SHA256 校验 ==========
  const actualSha256 = await sha256File(destPath);
  const verified = !expectedSha256 || actualSha256 === expectedSha256;

  if (!verified) {
    // 校验失败，删除损坏文件
    try { fs.unlinkSync(destPath); } catch {}
    throw new Error(
      `SHA256 校验失败！\n` +
      `期望: ${expectedSha256}\n` +
      `实际: ${actualSha256}\n` +
      `文件可能下载损坏，已自动删除。`
    );
  }

  return {
    success: true,
    downloaded: downloadedBytes,
    verified: true,
    sha256: actualSha256,
  };
}

/**
 * 多镜像源故障转移下载
 *
 * 依次尝试镜像源列表中的每个地址，任一成功即返回。
 * 单个地址失败（超时/连接错误）自动切换下一个。
 *
 * @param {string[]} mirrors - 镜像源地址列表（按优先级排序）
 * @param {string} destPath - 目标文件路径
 * @param {object} options - 下载选项（同 downloadFromMirror）
 * @param {function} options.onMirrorSwitch - 镜像切换回调 (fromUrl, toUrl, error)
 * @returns {Promise<{success: boolean, mirrorUsed: string, downloaded: number, sha256: string}>}
 */
async function downloadWithFailover(mirrors, destPath, options = {}) {
  const { onMirrorSwitch, ...restOptions } = options;

  if (!mirrors || mirrors.length === 0) {
    throw new Error('镜像源列表为空');
  }

  let lastError = null;

  for (let i = 0; i < mirrors.length; i++) {
    const url = mirrors[i];
    console.log(`[Downloader] 尝试镜像源 ${i + 1}/${mirrors.length}: ${url}`);

    try {
      // 如果切换了镜像源，删除可能存在的半截文件（不同源可能不一致）
      if (i > 0 && fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        // 只有文件不完整时才删除重下
        if (restOptions.expectedSize && stat.size < restOptions.expectedSize) {
          console.log(`[Downloader] 切换镜像源，清理半截文件 (${stat.size} bytes)`);
          try { fs.unlinkSync(destPath); } catch {}
        }
      }

      const result = await downloadFromMirror(url, destPath, restOptions);
      return {
        success: true,
        mirrorUsed: url,
        ...result,
      };
    } catch (err) {
      lastError = err;
      console.warn(`[Downloader] 镜像源 ${url} 失败: ${err.message}`);

      if (i < mirrors.length - 1) {
        const nextUrl = mirrors[i + 1];
        console.log(`[Downloader] 切换到下一个镜像源: ${nextUrl}`);
        onMirrorSwitch?.(url, nextUrl, err);
      }
    }
  }

  throw new Error(`所有镜像源均下载失败。最后错误: ${lastError?.message || '未知'}`);
}

// ========== 更新清单（update.json）校验 ==========

/**
 * 从 URL 拉取 update.json 清单
 * @param {string} manifestUrl
 * @returns {Promise<object>} 解析后的清单对象
 */
async function fetchUpdateManifest(manifestUrl) {
  const buffer = await fetchBuffer(manifestUrl, { timeout: 15_000 });
  const text = buffer.toString('utf-8');

  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (e) {
    throw new Error(`更新清单解析失败: ${e.message}`);
  }

  // 必须字段校验
  if (!manifest.version) {
    throw new Error('更新清单缺少 version 字段');
  }
  if (!manifest.url && !manifest.mirrors) {
    throw new Error('更新清单缺少下载地址 (url 或 mirrors)');
  }

  return manifest;
}

/**
 * 校验更新清单本身的完整性
 * 清单可以包含自身的 sha256 字段（对内容去签名后的 sha256）
 * @param {object} manifest
 * @param {string} manifestUrl - 用于拉取原始内容做二次校验
 * @returns {Promise<{valid: boolean, reason: string}>}
 */
async function verifyManifest(manifest, manifestUrl) {
  // 如果清单中声明了 manifestSha256，则对清单内容（去掉 manifestSha256 字段后）做校验
  if (manifest.manifestSha256) {
    const declaredHash = manifest.manifestSha256;
    // 构造待校验内容：去掉 manifestSha256 字段的 JSON
    const { manifestSha256, ...rest } = manifest;
    const content = JSON.stringify(rest);
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');

    if (actualHash !== declaredHash) {
      return {
        valid: false,
        reason: `更新清单哈希不匹配！可能被篡改。\n期望: ${declaredHash}\n实际: ${actualHash}`,
      };
    }
    return { valid: true, reason: '清单哈希校验通过' };
  }

  // 没有声明 manifestSha256，仅做基本结构校验
  return { valid: true, reason: '清单未声明哈希，跳过签名校验' };
}

module.exports = {
  // 主下载函数
  downloadWithFailover,
  downloadFromMirror,
  // 清单相关
  fetchUpdateManifest,
  verifyManifest,
  // 工具函数
  sha256File,
  fetchBuffer,
  // 常量
  CHUNK_SIZE,
  MAX_RETRIES_PER_MIRROR,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
};
