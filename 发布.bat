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
set /p GH_TOKEN=<"..\token.txt"

echo [1/2] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo ❌ 前端构建失败
    pause
    exit /b 1
)
echo ✅ 前端构建完成
echo.

echo [2/2] 打包并发布到 GitHub Releases...
call npx electron-builder --win --publish always
if %errorlevel% neq 0 (
    echo ❌ 发布失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo   🎉 发布完成！
echo   查看: https://github.com/xiaocaihappy/xingbao-warehouse/releases
echo ========================================
pause
