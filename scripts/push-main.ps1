$ErrorActionPreference = "Stop"

$token = node scripts/read-token.js
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Error "token 为空"
    exit 1
}

$env:GIT_TERMINAL_PROMPT = "0"
$url = "https://${token}@github.com/xiaocaihappy/xingbao-warehouse.git"

Write-Host "Pushing to main..." -ForegroundColor Cyan
& git push $url main
$pushExit = $LASTEXITCODE
Write-Host "git push exit code: $pushExit" -ForegroundColor $(if ($pushExit -eq 0) {"Green"} else {"Red"})
exit $pushExit
