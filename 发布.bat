@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title 星堡移印仓储系统 - 发布

echo =========================================
echo   星堡移印仓储系统  发布脚本
echo   目标: github.com/xiaocaihappy/xingbao-warehouse
echo =========================================
echo.

:: ===== 0. 路径规范化 + Git 锁清理 =====
cd /d "%~dp0."
if %errorlevel% neq 0 (
    echo [错误] 无法进入脚本所在目录
    pause
    exit /b 1
)
cd app
if %errorlevel% neq 0 (
    echo [错误] 无法进入 app 目录
    pause
    exit /b 1
)

:: 清理可能残留的 Git 锁文件 (上次崩溃/IDE冲突遗留)
if exist "..\.git\index.lock" (
    echo [警告] 发现残留的 Git index.lock，正在清理...
    del "..\.git\index.lock" 2>nul
)
if exist "..\.git\HEAD.lock" (
    echo [警告] 发现残留的 Git HEAD.lock，正在清理...
    del "..\.git\HEAD.lock" 2>nul
)
:: 检查锁是否顽固残留
if exist "..\.git\index.lock" (
    echo [错误] Git index.lock 无法删除！
    echo 当前 IDE/编辑器 (包括 CodeBuddy/VS Code) 正持有 Git 锁
    echo 请关闭本 IDE 后在 CMD 中手动执行: 发布.bat
    pause
    exit /b 1
)
if exist "..\.git\HEAD.lock" (
    echo [错误] Git HEAD.lock 无法删除！
    echo 当前 IDE/编辑器 (包括 CodeBuddy/VS Code) 正持有 Git 锁
    echo 请关闭本 IDE 后在 CMD 中手动执行: 发布.bat
    pause
    exit /b 1
)

echo [OK] 当前目录: %cd%
echo.

:: ===== 1. 预检: token.txt =====
echo [1/8] 检查 GitHub Token...

if not exist "..\token.txt" (
    echo [错误] 未找到 ..\token.txt
    echo 请在项目根目录创建 token.txt，写入你的 GitHub Token
    pause
    exit /b 1
)

for /f "usebackq delims=" %%i in (`node "..\scripts\read-token.js"`) do set "GH_TOKEN=%%i"

if "%GH_TOKEN%"=="" (
    echo [错误] token.txt 为空或只含注释
    pause
    exit /b 1
)

echo "%GH_TOKEN%" | findstr /I "placeholder" >nul 2>&1
if %errorlevel%==0 (
    echo [错误] token.txt 仍是占位符
    pause
    exit /b 1
)

echo [OK] GitHub Token 已就绪
echo.

:: ===== 2. 预检: git 用户配置 =====
echo [2/8] 检查 Git 用户配置...

for /f "delims=" %%n in ('git config user.name 2^>nul') do set "GIT_NAME=%%n"
for /f "delims=" %%m in ('git config user.email 2^>nul') do set "GIT_EMAIL=%%m"

if "%GIT_NAME%"=="" goto :no_git_config
if "%GIT_EMAIL%"=="" goto :no_git_config
echo [OK] Git 用户: %GIT_NAME% ^<%GIT_EMAIL%^>
echo.
goto :git_ok

:no_git_config
echo [错误] Git 用户配置缺失！
echo 请设置: git config user.name "你的名字" ^&^& git config user.email "你的邮箱"
pause
exit /b 1

:git_ok

:: ===== 3. 读取当前版本号 =====
echo [3/8] 读取当前版本号...

for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"version\":" package.json') do (
    set "OLD_VERSION=%%~a"
)
set "OLD_VERSION=%OLD_VERSION: =%"
set "OLD_VERSION=%OLD_VERSION:"=%"

if "%OLD_VERSION%"=="" (
    echo [错误] 无法从 package.json 读取版本号
    pause
    exit /b 1
)
echo [OK] 当前版本: v%OLD_VERSION%
echo.

:: ===== 4. 自动递增 patch 版本号 =====
echo [4/8] 递增版本号...

node "..\scripts\inc-version.js"
if %errorlevel% neq 0 (
    echo [错误] 版本号递增失败！(错误码: %errorlevel%^)
    pause
    exit /b 1
)

for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"version\":" package.json') do (
    set "APP_VERSION=%%~a"
)
set "APP_VERSION=%APP_VERSION: =%"
set "APP_VERSION=%APP_VERSION:"=%"

echo [OK] 版本号已更新: v%OLD_VERSION% --^> v%APP_VERSION%
echo.

:: ===== 5. 提交版本号变更并推送 main 分支 =====
echo [5/8] 提交并推送 main 分支...

pushd ..
set GIT_TERMINAL_PROMPT=0

