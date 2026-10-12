param([string]$Distribution = 'Ubuntu-24.04')
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'keep-wsl-running.log'
$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
try {
    while ($true) {
        "$(Get-Date -Format o) Starting WSL keepalive: $Distribution" | Out-File -FilePath $log -Append -Encoding utf8
        # Docker is already enabled in systemd. A foreground WSL command keeps
        # the distro alive independently of a transient Docker startup failure.
        & $wsl -d $Distribution -u root --exec /usr/bin/sleep infinity 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
        "$(Get-Date -Format o) WSL command exited: $LASTEXITCODE. Retrying in 15 seconds." | Out-File -FilePath $log -Append -Encoding utf8
        Start-Sleep -Seconds 15
    }
} catch {
    "$(Get-Date -Format o) Keepalive error: $($_.Exception.Message)" | Out-File -FilePath $log -Append -Encoding utf8
    exit 1
}
