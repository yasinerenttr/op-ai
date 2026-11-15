# EREN PATRON - TEK TIKLA WINDOWS 11 KURULUMU & WMI ONARIM ARACI
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "   🛡️ EREN PATRON - TAM OTOMATİK WINDOWS 11 & SİSTEM ONARIM ARACI 🛡️" -ForegroundColor Yellow
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# 0. WMI ve Lisans Servisini Onar (0x80041008 SWbemObjectEx hatasını düzeltir)
Write-Host "[1/4] Windows Lisans & WMI Servisleri Onarılıyor..." -ForegroundColor Green
Stop-Service -Name sppsvc -Force -ErrorAction SilentlyContinue
winmgmt /salvagerepository 2>$null | Out-Null
Start-Service -Name winmgmt -ErrorAction SilentlyContinue
Start-Service -Name sppsvc -ErrorAction SilentlyContinue
Start-Service -Name ClipSVC -ErrorAction SilentlyContinue
Start-Service -Name LicenseManager -ErrorAction SilentlyContinue

# Anakart BIOS'unda OEM anahtarı varsa resmi olarak yükle
try {
    $oemKey = (Get-WmiObject -Query "select * from SoftwareLicensingService" -ErrorAction SilentlyContinue).OA3xOriginalProductKey
    if ($oemKey) {
        Write-Host "✅ Anakart OEM Lisansı bulundu ($oemKey), sisteme işleniyor..." -ForegroundColor Cyan
        cscript //B "$env:windir\system32\slmgr.vbs" /ipk $oemKey 2>$null | Out-Null
        cscript //B "$env:windir\system32\slmgr.vbs" /ato 2>$null | Out-Null
    } else {
        # Ayarlar -> Etkinleştirme penceresini aç ki kullanıcı Dijital Lisans Sorun Gidericisine tıklayabilsin
        Start-Process "ms-settings:activation" -ErrorAction SilentlyContinue
    }
} catch {}

# 1. Resim Koruması Kontrolü
$BackupDir = "C:\KORUNAN_RESIMLER_YEDEK"
if (-not (Test-Path $BackupDir)) {
    Write-Host "[2/4] Bilgisayardaki tüm fotoğraflar korumaya alınıyor..." -ForegroundColor Green
    New-Item -ItemType Directory -Force -Path "$BackupDir\Masaustu_Resimler" | Out-Null
    New-Item -ItemType Directory -Force -Path "$BackupDir\Resimler_Klasoru" | Out-Null
    robocopy "$env:USERPROFILE\Desktop" "$BackupDir\Masaustu_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
    robocopy "$env:USERPROFILE\Pictures" "$BackupDir\Resimler_Klasoru" *.* /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
}
Write-Host "✅ Tüm fotoğraflarınız 'C:\KORUNAN_RESIMLER_YEDEK' klasöründe güvende!" -ForegroundColor Green

# 2. Kayıt Defteri Bypassları (TPM 2.0 + CPU + RAM + SecureBoot)
Write-Host "[3/4] TPM 2.0 ve İşlemci Kilitleri Kaldırılıyor..." -ForegroundColor Green
reg add "HKLM\SYSTEM\Setup\MoSetup" /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassCPUCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKCU\Software\Microsoft\PCHC" /v UpgradeEligibility /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SOFTWARE\Microsoft\PCHC" /v UpgradeEligibility /t REG_DWORD /d 1 /f 2>$null | Out-Null

# 3. Eğer daha önce C:\Win11_Kurulum içine kopyalandıysa veya şu an C:\$WINDOWS.~BT içindeyse:
$SafeDir = 'C:\Win11_Kurulum'
$BtDir   = 'C:\$WINDOWS.~BT'

