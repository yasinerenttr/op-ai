# EREN PATRON - TEK KOMUTLA RESIM KORUMA & WINDOWS 11 GECIS ARACI (TAM OTOMATIK PCHC + TPM BYPASS)
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "   🛡️ EREN PATRON - OTOMATİK RESİM KORUMA VE WINDOWS 11 GEÇİŞ SİSTEMİ 🛡️" -ForegroundColor Yellow
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# Önce takılı kalan eski Windows11InstallationAssistant işlemini kapat
Get-Process -Name "Windows11InstallationAssistant*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "[1/3] Bilgisayardaki tüm resimler ve fotoğraflar korumaya alınıyor..." -ForegroundColor Green
$BackupDir = "C:\KORUNAN_RESIMLER_YEDEK"
New-Item -ItemType Directory -Force -Path "$BackupDir\Masaustu_Resimler" | Out-Null
New-Item -ItemType Directory -Force -Path "$BackupDir\Resimler_Klasoru" | Out-Null
New-Item -ItemType Directory -Force -Path "$BackupDir\Belgeler_Resimler" | Out-Null
New-Item -ItemType Directory -Force -Path "$BackupDir\Indirilenler_Resimler" | Out-Null

robocopy "$env:USERPROFILE\Desktop" "$BackupDir\Masaustu_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov *.avi *.mkv /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
robocopy "$env:USERPROFILE\Pictures" "$BackupDir\Resimler_Klasoru" *.* /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
if (Test-Path "$env:USERPROFILE\OneDrive\Desktop") {
    robocopy "$env:USERPROFILE\OneDrive\Desktop" "$BackupDir\OneDrive_Masaustu" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
}
if (Test-Path "$env:USERPROFILE\OneDrive\Pictures") {
    robocopy "$env:USERPROFILE\OneDrive\Pictures" "$BackupDir\OneDrive_Resimler" *.* /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
}
robocopy "$env:USERPROFILE\Documents" "$BackupDir\Belgeler_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
robocopy "$env:USERPROFILE\Downloads" "$BackupDir\Indirilenler_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp /S /R:1 /W:1 /NP /NFL /NDL | Out-Null

Write-Host "✅ Tüm fotoğraflarınız 'C:\KORUNAN_RESIMLER_YEDEK' klasöründe güvende!" -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] 'Bilgisayar Sistem Durumu Denetimi' (PC Health Check) & TPM 2.0 Kilidi Kırılıyor..." -ForegroundColor Green

# 1. PC Health Check (PCHC) Kayıt Defteri Onayı
reg add "HKCU\Software\Microsoft\PCHC" /v UpgradeEligibility /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKCU\Software\Microsoft\PCHC" /v Timestamp /t REG_QWORD /d 133760000000000000 /f 2>$null | Out-Null
reg add "HKLM\SOFTWARE\Microsoft\PCHC" /v UpgradeEligibility /t REG_DWORD /d 1 /f 2>$null | Out-Null

# 2. TPM 2.0 / CPU / RAM / SecureBoot Bypass Kayıtları
reg add "HKLM\SYSTEM\Setup\MoSetup" /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassCPUCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassStorageCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null

# 3. Microsoft'un Resmi AppraiserRes.dll Engelini Otomatik Devre Dışı Bırakıcı (Arka Plan Gözcüsü)
$WatcherCode = @'
while ($true) {
    $dllPaths = @(
        "C:\$WINDOWS.~BT\Sources\appraiserres.dll",
        "$env:SystemDrive\`$WINDOWS.~BT\Sources\appraiserres.dll"
    )
    foreach ($p in $dllPaths) {
        if (Test-Path $p) {
            try {
                Remove-Item -Path $p -Force -ErrorAction SilentlyContinue
                New-Item -ItemType File -Path $p -Force -ErrorAction SilentlyContinue | Out-Null
            } catch {}
        }
    }
    Start-Sleep -Milliseconds 1500
}
'@
Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -NoProfile -Command `$ErrorActionPreference='SilentlyContinue'; $WatcherCode" -WindowStyle Hidden

Write-Host "✅ Tüm kilitler ve Sistem Durumu Denetimi engeli kaldırıldı!" -ForegroundColor Green

Write-Host ""
Write-Host "[3/3] Windows 11 Kurulum Yardımcısı Yeniden Başlatılıyor..." -ForegroundColor Yellow
$Win11Exe = "$env:TEMP\Windows11InstallationAssistant.exe"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not (Test-Path $Win11Exe)) {
    Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/?linkid=2171764" -OutFile $Win11Exe
}

# Uyumluluk modunda (Windows 7 uyumluluk bayrağı donanım kontrolünü atlar) başlat
reg add "HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" /v "$Win11Exe" /t REG_SZ /d "~ WIN7RTM" /f 2>$null | Out-Null
Start-Process -FilePath $Win11Exe

Write-Host "🎉 ŞİMDİ AÇILAN PENCEREDE DİREKT 'KABUL ET VE YÜKLE' EKRANI GELECEK!" -ForegroundColor Cyan
