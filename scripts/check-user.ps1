$token = node scripts/read-token.js
$headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'xingbao-publisher' }
try {
    $r = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers -Method Get
    Write-Host "user: $($r.login) | id=$($r.id)"
    Write-Host "scopes: $($r.scopes -join ',')"
} catch {
    Write-Host "user API failed: $($_.Exception.Message)"
}