git add app/package.json scripts/inc-version.js scripts/cleanup-releases.ps1
set GIT_ADD_ERR=%errorlevel%
if %GIT_ADD_ERR% neq 0 (
    echo [警告] git add 失败 (错误码: %GIT_ADD_ERR%^)
) else (
    git commit -m "release: v%APP_VERSION%"
    set GIT_CMT_ERR=%errorlevel%
    if %GIT_CMT_ERR% neq 0 (
        echo [警告] commit 无变更或失败 (错误码: %GIT_CMT_ERR%^)，继续...
    ) else (
        echo [OK] 已提交版本号变更
    )
)

echo 正在推送 main 分支到 GitHub...
git push https://%GH_TOKEN%@github.com/xiaocaihappy/xingbao-warehouse.git main >"%TEMP%\xingbao_push_main.log" 2>&1
set PUSH_MAIN_ERR=%errorlevel%

if %PUSH_MAIN_ERR% neq 0 (
    echo [错误] main 分支推送失败！(错误码: %PUSH_MAIN_ERR%^)
    echo [推送日志]
    type "%TEMP%\xingbao_push_main.log"
    echo [日志结束]
    del "%TEMP%\xingbao_push_main.log" 2>nul
    popd
    pause
    exit /b 1
)
echo [OK] main 分支已成功推送
del "%TEMP%\xingbao_push_main.log" 2>nul
popd
echo.

:: ===== 6. 清理旧打包文件 =====
echo [6/8] 清理旧打包文件...

echo 关闭可能运行的应用...
taskkill /F /IM "星堡移印仓储系统.exe" >nul 2>&1
taskkill /F /IM "electron.exe" >nul 2>&1
echo 等待 2 秒确保文件释放...
timeout /t 2 /nobreak >nul

if exist "dist-electron" rmdir /s /q "dist-electron" 2>nul
if exist "release-build"  rmdir /s /q "release-build"  2>nul
for /d %%d in (dist-electron-v*) do rmdir /s /q "%%d" 2>nul

echo [OK] 清理完成
echo.

:: ===== 7. 构建前端 =====
echo [7/8] 构建前端 (Vite)...

npx vite build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败！
    pause
    exit /b 1
)
echo [OK] 前端构建完成
echo.

:: ===== 8. 推送 Git Tag + 打包发布 =====
echo [8/8] 推送 Git Tag + 打包发布...
echo.

pushd ..
git tag -f v%APP_VERSION%
set TAG_ERR=%errorlevel%
if %TAG_ERR% neq 0 (
    echo [警告] 创建 tag 失败 (错误码: %TAG_ERR%^)，继续...
) else (
    echo [OK] tag v%APP_VERSION% 已创建
)

echo 正在推送 tag 到 GitHub...
git push https://%GH_TOKEN%@github.com/xiaocaihappy/xingbao-warehouse.git v%APP_VERSION% --force >"%TEMP%\xingbao_push_tag.log" 2>&1
set PUSH_TAG_ERR=%errorlevel%

if %PUSH_TAG_ERR% neq 0 (
    echo [错误] Tag 推送失败！(错误码: %PUSH_TAG_ERR%^)
    echo [推送日志]
    type "%TEMP%\xingbao_push_tag.log"
    echo [日志结束]
    del "%TEMP%\xingbao_push_tag.log" 2>nul
    popd
    pause
    exit /b 1
)
echo [OK] Tag v%APP_VERSION% 已成功推送
del "%TEMP%\xingbao_push_tag.log" 2>nul
popd
echo.

:: ===== 8b. 清理 GitHub 草稿 Release =====
echo 清理 GitHub 上的草稿/重复 Release...

powershell -NoProfile -ExecutionPolicy Bypass -File "..\scripts\cleanup-releases.ps1" -Token "%GH_TOKEN%" -Version "%APP_VERSION%"
echo.

:: ===== 8c. 打包并发布到 GitHub Releases =====
echo 打包并发布到 GitHub Releases (正式版)...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo 正在执行 electron-builder 打包，预计 1-3 分钟...
echo 日志输出: %TEMP%\xingbao_build.log

cmd /c "set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ && npx electron-builder --win --publish always" >"%TEMP%\xingbao_build.log" 2>&1
set BUILD_ERR=%errorlevel%

if %BUILD_ERR% neq 0 (
    echo [错误] 打包发布失败！(错误码: %BUILD_ERR%^)
    echo [打包日志 最后 50 行]
    powershell -NoProfile -Command "Get-Content '%TEMP%\xingbao_build.log' -Tail 50"
    echo [日志结束]
    echo.
    echo 常见失败原因:
    echo   1. 网络超时 - 检查 GitHub 连接
    echo   2. Token 失效 - 确认 token.txt 有效且有 repo 权限
    echo   3. 完整日志: %TEMP%\xingbao_build.log
    del "%TEMP%\xingbao_build.log" 2>nul
    pause
    exit /b 1
)

echo [OK] 打包发布成功！
del "%TEMP%\xingbao_build.log" 2>nul

echo.
echo =========================================
echo   发布完成！
echo   版本: v%APP_VERSION%
echo   查看: https://github.com/xiaocaihappy/xingbao-warehouse/releases
echo =========================================
pause
exit /b 0
