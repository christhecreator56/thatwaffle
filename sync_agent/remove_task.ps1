# PowerShell script to unregister That Waffle Place Live Sync Agent from Windows Task Scheduler
# Run in PowerShell: powershell -ExecutionPolicy Bypass -File remove_task.ps1

$TaskName = "TWP_Excel_Live_Sync_Agent"

try {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[SUCCESS] Task '$TaskName' stopped and removed." -ForegroundColor Green
    } else {
        Write-Host "[INFO] Task '$TaskName' is not registered." -ForegroundColor Yellow
    }
} catch {
    Write-Error "Failed to remove task: $_"
}
