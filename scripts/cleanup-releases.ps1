# 星堡移印仓储系统 - 清理 GitHub 重复/草稿 Release
param(
    [string]$Token,
    [string]$Version
)

$tag = 'v' + $Version
$headers = @{
    'Authorization' = 'token ' + $Token
    'Accept' = 'application/vnd.github.v3+json'
}
$api = 'https://api.github.com/repos/xiaocaihappy/xingbao-warehouse/releases'

try {
    $rels = Invoke-RestMethod -Uri ($api + '?per_page=30') -Headers $headers -Method Get -TimeoutSec 15
    $toDelete = @()
    foreach ($r in $rels) {
        if ($r.draft -eq $true) {
            $toDelete += $r
        } elseif ($r.tag_name -eq $tag) {
            $toDelete += $r
        }
    }
    if ($toDelete.Count -gt 0) {
        foreach ($r in $toDelete) {
            $label = if ($r.draft) { '草稿' } else { $r.tag_name }
            Write-Host "删除 Release: $label (ID=$($r.id))"
            Invoke-RestMethod -Uri ($api + '/' + $r.id) -Headers $headers -Method Delete -TimeoutSec 10 | Out-Null
            Write-Host "已删除: $label"
        }
        Write-Host "共清理 $($toDelete.Count) 个 Release"
    } else {
        Write-Host "无需要清理的草稿或重复 Release"
    }
} catch {
    Write-Host "Release 清理跳过: $($_.Exception.Message)"
}
