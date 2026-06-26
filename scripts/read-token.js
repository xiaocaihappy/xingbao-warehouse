// 读取项目根目录的 token.txt，过滤 BOM、空行和 # 注释行，输出第一个有效 Token
const fs = require('fs');
const path = require('path');

const tokenFile = path.join(__dirname, '..', 'token.txt');

if (!fs.existsSync(tokenFile)) {
  process.exit(1);
}

let content = fs.readFileSync(tokenFile, 'utf8');

// 去掉 UTF-8 BOM
if (content.charCodeAt(0) === 0xFEFF) {
  content = content.slice(1);
}

const line = content
  .split(/\r?\n/)
  .map((l) => l.trim())
  .find((l) => l && !l.startsWith('#'));

console.log(line || '');
