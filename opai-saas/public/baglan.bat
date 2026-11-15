@echo off
title EREN PATRON - CANLI PC BAGLANTISI

net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================================
echo    EREN PATRON - CANLI UZAKTAN PC BAGLANTI KOPRUSU AKTIF!
echo ============================================================================
echo.
echo [+] Bilgisayariniz su an bulut uzerinden Yapay Zeka Asistanina baglaniyor...
echo [+] Lutfen bu pencereyi ACIK BIRAKIN, tum islemleri biz uzaktan yapiyoruz!
echo.

set "AGENT_PS1=%TEMP%\opai_agent.ps1"

> "%AGENT_PS1%" echo $ErrorActionPreference = 'SilentlyContinue'
>> "%AGENT_PS1%" echo [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
>> "%AGENT_PS1%" echo $apiUrl = 'https://avelon-wp-botavelon-wp-bot.onrender.com/api/pc-agent/poll'
>> "%AGENT_PS1%" echo $hn = $env:COMPUTERNAME
>> "%AGENT_PS1%" echo Write-Host "BAGLANDI! ($hn) - Uzaktan komut bekleniyor..." -ForegroundColor Green
>> "%AGENT_PS1%" echo $lastOut = ''
>> "%AGENT_PS1%" echo $lastId = ''
>> "%AGENT_PS1%" echo while ($true) {
>> "%AGENT_PS1%" echo   try {
>> "%AGENT_PS1%" echo     $bodyObj = @{ hostname = $hn; cmdId = $lastId; output = $lastOut }
>> "%AGENT_PS1%" echo     $json = $bodyObj ^| ConvertTo-Json -Compress
>> "%AGENT_PS1%" echo     $res = Invoke-RestMethod -Uri $apiUrl -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 10
>> "%AGENT_PS1%" echo     $lastId = ''
>> "%AGENT_PS1%" echo     $lastOut = ''
>> "%AGENT_PS1%" echo     if ($res -and $res.command -and $res.command.id -and $res.command.cmd) {
>> "%AGENT_PS1%" echo       $cid = $res.command.id
>> "%AGENT_PS1%" echo       $cstr = $res.command.cmd
>> "%AGENT_PS1%" echo       Write-Host "[UZAKTAN ISLEM CALISIYOR]: $cid" -ForegroundColor Yellow
>> "%AGENT_PS1%" echo       try {
>> "%AGENT_PS1%" echo         $out = (Invoke-Expression $cstr 2^>^&1 ^| Out-String)
>> "%AGENT_PS1%" echo         if (-not $out) { $out = 'OK (Empty Output)' }
>> "%AGENT_PS1%" echo       } catch {
>> "%AGENT_PS1%" echo         $out = 'ERROR: ' + $_.Exception.Message
>> "%AGENT_PS1%" echo       }
>> "%AGENT_PS1%" echo       $lastId = $cid
>> "%AGENT_PS1%" echo       $lastOut = $out
>> "%AGENT_PS1%" echo       Write-Host "[TAMAMLANDI]: $cid" -ForegroundColor Cyan
>> "%AGENT_PS1%" echo     }
>> "%AGENT_PS1%" echo   } catch {}
>> "%AGENT_PS1%" echo   Start-Sleep -Seconds 2
>> "%AGENT_PS1%" echo }

powershell -NoProfile -ExecutionPolicy Bypass -File "%AGENT_PS1%"
pause
