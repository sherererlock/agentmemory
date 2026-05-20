# Kill all processes holding agentmemory ports
$ports = @(3111, 3112, 3113, 3115, 49134)

# Kill up to 5 rounds (iii-engine may respawn)
for ($round = 1; $round -le 5; $round++) {
    foreach ($port in $ports) {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host "[$round] Killed PID $($conn.OwningProcess) (port $port)"
        }
    }

    # Also kill by pid file
    $pidFile = "$env:USERPROFILE\.agentmemory\iii.pid"
    if (Test-Path $pidFile) {
        $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
            Write-Host "[$round] Killed iii.pid=$savedPid"
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    Start-Sleep -Seconds 2

    # Check if 3111 is free
    $check = Get-NetTCPConnection -LocalPort 3111 -State Listen -ErrorAction SilentlyContinue
    if (-not $check) {
        Write-Host "Port 3111 free, starting agentmemory..."
        Start-Process powershell -ArgumentList "-WindowStyle Hidden -Command `"`$env:AGENTMEMORY_YES='1'; agentmemory`"" -WindowStyle Hidden
        exit 0
    }
}

Write-Host "ERROR: Could not free port 3111 after 5 attempts"
exit 1
