param([string]$Title = 'Riot Friend Notifier', [string]$Message = 'Test notification: your notifier is ready.')
$ErrorActionPreference = 'Stop'
$appId = 'Local.RiotFriendNotifier'
# Desktop toast notifications need a Start Menu shortcut that carries the
# matching System.AppUserModel.ID property. Register it here as well as during
# install so an existing installation can self-repair on its next toast.
$programsDir = [Environment]::GetFolderPath('Programs')
New-Item -ItemType Directory -Path $programsDir -Force | Out-Null
$startMenuLink = Join-Path $programsDir 'Riot Client Notifier.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startMenuLink)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'manage.ps1') + '" -Action Start'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Riot Client Notifier: alert when the selected friend comes online in VALORANT.'
$shortcut.Save()

# Assign the toast AppUserModelID to the shortcut using its Shell property store.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RiotToastShortcutProperty
{
    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid FormatId; public uint PropertyId; }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort Type;
        public ushort Reserved1;
        public ushort Reserved2;
        public ushort Reserved3;
        public IntPtr Value;
        public int Reserved4;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bindContext, uint flags, ref Guid interfaceId, out IPropertyStore store);
    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant value);

    public static void SetAppUserModelId(string shortcutPath, string appUserModelId)
    {
        Guid interfaceId = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(shortcutPath, IntPtr.Zero, 2, ref interfaceId, out store));
        PropertyKey key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), PropertyId = 5 };
        PropVariant value = new PropVariant { Type = 31, Value = Marshal.StringToCoTaskMemUni(appUserModelId) };
        try
        {
            Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value));
            Marshal.ThrowExceptionForHR(store.Commit());
        }
        finally
        {
            PropVariantClear(ref value);
            Marshal.ReleaseComObject(store);
        }
    }
}
'@
[RiotToastShortcutProperty]::SetAppUserModelId($startMenuLink, $appId)
$appKey = 'HKCU:\Software\Classes\AppUserModelId\' + $appId
New-Item -Path $appKey -Force | Out-Null
New-ItemProperty -Path $appKey -Name DisplayName -Value 'Riot Client Notifier' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $appKey -Name ShowInSettings -Value 1 -PropertyType DWord -Force | Out-Null
$notificationSettingsKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\' + $appId
if (-not (Test-Path -LiteralPath $notificationSettingsKey)) {
    New-Item -Path $notificationSettingsKey -Force | Out-Null
}
$notificationSettings = Get-ItemProperty -LiteralPath $notificationSettingsKey
if ($null -eq $notificationSettings.PSObject.Properties['Enabled']) {
    New-ItemProperty -Path $notificationSettingsKey -Name Enabled -Value 1 -PropertyType DWord -Force | Out-Null
}
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
