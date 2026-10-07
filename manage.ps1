param(
    [ValidateSet('Start','Stop','Status','Test','ChangeFriend','ChangeFriends','AddFriend','RemoveFriend','EnableStartup','DisableStartup')]
    [string]$Action = 'Status',
    [string]$RiotId
)
$ErrorActionPreference = 'Stop'
$installDir = $PSScriptRoot
$nodeExe = Join-Path $installDir 'runtime\node.exe'
$watcherScript = Join-Path $installDir 'watcher.cjs'
$startupDir = [Environment]::GetFolderPath('Startup')
$startupLink = Join-Path $startupDir 'Riot Client Notifier.lnk'
$legacyStartupLink = Join-Path $startupDir 'Riot Friend Notifier.lnk'
function Get-WatcherProcess {
    @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.ExecutablePath -eq $nodeExe -and $_.CommandLine -like ('*"' + $watcherScript + '"*')
    })
}
switch ($Action) {
    'Start' {
        if (@(Get-WatcherProcess).Count -gt 0) { Write-Output 'Watcher is already running.'; break }
        Remove-Item -LiteralPath (Join-Path $installDir 'stop.flag') -Force -ErrorAction SilentlyContinue
        Start-Process -FilePath $nodeExe -ArgumentList ('"' + $watcherScript + '"') -WorkingDirectory $installDir -WindowStyle Hidden
        Write-Output 'Watcher started in the background.'
    }
    'Stop' {
        Set-Content -LiteralPath (Join-Path $installDir 'stop.flag') -Value 'stop' -Encoding ASCII
        $processes = Get-WatcherProcess
        foreach ($watcherProcess in $processes) {
            # Exact executable and script checked above; never stop unrelated Node processes.
            Stop-Process -Id $watcherProcess.ProcessId -ErrorAction SilentlyContinue
        }
        Write-Output 'Watcher stopped. Sign-in startup is still enabled unless removed separately.'
    }
    'Status' {
        $running = @(Get-WatcherProcess).Count -gt 0
        Write-Output "Running: $running"
        Write-Output "Sign-in startup enabled: $((Test-Path -LiteralPath $startupLink) -or (Test-Path -LiteralPath $legacyStartupLink))"
        $statusPath = Join-Path $installDir 'status.json'
        if (Test-Path -LiteralPath $statusPath) { Get-Content -LiteralPath $statusPath }
    }
    'Test' { & (Join-Path $installDir 'toast.ps1') -Title 'Riot Client Notifier' -Message 'Test notification: your notifier is ready.' }
    { $_ -in 'ChangeFriend','ChangeFriends','AddFriend','RemoveFriend' } {
        if (-not $RiotId) { $RiotId = Read-Host 'Friend Riot IDs (Name#TAG,Another#TAG)' }
        $operation = 'replace'
        if ($Action -eq 'AddFriend') { $operation = 'add' }
        if ($Action -eq 'RemoveFriend') { $operation = 'remove' }
        & $nodeExe (Join-Path $installDir 'resolve-friend.cjs') "--$operation" $RiotId
        if ($LASTEXITCODE -ne 0) { throw 'Could not update friends; existing configuration was preserved.' }
        Write-Output 'The watcher will pick up the change on its next poll.'
    }
    'EnableStartup' {
        Remove-Item -LiteralPath $legacyStartupLink -Force -ErrorAction SilentlyContinue
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($startupLink)
        $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $installDir 'manage.ps1') + '" -Action Start'
        $shortcut.WorkingDirectory = $installDir
        $shortcut.WindowStyle = 7
        $shortcut.Description = 'Riot Client Notifier: alert when selected friends come online in VALORANT.'
        $shortcut.Save()
        Write-Output 'Automatic startup enabled for your Windows account.'
    }
    'DisableStartup' {
        Remove-Item -LiteralPath $startupLink -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $legacyStartupLink -Force -ErrorAction SilentlyContinue
        Write-Output 'Automatic startup removed. Use Stop to stop the current watcher.'
    }
}
