$ErrorActionPreference = "Continue"
Set-Location "e:\AIBC\星堡移印仓储系统\app"

Write-Host "=== Build v1.1.22 ===" -ForegroundColor Cyan
Write-Host "[1/2] vite build..." -ForegroundColor Yellow
& npx vite build 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "vite build FAILED" -ForegroundColor Red; exit 1 }
Write-Host "vite build OK" -ForegroundColor Green

Write-Host "[2/2] electron-builder --win..." -ForegroundColor Yellow
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
& npx electron-builder --win 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "electron-builder FAILED" -ForegroundColor Red; exit 1 }
Write-Host "electron-builder OK" -ForegroundColor Green

Write-Host "=== Build output ===" -ForegroundColor Cyan
Get-ChildItem "release-build" -Filter "xingbao*" | Select-Object Name,Length | Format-Table -AutoSize
