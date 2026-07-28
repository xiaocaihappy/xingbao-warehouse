/**
 * generateUpdateManifest.js
 *
 * 构建后运行此脚本，生成 update.json 更新清单并计算 manifestSha256 签名。
 *
 * 用法：
 *   node scripts/generateUpdateManifest.js <version> <exePath> [repoOwner/repoName]
 *
 * 示例：
 *   node scripts/generateUpdateManifest.js 1.1.24 app/release-build/星堡移印仓储系统-Setup-1.1.24.exe
 *
 * 生成结果写入 app/release-build/update.json，发布时一并上传到 GitHub Release。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GITHUB_OWNER = 'xiaocaihappy';
const GITHUB_REPO = 'xingbao-warehouse';

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const version = process.argv[2];
  const exePath = process.argv[3];
  const repoArg = process.argv[4] || `${GITHUB_OWNER}/${GITHUB_REPO}`;

  if (!version || !exePath) {
    console.error('用法: node generateUpdateManifest.js <version> <exePath> [owner/repo]');
    console.error('示例: node generateUpdateManifest.js 1.1.24 app/release-build/星堡移印仓储系统-Setup-1.1.24.exe');
    process.exit(1);
  }

  if (!fs.existsSync(exePath)) {
    console.error(`错误: 安装包文件不存在: ${exePath}`);
    process.exit(1);
  }

  const [owner, repo] = repoArg.split('/');
  const fileName = path.basename(exePath);

  console.log(`\n📦 生成更新清单 update.json`);
  console.log(`   版本: v${version}`);
  console.log(`   文件: ${fileName}`);
  console.log(`   大小: ${formatBytes(fs.statSync(exePath).size)}`);

  // 计算 SHA256
  console.log(`\n🔐 计算 SHA256...`);
  const sha256 = await sha256File(exePath);
  console.log(`   ${sha256}`);

  const fileSize = fs.statSync(exePath).size;

  // GitHub 官方下载地址（兜底）
  const githubUrl = `https://github.com/${owner}/${repo}/releases/download/v${version}/${encodeURIComponent(fileName)}`;

  // ghproxy 加速代理地址（国内首选）
  const ghproxyUrl = `https://ghproxy.com/${githubUrl}`;

  // gh-proxy 另一个加速镜像
  const ghProxyMirrorUrl = `https://gh-proxy.com/${githubUrl}`;

  // 构造清单（不含 manifestSha256，稍后计算）
  const manifest = {
    version: version,
    fileName: fileName,
    size: fileSize,
    sha256: sha256,
    releaseDate: new Date().toISOString(),
    // 镜像源列表（按优先级排序）
    mirrors: [
      ghproxyUrl,      // ① ghproxy 加速代理（国内最快）
      ghProxyMirrorUrl, // ② gh-proxy 备用加速
      githubUrl,        // ③ GitHub 官方（兜底）
    ],
    // GitHub Release 页面（用户手动下载用）
    releasePage: `https://github.com/${owner}/${repo}/releases/tag/v${version}`,
    // 最小允许版本（低于此版本强制更新）
    minVersion: '1.1.20',
    // 更新说明
    releaseNotes: '',
  };

  // 计算清单自身的 SHA256 签名（对去掉 manifestSha256 字段的内容做哈希）
  const manifestContent = JSON.stringify(manifest);
  const manifestSha256 = crypto.createHash('sha256').update(manifestContent).digest('hex');
  manifest.manifestSha256 = manifestSha256;

  // 写入文件
  const outputPath = path.join(path.dirname(exePath), 'update.json');
  const outputContent = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(outputPath, outputContent, 'utf-8');

  console.log(`\n✅ 更新清单已生成: ${outputPath}`);
  console.log(`\n📋 清单内容预览:`);
  console.log(outputContent);
  console.log(`\n📝 发布步骤:`);
  console.log(`   1. 将以下文件上传到 GitHub Release v${version}:`);
  console.log(`      - ${fileName}`);
  console.log(`      - update.json`);
  console.log(`      - latest.yml (electron-builder 自动生成)`);
  console.log(`   2. 确认 Release 不是 Draft 状态`);
  console.log(`   3. 客户端会自动检测 update.json 并用镜像源下载\n`);
}

main().catch((err) => {
  console.error('❌ 生成失败:', err.message);
  process.exit(1);
});
