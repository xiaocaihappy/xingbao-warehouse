$token = node scripts/read-token.js
$headers = @{ Authorization = "token $token"; 'User-Agent' = 'xingbao-publisher' }
$r = Invoke-RestMethod -Uri "https://api.github.com/repos/xiaocaihappy/xingbao-warehouse" -Headers $headers -Method Get
Write-Host "name=$($r.full_name)"
Write-Host "permissions: push=$($r.permissions.push) admin=$($r.permissions.admin) maintain=$($r.permissions.maintain) pull=$($r.permissions.pull)"
