@echo off
chcp 65001 >nul
title 星堡移印仓储系统 - 发布

echo ========================================
echo   星堡移印仓储系统 发布脚本
echo ========================================
echo.

cd /d "%~dp0app"

::: ===== 读取 Token =====
if not exist "..\token.txt" (
    echo [错误] 未找到 token.txt
    echo 请在项目根目录创建 token.txt，写入你的 GitHub Token
    pause
    exit /b 1
)
for /f "usebackq delims=" %%i in ("..\token.txt") do set "GH_TOKEN=%%i"

::: ===== 读取当前版本号 =====
for /f "tokens=2 delims=:," %%a in ('findstr """version""" package.json') do (
    set OLD_VERSION=%%~a
)
set OLD_VERSION=%OLD_VERSION: =%
echo 当前版本: v%OLD_VERSION%

::: ===== 自动递增 patch 版本号 =====
echo.
echo [0/5] 递增版本号...
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

::: ===== 提交版本号变更并推送 main 分支 =====
echo.
echo [1/5] 提交并推送代码到 GitHub main 分支...
pushd ..
set GIT_TERMINAL_PROMPT=0
git add app/package.json
git commit -m "release: v%APP_VERSION%" >nul 2>&1
if %errorlevel% neq 0 (
    echo [警告] 无代码变更或 commit 失败，继续...
) else (
    echo [OK] 已提交版本号变更
)
git push https://%GH_TOKEN%@github.com/xiaocaihappy/xingbao-warehouse.git main >"%TEMP%\git_push_main.log" 2>&1
set PUSH_MAIN_ERR=%errorlevel%
if %PUSH_MAIN_ERR% neq 0 (
    echo [警告] main 分支推送失败（错误码: %PUSH_MAIN_ERR%）
    type "%TEMP%\git_push_main.log"
) else (
    echo [OK] main 分支已推送
)
del "%TEMP%\git_push_main.log" 2>nul
popd

::: ===== 清理旧打包文件 =====
echo.
echo [2/5] 清理旧打包文件...
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
if exist "release-build" (
    rmdir /s /q "release-build" 2>nul
)
for /d %%d in (dist-electron-v*) do rmdir /s /q "%%d" 2>nul
echo [OK] 清理完成

::: ===== 构建前端 =====
echo.
echo [3/5] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)
echo [OK] 前端构建完成

::: ===== 推送 Git Tag（HTTPS + Token，避免 SSH 卡住）=====
echo.
echo [4/5] 推送 Git Tag...
pushd ..
git tag -f v%APP_VERSION% >nul 2>&1
echo 推送 v%APP_VERSION% 到 GitHub...
git push https://%GH_TOKEN%@github.com/xiaocaihappy/xingbao-warehouse.git v%APP_VERSION% --force >"%TEMP%\git_push_tag.log" 2>&1
set PUSH_TAG_ERR=%errorlevel%
if %PUSH_TAG_ERR% neq 0 (
    echo [警告] Git Tag 推送失败（错误码: %PUSH_TAG_ERR%）
    type "%TEMP%\git_push_tag.log"
) else (
    echo [OK] Git Tag v%APP_VERSION% 已推送
)
del "%TEMP%\git_push_tag.log" 2>nul
popd

::: ===== 清理 GitHub 上所有草稿 Release + 同版本号 Release =====
echo 检查并清理旧 Release（含草稿）...
(
echo $token=$env:GH_TOKEN_BAT
echo $tag='v'+$env:APP_VER_BAT
echo $h=@{'Authorization'='token '+$token;'Accept'='application/vnd.github.v3+json'}
echo $api='https://api.github.com/repos/xiaocaihappy/xingbao-warehouse/releases'
echo try{
echo   $rels=Invoke-RestMethod -Uri ($api+'?per_page=30') -Headers $h -Method Get -TimeoutSec 15
echo   $toDelete=@()
echo   foreach($r in $rels){
echo     if($r.draft -eq $true){
echo       $toDelete+=$r
echo     } elseif($r.tag_name -eq $tag){
echo       $toDelete+=$r
echo     }
echo   }
echo   if($toDelete.Count -gt 0){
echo     foreach($r in $toDelete){
echo       $label=if($r.draft){'草稿'}else{$r.tag_name}
echo       Write-Host ('Deleting release: '+$label+' (ID='+$r.id+')')
echo       Invoke-RestMethod -Uri ($api+'/'+$r.id) -Headers $h -Method Delete -TimeoutSec 10^|Out-Null
echo       Write-Host ('Deleted: '+$label)
echo     }
echo     Write-Host ('Total deleted: '+$toDelete.Count)
echo   }else{Write-Host 'No draft or duplicate release found'}
echo }catch{Write-Host ('Release check skipped: '+$_.Exception.Message)}
) > "%TEMP%\xingbao_cleanup.ps1"
set "GH_TOKEN_BAT=%GH_TOKEN%"
set "APP_VER_BAT=%APP_VERSION%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\xingbao_cleanup.ps1"
del "%TEMP%\xingbao_cleanup.ps1" 2>nul
echo.

::: ===== 打包并发布 =====
echo [5/5] 打包并发布到 GitHub Releases（正式版）...
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
