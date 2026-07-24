$ErrorActionPreference = "Continue"
Set-Location "e:\AIBC\星堡移印仓储系统\app"

# 检查 .env 是否存在
if (-not (Test-Path ".env")) {
    Write-Host ".env 文件不存在，复制 .env.example 作为占位（Supabase 调用会失败但构建本身能跑完）" -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env" -Force
    } else {
        Write-Host ".env.example 也不存在，跳过" -ForegroundColor Red
    }
}

Write-Host "=== 开始构建 v1.1.22 ===" -ForegroundColor Cyan
Write-Host "[1/2] vite build..."
& npx vite build 2>&1 | Out-Host
$buildExit = $LASTEXITCODE
if ($buildExit -ne 0) {
    Write-Host "vite build 失败 exit=$buildExit" -ForegroundColor Red
    exit $buildExit
}
Write-Host "vite build OK" -ForegroundColor Green

Write-Host "[2/2] electron-builder --win..."
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
& npx electron-builder --win 2>&1 | Out-Host
$ebExit = $LASTEXITCODE
if ($ebExit -ne 0) {
    Write-Host "electron-builder 失败 exit=$ebExit" -ForegroundColor Red
    exit $ebExit
}
Write-Host "=== electron-builder OK ===" -ForegroundColor Green

# 列出输出
Get-ChildItem "release-build" -Filter "*.exe" | Select-Object Name,Length,LastWriteTime | Out-Host
Get-ChildItem "release-build" -Filter "*.yml" | Select-Object Name,Length | Out-Host
Get-ChildItem "release-build" -Filter "*.blockmap" | Select-Object Name,Length | Out-Host
