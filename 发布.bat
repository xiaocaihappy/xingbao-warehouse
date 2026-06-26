@echo off
chcp 65001 >nul
title 星堡移印仓储系统 - 发布

echo ========================================
echo   星堡移印仓储系统 发布脚本
echo ========================================
echo.

:: ===== 路径规范化（修复双反斜杠闪退）=====
:: 先 cd 到 BAT 所在目录（"..%~dp0." 是规范化写法，去掉末尾反斜杠），再 cd app
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
echo [OK] 当前目录: %cd%
echo.

:: ===== 预检：token.txt =====
if not exist "..\token.txt" (
    echo [错误] 未找到 token.txt
    echo 请在项目根目录创建 token.txt，写入你的 GitHub Token
    pause
    exit /b 1
)
for /f "usebackq delims=" %%i in (`node "..\scripts\read-token.js"`) do set "GH_TOKEN=%%i"
if not defined GH_TOKEN (
    echo [错误] token.txt 中未找到有效的 GitHub Token
    echo 请删除 # placeholder 这一行，写入你的真实 GitHub Token
    pause
    exit /b 1
)
echo "%GH_TOKEN%" | findstr /I "placeholder" >nul 2>&1
if %errorlevel%==0 (
    echo [错误] token.txt 还是占位符 "# placeholder"
    echo 请打开 token.txt，把它替换为你的 GitHub Personal Access Token
    echo 获取方式：https://github.com/settings/tokens
    pause
    exit /b 1
)
echo [OK] GitHub Token 已读取
echo.

:: ===== 预检：git user.name / user.email =====
for /f "delims=" %%n in ('git config --get user.name 2^>nul') do set "GIT_NAME=%%n"
for /f "delims=" %%m in ('git config --get user.email 2^>nul') do set "GIT_EMAIL=%%m"
if "%GIT_NAME%"=="" goto :git_config_missing
if "%GIT_EMAIL%"=="" goto :git_config_missing
echo [OK] git 用户配置: %GIT_NAME% ^<%GIT_EMAIL%^>
echo.
goto :git_config_ok

:git_config_missing
echo [错误] git 用户配置缺失
echo 请先执行：
echo   git config --global user.name "你的名字"
echo   git config --global user.email "你的邮箱"
pause
exit /b 1

:git_config_ok

:: ===== 读取当前版本号（精确匹配 "version": 字段）=====
:: 精确匹配 "version": 这种字段格式，避开 "version:patch" 脚本行
for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"version\":" package.json') do (
    set "OLD_VERSION=%%~a"
)
set "OLD_VERSION=%OLD_VERSION: =%"
if "%OLD_VERSION%"=="" (
    echo [错误] 无法从 package.json 读取版本号
    pause
    exit /b 1
)
echo 当前版本: v%OLD_VERSION%
echo.

:: ===== 自动递增 patch 版本号 =====
echo [1/6] 递增版本号...
call npm run version:patch
if %errorlevel% neq 0 (
    echo [错误] 版本号递增失败
    pause
    exit /b 1
)

:: 重新读取新版本号
for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"version\":" package.json') do (
    set "APP_VERSION=%%~a"
)
set "APP_VERSION=%APP_VERSION: =%"
echo [OK] 版本号已更新: v%OLD_VERSION% -^> v%APP_VERSION%
echo.

:: ===== 提交版本号变更并推送 main 分支 =====
echo [2/6] 提交并推送代码到 GitHub main 分支...
pushd ..
set GIT_TERMINAL_PROMPT=0
git add app/package.json
git commit -m "release: v%APP_VERSION%"
set COMMIT_ERR=%errorlevel%
if %COMMIT_ERR% neq 0 (
    echo [警告] 无代码变更或 commit 失败（错误码: %COMMIT_ERR%），继续...
) else (
    echo [OK] 已提交版本号变更
)