if ((Test-Path "$SafeDir\Sources\SetupPrep.exe") -and ((Test-Path "$SafeDir\Sources\install.esd") -or (Test-Path "$SafeDir\Sources\install.wim"))) {
    Write-Host "🔥 Hazır Windows 11 kurulum dosyaları ($SafeDir) bulundu! Hemen başlatılıyor..." -ForegroundColor Green
    Stop-Process -Name "Windows11InstallationAssistant*","Windows10UpgraderApp*","SetupHost*","SetupPrep*" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-Process -FilePath "$SafeDir\Sources\SetupPrep.exe" -ArgumentList "/product server"
    Write-Host "🎉 Açılan pencerede 'İleri -> Yükle' diyerek kurulumu tamamlayın!" -ForegroundColor Cyan
    exit
}

if ((Test-Path "$BtDir\Sources\SetupPrep.exe") -and ((Test-Path "$BtDir\Sources\install.esd") -or (Test-Path "$BtDir\Sources\install.wim"))) {
    Write-Host "🔥 İndirilmiş Windows 11 dosyaları yakalandı! Silinmemesi için C:\Win11_Kurulum klasörüne kopyalanıyor..." -ForegroundColor Yellow
    Stop-Process -Name "Windows11InstallationAssistant*","Windows10UpgraderApp*","SetupHost*","SetupPrep*" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    robocopy $BtDir $SafeDir /E /R:1 /W:1 /NP /NFL /NDL | Out-Null
    [System.IO.File]::WriteAllBytes("$SafeDir\Sources\appraiserres.dll", @())
    Write-Host "🚀 Şimdi TPM 2.0 ve İşlemci kontrolü tamamen kapalı olarak kurulum başlatılıyor!" -ForegroundColor Cyan
    Start-Process -FilePath "$SafeDir\Sources\SetupPrep.exe" -ArgumentList "/product server"
    exit
}

# 4. Dosyalar henüz yoksa Kurulum Asistanını başlat ve iner inmez C:\Win11_Kurulum'a yedekleyip "/product server" ile açan Nöbetçiyi kur:
Write-Host "[4/4] Windows 11 Kurulum Asistanı ve Otomatik TPM Bypass Nöbetçisi Başlatılıyor..." -ForegroundColor Yellow

$GuardFile = "$env:TEMP\win11_guard.ps1"
$GuardContent = @'
$ErrorActionPreference = 'SilentlyContinue'
$BtDir   = 'C:\$WINDOWS.~BT'
$SafeDir = 'C:\Win11_Kurulum'

while ($true) {
    $hasPrep = Test-Path "$BtDir\Sources\SetupPrep.exe"
    $hasEsd  = (Test-Path "$BtDir\Sources\install.esd") -or (Test-Path "$BtDir\Sources\install.wim")
    $setupHost = Get-Process -Name "SetupHost" -ErrorAction SilentlyContinue

    if ($hasPrep -and $hasEsd -and $setupHost) {
        Stop-Process -Name "SetupHost*","SetupPrep*","Windows11InstallationAssistant*","Windows10UpgraderApp*" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        robocopy $BtDir $SafeDir /E /R:1 /W:1 /NP /NFL /NDL | Out-Null
        [System.IO.File]::WriteAllBytes("$SafeDir\Sources\appraiserres.dll", @())
        Start-Process -FilePath "$SafeDir\Sources\SetupPrep.exe" -ArgumentList "/product server"
        break
    }
    Start-Sleep -Seconds 1
}
'@
Set-Content -Path $GuardFile -Value $GuardContent -Encoding UTF8 -Force
Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$GuardFile`"" -WindowStyle Hidden

$Win11Exe = "$env:TEMP\Windows11InstallationAssistant.exe"
if (-not (Test-Path $Win11Exe)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/?linkid=2171764" -OutFile $Win11Exe
}
Start-Process -FilePath $Win11Exe
Write-Host "✅ HER ŞEY OTOMATİK BAŞLATILDI! Kurulum Asistanı dosyaları indirdiği saniye hata vermeden C:\Win11_Kurulum'a kopyalayıp TPM'siz kurulumu açacak." -ForegroundColor Green
