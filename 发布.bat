@echo off
chcp 65001 >nul
title 星堡移印仓储系统 - 发布

echo ========================================
echo   星堡移印仓储系统 发布脚本
echo ========================================
echo.

cd /d "%~dp0app"

:: 读取 Token
if not exist "..\token.txt" (
    echo ❌ 未找到 token.txt
    echo 请在项目根目录创建 token.txt，写入你的 GitHub Token
    pause
    exit /b 1
)
for /f "usebackq delims=" %%i in ("..\token.txt") do set "GH_TOKEN=%%i"

echo [0/3] 清理旧打包文件...
::: 强制关闭可能占用 app.asar 的进程
taskkill /F /IM "星堡移印仓储系统.exe" 2>nul
taskkill /F /IM "electron.exe" 2>nul
timeout /t 2 /nobreak >nul
::: 删除旧的 dist-electron 目录（解决 EBUSY 文件锁定问题）
if exist "dist-electron" (
    echo 正在删除旧的打包目录...
    rmdir /s /q "dist-electron"
    if exist "dist-electron" (
        echo ⚠ 目录删除失败，尝试强制删除...
        takeown /f "dist-electron" /r /d y >nul 2>&1
        icacls "dist-electron" /grant %username%:F /t >nul 2>&1
        rmdir /s /q "dist-electron"
    )
)
echo ✅ 清理完成
echo.

echo [1/3] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo ❌ 前端构建失败
    pause
    exit /b 1
)
echo ✅ 前端构建完成
echo.

:: 读取版本号并推送 Git Tag
for /f "tokens=2 delims=:," %%a in ('findstr "version" package.json') do (
    set APP_VERSION=%%~a
)
set APP_VERSION=%APP_VERSION: =%
echo 版本号: %APP_VERSION%
cd ..
::: 强制覆盖已存在的 Git Tag（避免因 tag 已存在报错）
git tag -f v%APP_VERSION%
if %errorlevel% neq 0 (
    echo ⚠ Git Tag 创建失败
) else (
    git push origin v%APP_VERSION% --force
    if %errorlevel% neq 0 (
        echo ⚠ Tag 推送失败，继续...
    )
)
cd app

echo.
echo [3/3] 打包并发布到 GitHub Releases...
echo 使用 Electron 国内镜像加速下载...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call npx electron-builder --win --publish always
if %errorlevel% neq 0 (
    echo ❌ 发布失败（错误码: %errorlevel%）
    echo.
    echo 常见原因：
    echo   1. app.asar 被占用 - 关闭应用后重试
    echo   2. 网络超时 - 检查 GitHub 连接
    echo   3. Token 失效 - 检查 token.txt
    pause
    exit /b 1
)

echo.
echo ========================================
echo   🎉 发布完成！
echo   查看: https://github.com/xiaocaihappy/xingbao-warehouse/releases
echo ========================================
pause
