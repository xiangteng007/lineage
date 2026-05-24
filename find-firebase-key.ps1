# 搜尋 Firebase 服務帳戶金鑰
Write-Host "=== 搜尋 Firebase 服務帳戶 JSON 金鑰 ===" -ForegroundColor Cyan

$searchPaths = @(
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Documents",
    "$env:TEMP",
    "C:\Users\$env:USERNAME\Downloads"
)

$found = @()

foreach ($path in $searchPaths) {
    if (Test-Path $path) {
        $files = Get-ChildItem -Path $path -Filter "lineage-b0156-firebase-adminsdk*.json" -ErrorAction SilentlyContinue
        foreach ($f in $files) {
            $found += $f
            Write-Host "[FOUND] $($f.FullName)" -ForegroundColor Green
        }
    }
}

if ($found.Count -eq 0) {
    Write-Host ""
    Write-Host "未找到在常見位置。嘗試全域搜尋..." -ForegroundColor Yellow
    # Broader search
    $broadFiles = Get-ChildItem -Path $env:USERPROFILE -Filter "*firebase-adminsdk*.json" -Recurse -ErrorAction SilentlyContinue
    foreach ($f in $broadFiles) {
        $found += $f
        Write-Host "[FOUND] $($f.FullName)" -ForegroundColor Green
    }
}

if ($found.Count -eq 0) {
    Write-Host ""
    Write-Host "找不到檔案。請在 Chrome 中按 Ctrl+J 查看下載記錄。" -ForegroundColor Red
} else {
    # Use the most recent file
    $latest = $found | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Host ""
    Write-Host "使用最新的金鑰: $($latest.FullName)" -ForegroundColor Cyan

    # Copy to Lineage AI folder
    $dest = Join-Path $PSScriptRoot "serviceAccountKey.json"
    Copy-Item $latest.FullName -Destination $dest -Force
    Write-Host "[OK] 已複製到: $dest" -ForegroundColor Green

    # Copy to clipboard
    Get-Content $latest.FullName -Raw | Set-Clipboard
    Write-Host "[OK] JSON 內容已複製到剪貼簿！" -ForegroundColor Green

    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "現在請到 Vercel 貼上：" -ForegroundColor White
    Write-Host "https://vercel.com/xxts-projects-ef5b1ba3/lineage/settings/environment-variables" -ForegroundColor Yellow
    Write-Host "新增: FIREBASE_SERVICE_ACCOUNT_JSON = (Ctrl+V)" -ForegroundColor White
    Write-Host "============================================" -ForegroundColor Cyan

    Start-Process "https://vercel.com/xxts-projects-ef5b1ba3/lineage/settings/environment-variables"
}

Write-Host ""
Read-Host "按 Enter 結束"
