# PowerShell script to register That Waffle Place Live Sync Agent in Windows Task Scheduler
# Run in PowerShell: powershell -ExecutionPolicy Bypass -File setup_task.ps1

$ErrorActionPreference = "Stop"

$TaskName = "TWP_Excel_Live_Sync_Agent"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Locate pythonw.exe (windowless execution) or python.exe
$VenvPythonw = Join-Path $ScriptDir ".venv\Scripts\pythonw.exe"
$VenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"

if (Test-Path $VenvPythonw) {
    $PythonExe = $VenvPythonw
} elseif (Test-Path $VenvPython) {
    $PythonExe = $VenvPython
} else {
    $SystemPython = (Get-Command python -ErrorAction SilentlyContinue).Source
    if ($SystemPython) {
        $PythonExe = $SystemPython
    } else {
        Write-Error "Python executable not found. Please run install.bat first."
        exit 1
    }
}

$ConfigFile = Join-Path $ScriptDir "config.json"
$Arguments = "-m sync_agent.agent --config `"$ConfigFile`""

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " Registering Windows Task Scheduler: $TaskName" -ForegroundColor Cyan
Write-Host " Executable: $PythonExe" -ForegroundColor Gray
Write-Host " WorkingDir: $ScriptDir" -ForegroundColor Gray
Write-Host " Config:     $ConfigFile" -ForegroundColor Gray
Write-Host "=====================================================================" -ForegroundColor Cyan

# Unregister old task if exists
try {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Removing existing scheduled task '$TaskName'..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
} catch {}

# Create Task Action
$Action = New-ScheduledTaskAction -Execute $PythonExe -Argument $Arguments -WorkingDirectory $ScriptDir

# Create Task Trigger (At User Logon)
$Trigger = New-ScheduledTaskTrigger -AtLogOn

# Create Task Settings (auto restart on failure, allow on-demand, run indefinitely)
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Register the Scheduled Task for the current user
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "That Waffle Place: Continuous one-way Excel workbook synchronization agent to website."

Write-Host "`n[SUCCESS] Task '$TaskName' registered successfully!" -ForegroundColor Green
Write-Host "The sync agent will now start automatically upon Windows user logon." -ForegroundColor Green
Write-Host "To start the task immediately, run:" -ForegroundColor White
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Yellow
Write-Host "To stop or remove the task at any time, run:" -ForegroundColor White
Write-Host "  powershell -ExecutionPolicy Bypass -File remove_task.ps1`n" -ForegroundColor Yellow
