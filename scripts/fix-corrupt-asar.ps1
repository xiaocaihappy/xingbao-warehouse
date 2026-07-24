# ============================================================
# 星堡移印仓储系统 - 修复 v1.1.21 差分更新损坏
# ============================================================
# 现象：在线更新后软件打开只剩背景，菜单是英文
# 原因：electron-updater 差分下载在弱网下生成了 58MB 的损坏 app.asar
#       (正常应该 ~100MB)，导致 React 主程序无法加载
# 修复：清理损坏的 pending 缓存 + 重新触发全量更新
# ============================================================

$ErrorActionPreference = "Stop"

# 1. 定位 userData 目录
$userData = "$env:APPDATA\xingbao-warehouse"
$installDir = "E:\Users\Administrator\AppData\Local\Programs\xingbao-warehouse"

if (-not (Test-Path $userData)) {
    Write-Error "找不到用户数据目录: $userData"
    exit 1
}

Write-Host "[1/4] 备份当前安装信息..." -ForegroundColor Cyan
$backupDir = "$userData\backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Write-Host "      备份目录: $backupDir"

# 2. 清理 pending 目录里的损坏文件
Write-Host "[2/4] 清理 pending 更新缓存..." -ForegroundColor Cyan
$pending = "$userData\pending"
if (Test-Path $pending) {
    $files = Get-ChildItem $pending -Force
    foreach ($f in $files) {
        $sizeMB = [math]::Round($f.Length / 1MB, 1)
        Write-Host "      发现: $($f.Name) ($sizeMB MB)"
        # 备份后删除
        Copy-Item $f.FullName "$backupDir\$($f.Name)" -Force
        Remove-Item $f.FullName -Force
    }
    Write-Host "      已备份到 $backupDir" -ForegroundColor Green
} else {
    Write-Host "      pending 目录不存在，跳过" -ForegroundColor Yellow
}

# 3. 备份当前损坏的 app.asar (不删除，方便回滚)
Write-Host "[3/4] 备份当前损坏的 app.asar..." -ForegroundColor Cyan
if (Test-Path "$installDir\resources\app.asar") {
    $currentAsar = Get-Item "$installDir\resources\app.asar"
    $sizeMB = [math]::Round($currentAsar.Length / 1MB, 1)
    Write-Host "      当前 app.asar: $sizeMB MB (正常应 > 80MB)"
    if ($sizeMB -lt 80) {
        Copy-Item "$installDir\resources\app.asar" "$backupDir\app.asar.broken" -Force
        Write-Host "      已备份损坏的 asar: $backupDir\app.asar.broken" -ForegroundColor Green
    } else {
        Write-Host "      当前 asar 大小正常，无需备份" -ForegroundColor Green
    }
} else {
    Write-Host "      app.asar 不存在，请重新安装" -ForegroundColor Red
}

# 4. 重新启动软件，让 electron-updater 触发全量下载
Write-Host "[4/4] 启动软件，自动触发全量更新..." -ForegroundColor Cyan
$exePath = "$installDir\xingbao-warehouse.exe"
if (Test-Path $exePath) {
    Start-Process $exePath
    Write-Host "      已启动，请等待 30 秒让更新流程完成" -ForegroundColor Green
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Magenta
    Write-Host "  修复完成！" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Magenta
    Write-Host "如果软件打开后仍然白屏，请："
    Write-Host "1. 关闭软件"
    Write-Host "2. 浏览器打开下载完整安装包："
    Write-Host "   https://github.com/xiaocaihappy/xingbao-warehouse/releases/download/v1.1.21/xingbao-warehouse-Setup-1.1.21.exe"
    Write-Host "3. 双击运行安装，会自动覆盖"
    Write-Host ""
    Write-Host "备份目录: $backupDir"
} else {
    Write-Error "找不到 xingbao-warehouse.exe: $exePath"
}
