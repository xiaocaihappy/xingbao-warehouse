@echo off
chcp 65001 >nul
title 星堡移印仓储系统 - 发布

echo ========================================
echo   星堡移印仓储系统 发布脚本
echo ========================================
echo.

cd /d "%~dp0app"

:: ===== 读取 Token =====
if not exist "..\token.txt" (
    echo [错误] 未找到 token.txt
    echo 请在项目根目录创建 token.txt，写入你的 GitHub Token
    pause
    exit /b 1
)
for /f "usebackq delims=" %%i in ("..\token.txt") do set "GH_TOKEN=%%i"

:: ===== 读取当前版本号 =====
for /f "tokens=2 delims=:," %%a in ('findstr """version""" package.json') do (
    set OLD_VERSION=%%~a
)
set OLD_VERSION=%OLD_VERSION: =%
echo 当前版本: v%OLD_VERSION%

:: ===== 自动递增 patch 版本号 =====
echo.
echo [0/4] 递增版本号...
call npm run version:patch --silent 2>nul
if %errorlevel% neq 0 (
    echo [错误] 版本号递增失败
    pause
    exit /b 1
)
for /f "tokens=2 delims=:," %%a in ('findstr """version""" package.json') do (
    set APP_VERSION=%%~a
)
set APP_VERSION=%APP_VERSION: =%
echo [OK] 版本号已更新: v%OLD_VERSION% -^> v%APP_VERSION%

:: ===== 清理旧打包文件 =====
echo.
echo [1/4] 清理旧打包文件...
taskkill /F /IM "星堡移印仓储系统.exe" >nul 2>&1
taskkill /F /IM "electron.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
if exist "dist-electron" (
    rmdir /s /q "dist-electron" 2>nul
    if exist "dist-electron" (
        takeown /f "dist-electron" /r /d y >nul 2>&1
        icacls "dist-electron" /grant %username%:F /t >nul 2>&1
        rmdir /s /q "dist-electron" 2>nul
    )
)
for /d %%d in (dist-electron-v*) do rmdir /s /q "%%d" 2>nul
echo [OK] 清理完成

:: ===== 构建前端 =====
echo.
echo [2/4] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)
echo [OK] 前端构建完成

:: ===== 推送 Git Tag（HTTPS + Token，避免 SSH 卡住）=====
echo.
echo [3/4] 推送 Git Tag...
pushd ..
set GIT_TERMINAL_PROMPT=0
git tag -f v%APP_VERSION% >nul 2>&1
echo 推送 v%APP_VERSION% 到 GitHub...
git push https://%GH_TOKEN%@github.com/xiaocaihappy/xingbao-warehouse.git v%APP_VERSION% --force >"%TEMP%\git_push.log" 2>&1
set PUSH_ERR=%errorlevel%
if %PUSH_ERR% neq 0 (
    echo [警告] Git Tag 推送失败（错误码: %PUSH_ERR%）
    type "%TEMP%\git_push.log"
) else (
    echo [OK] Git Tag v%APP_VERSION% 已推送
)
del "%TEMP%\git_push.log" 2>nul
popd

:: ===== 清理 GitHub 上同版本号重复 Release =====
echo 检查并清理旧 Release...
(
echo $token=$env:GH_TOKEN_BAT
echo $tag='v'+$env:APP_VER_BAT
echo $h=@{'Authorization'='token '+$token;'Accept'='application/vnd.github.v3+json'}
echo $api='https://api.github.com/repos/xiaocaihappy/xingbao-warehouse/releases'
echo try{
echo   $rels=Invoke-RestMethod -Uri ($api+'?per_page=5') -Headers $h -Method Get -TimeoutSec 15
echo   $old=$rels^|Where-Object{$_.tag_name -eq $tag}
echo   if($old.Count -gt 0){
echo     foreach($r in $old){
echo       Write-Host ('Found old release ID='+$r.id+', deleting...')
echo       Invoke-RestMethod -Uri ($api+'/'+$r.id) -Headers $h -Method Delete -TimeoutSec 10^|Out-Null
echo       Write-Host ('Deleted release ID='+$r.id)
echo     }
echo   }else{Write-Host 'No duplicate release found'}
echo }catch{Write-Host ('Release check skipped: '+$_.Exception.Message)}
) > "%TEMP%\xingbao_cleanup.ps1"
set "GH_TOKEN_BAT=%GH_TOKEN%"
set "APP_VER_BAT=%APP_VERSION%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\xingbao_cleanup.ps1"
del "%TEMP%\xingbao_cleanup.ps1" 2>nul
echo.

:: ===== 打包并发布 =====
echo [4/4] 打包并发布到 GitHub Releases...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call npx electron-builder --win --publish always
if %errorlevel% neq 0 (
    echo [错误] 发布失败（错误码: %errorlevel%）
    echo.
    echo 常见原因：
    echo   1. app.asar 被占用 - 关闭应用后重试
    echo   2. 网络超时 - 检查 GitHub 连接
    echo   3. Token 失效或权限不足 - 检查 token.txt
    pause
    exit /b 1
)

echo.
echo ========================================
echo   发布完成！
echo   版本: v%APP_VERSION%
echo   查看: https://github.com/xiaocaihappy/xingbao-warehouse/releases
echo ========================================
pause
