param([string]$Title = 'Riot Friend Notifier', [string]$Message = 'Test notification: your notifier is ready.')
$ErrorActionPreference = 'Stop'
$appId = 'Local.RiotFriendNotifier'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$titleXml = [System.Security.SecurityElement]::Escape($Title)
$messageXml = [System.Security.SecurityElement]::Escape($Message)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast duration='long'><visual><binding template='ToastGeneric'><text>$titleXml</text><text>$messageXml</text></binding></visual><audio src='ms-winsoundevent:Notification.Default'/></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$toast.Tag = 'friend-online'
$toast.Group = 'riot-friend'
$toast.ExpirationTime = [DateTimeOffset]::Now.AddMinutes(30)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
$notifier.Show($toast)
Start-Sleep -Milliseconds 700
$history = [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId)
@{ submitted = $true; setting = $notifier.Setting.ToString(); historyCount = $history.Count } | ConvertTo-Json -Compress
