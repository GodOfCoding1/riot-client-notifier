param([ValidateSet('Protect','Unprotect')][string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd()
$entropy = [Text.Encoding]::UTF8.GetBytes('RiotFriendNotifier/session/v1')
if ($Action -eq 'Protect') {
    $bytes = [Text.Encoding]::UTF8.GetBytes($inputText)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($protected))
} else {
    $protected = [Convert]::FromBase64String($inputText.Trim())
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
}
