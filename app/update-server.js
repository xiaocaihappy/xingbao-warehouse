/**
 * 本地更新服务器 - 用于测试 electron-updater 在线更新功能
 * 
 * 用法：
 *   node update-server.js
 * 
 * 服务启动后，启动已安装的 v1.0.0 应用（内置 publish.url = http://localhost:8080），
 * 应用会自动检测到 v1.0.1 并提示更新。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const DIST_DIR = path.join(__dirname, 'dist-electron');

const MIME = {
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0]; // 去掉 query string
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(DIST_DIR, safePath);

  // 安全：禁止访问 dist-electron 之外的目录
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      console.log(`  404 - ${req.method} ${urlPath}`);
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    console.log(`  200 - ${req.method} ${urlPath} (${(stats.size / 1024).toFixed(0)} KB)`);

    res.writeHead(200, {
      'Content-Type': getMime(filePath),
      'Content-Length': stats.size,
      'Access-Control-Allow-Origin': '*',
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ✅  更新服务器已启动: http://localhost:${PORT}\n`);
  console.log(`  📁  服务目录: ${DIST_DIR}\n`);

  // 读取 latest.yml 显示版本信息
  try {
    const yml = fs.readFileSync(path.join(DIST_DIR, 'latest.yml'), 'utf-8');
    const versionMatch = yml.match(/^version:\s*(.+)$/m);
    if (versionMatch) {
      console.log(`  🔔  最新版本: v${versionMatch[1]}\n`);
    }
  } catch (_) {}

  console.log(`  💡  测试步骤：\n`);
  console.log(`      1. 卸载旧版本，安装 update-test/星堡移印仓储系统 Setup 1.0.0.exe`);
  console.log(`      2. 启动已安装的 v1.0.0 应用`);
  console.log(`      3. 5秒后自动检查更新 → 应检测到 v1.0.1`);
  console.log(`      4. 或点击右上角 🔄 手动检查更新\n`);
  console.log(`  🛑  按 Ctrl+C 停止服务器\n`);
});