git push https://%GH_TOKEN%@github.com/xiaocaihappy/xingbao-warehouse.git main >"%TEMP%\xingbao_push_main.log" 2>&1
set PUSH_MAIN_ERR=%errorlevel%
if %PUSH_MAIN_ERR% neq 0 (
    echo [错误] main 分支推送失败（错误码: %PUSH_MAIN_ERR%）
    echo [推送日志]
    type "%TEMP%\xingbao_push_main.log"
    echo [推送日志结束]
    del "%TEMP%\xingbao_push_main.log" 2>nul
    popd
    pause
    exit /b 1
)
echo [OK] main 分支已推送
del "%TEMP%\xingbao_push_main.log" 2>nul
popd
echo.

:: ===== 清理旧打包文件（带充分等待避免文件占用）=====
echo [3/6] 清理旧打包文件...
echo 关闭可能运行的应用...
taskkill /F /IM "星堡移印仓储系统.exe" >nul 2>&1
taskkill /F /IM "electron.exe" >nul 2>&1
echo 等待 5 秒让文件释放...
timeout /t 5 /nobreak >nul
if exist "dist-electron" (
    rmdir /s /q "dist-electron" 2>nul
    if exist "dist-electron" (
        echo [警告] dist-electron 占用中，尝试强制删除...
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
echo.

:: ===== 构建前端 =====
echo [4/6] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)
echo [OK] 前端构建完成
echo.

:: ===== 推送 Git Tag（HTTPS + Token，避免 SSH 卡住）=====
echo [5/6] 推送 Git Tag...
pushd ..
git tag -f v%APP_VERSION%
set TAG_ERR=%errorlevel%
if %TAG_ERR% neq 0 (
    echo [警告] 创建 tag 失败（错误码: %TAG_ERR%），继续...
) else (
    echo [OK] tag v%APP_VERSION% 已创建
)
git push https://%GH_TOKEN%@github.com/xiaocaihappy/xingbao-warehouse.git v%APP_VERSION% --force >"%TEMP%\xingbao_push_tag.log" 2>&1
set PUSH_TAG_ERR=%errorlevel%
if %PUSH_TAG_ERR% neq 0 (
    echo [错误] Git Tag 推送失败（错误码: %PUSH_TAG_ERR%）
    echo [推送日志]
    type "%TEMP%\xingbao_push_tag.log"
    echo [推送日志结束]
    del "%TEMP%\xingbao_push_tag.log" 2>nul
    popd
    pause
    exit /b 1
)
echo [OK] Git Tag v%APP_VERSION% 已推送
del "%TEMP%\xingbao_push_tag.log" 2>nul
popd
echo.

:: ===== 清理 GitHub 上所有草稿 Release + 同版本号 Release =====
echo 清理 GitHub 上的草稿/重复 Release...
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

:: ===== 打包并发布（用 cmd /c 包裹避免 npx 弹窗 + 完整日志）=====
echo [6/6] 打包并发布到 GitHub Releases（正式版）...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo 开始 electron-builder 打包，预计 1-3 分钟，请耐心等待...
echo 日志输出: %TEMP%\xingbao_build.log

cmd /c "npx electron-builder --win --publish always" >"%TEMP%\xingbao_build.log" 2>&1
set BUILD_ERR=%errorlevel%
if %BUILD_ERR% neq 0 (
    echo [错误] 发布失败（错误码: %BUILD_ERR%）
    echo [打包日志 最后 50 行]
    powershell -NoProfile -Command "Get-Content '%TEMP%\xingbao_build.log' -Tail 50"
    echo [日志结束]
    echo.
    echo 常见原因：
    echo   1. app.asar 被占用 - 关闭应用后重试
    echo   2. 网络超时 - 检查 GitHub 连接
    echo   3. Token 失效或权限不足 - 检查 token.txt
    echo   4. 完整日志: %TEMP%\xingbao_build.log
    del "%TEMP%\xingbao_build.log" 2>nul
    pause
    exit /b 1
)
echo [OK] 打包发布成功
del "%TEMP%\xingbao_build.log" 2>nul

echo.
echo ========================================
echo   发布完成！
echo   版本: v%APP_VERSION%
echo   查看: https://github.com/xiaocaihappy/xingbao-warehouse/releases
echo ========================================
pause
