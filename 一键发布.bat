@echo off
chcp 65001 >nul
title 一键发布 - 星堡移印仓储系统

cd /d "%~dp0"

echo ========================================
echo   星堡移印仓储系统 一键发布
echo ========================================
echo.

git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未找到 Git
    pause
    exit /b 1
)

for /f "usebackq tokens=2 delims=:," %%a in (`findstr /c:"version" app\package.json`) do set "RAW=%%~a"
set "VER=%RAW: =%"
set "VER=%VER:"=%"

if "%VER%"=="" (
    echo 错误: 无法读取版本号
    pause
    exit /b 1
)

echo 当前版本: v%VER%
echo.

set /p CONFIRM=确认发布 v%VER% 到 GitHub? (Y/N): 
if /i not "%CONFIRM%"=="Y" (
    echo 已取消
    pause
    exit /b 0
)
echo.

echo [1/3] 提交代码...
git add .github/workflows/release.yml app/package.json
git commit -m "release: v%VER%"
if %errorlevel% neq 0 echo commit 无改动或已存在，继续...
echo.

echo [2/3] 推送代码与标签...
git push origin main
if %errorlevel% neq 0 (
    echo 推送失败
    pause
    exit /b 1
)

git tag -f "v%VER%" >nul 2>&1
git push origin "v%VER%" --force
if %errorlevel% neq 0 (
    echo 标签推送失败
    pause
    exit /b 1
)
echo.

echo [3/3] 完成!
echo.
echo ========================================
echo   已推送 v%VER%
echo   Actions 构建中:
echo   github.com/xiaocaihappy/xingbao-warehouse/actions
echo ========================================
echo.
pause