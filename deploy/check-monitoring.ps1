$ErrorActionPreference = 'Stop'
$token = (& gcloud auth print-access-token).Trim()
if ($LASTEXITCODE -ne 0) { throw 'GCloud authentication failed' }
$headers = @{ Authorization="Bearer $token" }
$filter = 'metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.labels.check_id="riot-notifier-health-automation-server-KsNZAPE3Efw"'
$end = [DateTime]::UtcNow.ToString('o')
$start = [DateTime]::UtcNow.AddMinutes(-10).ToString('o')
$url = 'https://monitoring.googleapis.com/v3/projects/personalvm-511016/timeSeries?filter=' + [uri]::EscapeDataString($filter) + '&interval.startTime=' + [uri]::EscapeDataString($start) + '&interval.endTime=' + [uri]::EscapeDataString($end)
$data = Invoke-RestMethod -Uri $url -Headers $headers
@($data.timeSeries) | ForEach-Object { if ($_.points) { [pscustomobject]@{checker=$_.metric.labels.checker_location;at=$_.points[0].interval.endTime;passed=$_.points[0].value.boolValue} } } | ConvertTo-Json
