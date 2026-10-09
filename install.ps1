param([string]$RiotId)
$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:LOCALAPPDATA 'RiotFriendNotifier'
if (-not $RiotId) {
    $existingConfig = Join-Path $installDir 'config.json'
    if (Test-Path -LiteralPath $existingConfig) {
        $savedConfig = Get-Content -LiteralPath $existingConfig -Raw | ConvertFrom-Json
        if ($savedConfig.friends) { $RiotId = ($savedConfig.friends.riotId -join ',') } else { $RiotId = $savedConfig.riotId }
    }
    if (-not $RiotId) { $RiotId = Read-Host 'Friend Riot IDs (Name#TAG,Another#TAG)' }
}
foreach ($friendId in $RiotId.Split(',')) {
    if ($friendId.Trim() -notmatch '^[^#]+#[^#]+$') { throw 'Use comma-separated Riot IDs in Name#TAG format.' }
}
$runtimeDir = Join-Path $installDir 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$existingManage = Join-Path $installDir 'manage.ps1'
if (Test-Path -LiteralPath $existingManage) { & $existingManage -Action Stop }
$runtimeSource = (Get-Command node.exe -ErrorAction Stop).Source
Copy-Item -LiteralPath $runtimeSource -Destination (Join-Path $runtimeDir 'node.exe') -Force
foreach ($name in @('runtime-config.cjs','instance-lock.cjs','cloud-session.cjs','riot-api.cjs','presence.cjs','monitor.cjs','multi-friend-tests.cjs','watcher.cjs','resolve-friend.cjs','toast.ps1','manage.ps1','tests.cjs','notify-tests.cjs','README.md','TECHNICAL-GUIDE.md','standalone-auth.cjs','standalone-presence.cjs','standalone-friends.cjs','saved-login.cjs','secure-session.cjs','protect-session.ps1','xmpp.cjs','xmpp-tests.cjs','verification.md','.env.example')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $installDir $name) -Force
}
$notifyDir = Join-Path $installDir 'notify'
New-Item -ItemType Directory -Path $notifyDir -Force | Out-Null
foreach ($name in @('email.cjs','windows.cjs','dispatch.cjs')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "notify\$name") -Destination (Join-Path $notifyDir $name) -Force
}
$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $envFile) { Copy-Item -LiteralPath $envFile -Destination (Join-Path $installDir '.env') -Force }
$vendorDir = Join-Path $installDir 'vendor\package'
New-Item -ItemType Directory -Path (Join-Path $vendorDir 'lib') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'vendor\package\lib\sax.js') -Destination (Join-Path $vendorDir 'lib\sax.js') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'vendor\package\LICENSE.md'),(Join-Path $PSScriptRoot 'vendor\package\package.json') -Destination $vendorDir -Force
# Register this local desktop notification sender for the current user only.
$appKey = 'HKCU:\Software\Classes\AppUserModelId\Local.RiotFriendNotifier'
New-Item -Path $appKey -Force | Out-Null
New-ItemProperty -Path $appKey -Name DisplayName -Value 'Riot Client Notifier' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $appKey -Name ShowInSettings -Value 1 -PropertyType DWord -Force | Out-Null
foreach ($action in @('Start','Stop','Status','Test','ChangeFriend','ChangeFriends','AddFriend','RemoveFriend','DisableStartup','EnableStartup')) {
    $commandText = '@echo off' + "`r`n" + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage.ps1" -Action ' + $action + "`r`n" + 'pause' + "`r`n"
    Set-Content -LiteralPath (Join-Path $installDir ($action + '.cmd')) -Value $commandText -Encoding ASCII
}
& (Join-Path $runtimeDir 'node.exe') (Join-Path $installDir 'resolve-friend.cjs') $RiotId
if ($LASTEXITCODE -ne 0) { throw 'Friend resolution failed.' }
& (Join-Path $runtimeDir 'node.exe') (Join-Path $installDir 'tests.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
& (Join-Path $runtimeDir 'node.exe') (Join-Path $installDir 'xmpp-tests.cjs')
if ($LASTEXITCODE -ne 0) { throw 'XMPP tests failed.' }
& (Join-Path $runtimeDir 'node.exe') (Join-Path $installDir 'multi-friend-tests.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Multi-friend tests failed.' }
& (Join-Path $runtimeDir 'node.exe') (Join-Path $installDir 'notify-tests.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Notification tests failed.' }
& (Join-Path $installDir 'manage.ps1') -Action Test
& (Join-Path $installDir 'manage.ps1') -Action EnableStartup
& (Join-Path $installDir 'manage.ps1') -Action Start
Write-Output "Installed at $installDir"
