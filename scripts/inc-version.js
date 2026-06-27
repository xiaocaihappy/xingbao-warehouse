// 星堡移印仓储系统 - 递增 patch 版本号
const fs = require('fs');
const path = require('path');
const pkgPath = path.join(__dirname, '..', 'app', 'package.json');
const p = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const v = p.version.split('.');
v[2] = String(Number(v[2]) + 1);
p.version = v.join('.');
fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2) + '\n');
console.log('v' + p.version);
