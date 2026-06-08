$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$PidFile = Join-Path $ProjectRoot ".trade-diary-dev.pid"
$LogFile = Join-Path $ProjectRoot "trade-diary-dev.log"
$Url = "http://localhost:5173"

function Get-ChildProcessIds {
  param([int]$ParentId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Get-ChildProcessIds -ParentId $child.ProcessId
    $child.ProcessId
  }
}

function Stop-TradeDiary {
  param([int]$RootPid)

  $processIds = @(Get-ChildProcessIds -ParentId $RootPid) + $RootPid
  foreach ($processId in ($processIds | Select-Object -Unique)) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
}

if (Test-Path $PidFile) {
  $savedPid = [int](Get-Content $PidFile -Raw)
  $savedProcess = Get-Process -Id $savedPid -ErrorAction SilentlyContinue

  if ($savedProcess) {
    Stop-TradeDiary -RootPid $savedPid
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Trade Diary stopped."
    exit 0
  }

  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

$npmCommand = "npm run dev >> `"$LogFile`" 2>&1"
$process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $npmCommand -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden
Set-Content -Path $PidFile -Value $process.Id

Start-Sleep -Seconds 3
Start-Process $Url

Write-Host "Trade Diary started: $Url"
Write-Host "Run this file again to stop it."
