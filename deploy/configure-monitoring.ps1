param(
    [string]$Project = 'personalvm-511016',
    [string]$Vm = 'automation-server',
    [string]$Zone = 'us-central1-a'
)
$ErrorActionPreference = 'Stop'
$token = (& gcloud auth print-access-token).Trim()
if ($LASTEXITCODE -ne 0) { throw 'GCloud authentication failed' }
$headers = @{ Authorization = "Bearer $token" }
$base = "https://monitoring.googleapis.com/v3/projects/$Project"
function Request-Monitoring([string]$Method, [string]$Url, $Body = $null) {
    if ($null -eq $Body) { return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers }
    $json = $Body | ConvertTo-Json -Depth 30 -Compress
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ContentType 'application/json' -Body $json
}
$recipient = (& node -e "const {loadEnv,smtpConfig}=require('./notify/dispatch.cjs');const c=smtpConfig(loadEnv(process.cwd()));if(!c.configured)process.exit(1);process.stdout.write(c.to);").Trim()
if ($LASTEXITCODE -ne 0 -or $recipient -notmatch '^[^\s@]+@[^\s@]+$') { throw 'One configured recipient email is required' }
$vmInfo = (& gcloud compute instances describe $Vm --project=$Project --zone=$Zone --format=json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'VM lookup failed' }
$network = ($vmInfo.networkInterfaces[0].network -split '/')[-1]
$channels = Request-Monitoring 'Get' "$base/notificationChannels"
$channel = @($channels.notificationChannels | Where-Object { $_.type -eq 'email' -and $_.labels.email_address -eq $recipient }) | Select-Object -First 1
if (-not $channel) {
    $channel = Request-Monitoring 'Post' "$base/notificationChannels" @{ type='email'; displayName='Riot notifier owner'; labels=@{ email_address=$recipient }; enabled=$true }
}
$addresses = @()
$page = ''
do {
    $url = 'https://monitoring.googleapis.com/v3/uptimeCheckIps'
    if ($page) { $url += '?pageToken=' + [uri]::EscapeDataString($page) }
    $ips = Request-Monitoring 'Get' $url
    $addresses += @($ips.uptimeCheckIps | Where-Object { $_.ipAddress -notmatch ':' } | ForEach-Object { $_.ipAddress + '/32' })
    $page = $ips.nextPageToken
} while ($page)
$ranges = ($addresses | Sort-Object -Unique) -join ','
if (-not $ranges) { throw 'No Google uptime checker IPs found' }
& gcloud compute instances add-tags $Vm --tags=riot-notifier-health --project=$Project --zone=$Zone --quiet
if ($LASTEXITCODE -ne 0) { throw 'VM health tag failed' }
$ruleExists = & gcloud compute firewall-rules list --project=$Project --filter='name=riot-notifier-health-checkers' --format='value(name)'
if ($ruleExists) {
    & gcloud compute firewall-rules update riot-notifier-health-checkers --project=$Project --allow=tcp:8081 --source-ranges=$ranges --target-tags=riot-notifier-health --quiet
} else {
    & gcloud compute firewall-rules create riot-notifier-health-checkers --project=$Project --network=$network --allow=tcp:8081 --source-ranges=$ranges --target-tags=riot-notifier-health --description='Riot health endpoint: Google uptime checkers only' --quiet
}
if ($LASTEXITCODE -ne 0) { throw 'Checker firewall setup failed' }
$checks = Request-Monitoring 'Get' "$base/uptimeCheckConfigs"
$check = @($checks.uptimeCheckConfigs | Where-Object { $_.displayName -eq 'Riot notifier health - automation-server' }) | Select-Object -First 1
$checkBody = @{ displayName='Riot notifier health - automation-server'; monitoredResource=@{type='gce_instance'; labels=@{project_id=$Project;instance_id=[string]$vmInfo.id;zone=$Zone}};
    httpCheck=@{path='/healthz';port=8081;useSsl=$false;requestMethod='GET';acceptedResponseStatusCodes=@(@{statusValue=200})}; period='60s';timeout='10s' }
if (-not $check) { $check = Request-Monitoring 'Post' "$base/uptimeCheckConfigs" $checkBody }
$checkId = ($check.name -split '/')[-1]
$policyBody = @{displayName='Riot monitoring unavailable - automation-server';enabled=$true;combiner='OR';notificationChannels=@($channel.name);
    documentation=@{mimeType='text/markdown';content="Riot friend monitoring is unavailable on $Vm. Google checks /healthz outside the VM. Possible causes: stopped VM, failed health guard, stopped/hung watcher, stale status, sustained Riot authentication/chat failure, unknown friend status, or pending alert email delivery. SSH using IAP, then run sudo systemctl status riot-notifier riot-notifier-health and sudo cat /var/lib/riot-notifier/health.json. A recovery email is sent when the checks recover."};
    alertStrategy=@{notificationPrompts=@('OPENED','CLOSED');autoClose='86400s'};
    conditions=@(@{displayName='At least two Google uptime checkers fail for two minutes';conditionThreshold=@{
        filter="metric.type=`"monitoring.googleapis.com/uptime_check/check_passed`" AND metric.label.check_id=`"$checkId`" AND resource.type=`"gce_instance`"";
        aggregations=@(@{alignmentPeriod='60s';perSeriesAligner='ALIGN_NEXT_OLDER';crossSeriesReducer='REDUCE_COUNT_FALSE'});
        comparison='COMPARISON_GT';thresholdValue=1;duration='120s';trigger=@{count=1}}})}
$policies = Request-Monitoring 'Get' "$base/alertPolicies"
$policy = @($policies.alertPolicies | Where-Object { $_.displayName -eq $policyBody.displayName }) | Select-Object -First 1
if ($policy) {
    $policyBody.name=$policy.name
    $policy = Request-Monitoring 'Patch' ("https://monitoring.googleapis.com/v3/" + $policy.name) $policyBody
} else { $policy = Request-Monitoring 'Post' "$base/alertPolicies" $policyBody }
[pscustomobject]@{uptimeCheck=$check.name;alertPolicy=$policy.name;channel=$channel.name;channelVerification=$channel.verificationStatus} | ConvertTo-Json
