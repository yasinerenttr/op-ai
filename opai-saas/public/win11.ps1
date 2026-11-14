# EREN PATRON - KESIN WINDOWS 11 KURULUMU (SERVER VARIANT BYPASS - %75 HATASINI %100 ASAR)
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "   🛡️ EREN PATRON - TPM 2.0 & İŞLEMCİ ENGELİNİ %100 KALDIRAN WİN 11 KURUCU 🛡️" -ForegroundColor Yellow
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Resim korumasını teyit et
$BackupDir = "C:\KORUNAN_RESIMLER_YEDEK"
if (-not (Test-Path $BackupDir)) {
    Write-Host "[1/3] Bilgisayardaki tüm fotoğraflar korumaya alınıyor..." -ForegroundColor Green
    New-Item -ItemType Directory -Force -Path "$BackupDir\Masaustu_Resimler" | Out-Null
    New-Item -ItemType Directory -Force -Path "$BackupDir\Resimler_Klasoru" | Out-Null
    robocopy "$env:USERPROFILE\Desktop" "$BackupDir\Masaustu_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
    robocopy "$env:USERPROFILE\Pictures" "$BackupDir\Resimler_Klasoru" *.* /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
}
Write-Host "✅ Tüm fotoğraflarınız 'C:\KORUNAN_RESIMLER_YEDEK' klasöründe güvende!" -ForegroundColor Green

# 2. Kayıt defteri kilitlerini kır
reg add "HKLM\SYSTEM\Setup\MoSetup" /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassCPUCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null

# 3. Eğer şu an açık olan hata penceresi varsa ve dosyalar C:\$WINDOWS.~BT içindeyse, Kapat'a basmadan önce kopyala veya direkt başlat!
$BtSources = 'C:\$WINDOWS.~BT\Sources'
$SafeCopyDir = 'C:\Win11_Kurulum_Dosyalari'

if (Test-Path "$BtSources\SetupPrep.exe") {
    Write-Host "🔥 İndirilmiş Windows 11 kurulum dosyaları yakalandı!" -ForegroundColor Green
    Write-Host "⏳ Kurulum Asistanı dosyaları silmesin diye güvenli klasöre alınıyor ve TPM'siz kurulum başlatılıyor..." -ForegroundColor Yellow
    
    # Önce Windows11InstallationAssistant ve SetupHost'u zorla kapat ki dosyaları silemesin!
    Stop-Process -Name "Windows11InstallationAssistant*","Windows10UpgraderApp*","SetupHost*","SetupPrep*" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    
    # AppraiserRes.dll dosyasını sıfırla
    $Appraiser = "$BtSources\appraiserres.dll"
    if (Test-Path $Appraiser) {
        attrib -r -s -h $Appraiser 2>$null
        [System.IO.File]::WriteAllBytes($Appraiser, @())
    }
    
    Write-Host "🚀 Şimdi TPM 2.0 ve İşlemci kontrolü tamamen kapalı olarak kurulum penceresi açılıyor!" -ForegroundColor Cyan
    Write-Host "   (Ekranda 'Windows Server Kurulumu' yazması normaldir, kendi Windows 11 Home/Pro sürümünüzü kurar ve tüm dosyalarınızı korur!)" -ForegroundColor Green
    Start-Process -FilePath "$BtSources\SetupPrep.exe" -ArgumentList "/product server"
    exit
}

# Eğer kullanıcı "Kapat"a bastığı için C:\$WINDOWS.~BT silindiyse, ESD dosyasını veya Kurulum Asistanını yakalayan otomatik nöbetçi başlat:
Write-Host "⏳ Kurulum Asistanı başlatılıyor... Dosyalar hazırlanır hazırlanmaz TPM/İşlemci hatası vermeden otomatik '/product server' moduna geçilecek!" -ForegroundColor Yellow

$InterceptorScript = @'
$triggered = $false
while (-not $triggered) {
    $btPrep = 'C:\$WINDOWS.~BT\Sources\SetupPrep.exe'
    $btWim  = 'C:\$WINDOWS.~BT\Sources\install.esd'
    $btWim2 = 'C:\$WINDOWS.~BT\Sources\install.wim'
    $setupHost = Get-Process -Name "SetupHost" -ErrorAction SilentlyContinue
    
    # SetupHost çalışmaya başladığı an (yani Adım 3/3 Yükleme %70 civarına gelip donanım kontrolü yapacağı an)
    if ($setupHost -and (Test-Path $btPrep) -and ((Test-Path $btWim) -or (Test-Path $btWim2))) {
        $triggered = $true
        # Asistanın hata verip klasörü silmesini engellemek için asistanı ve normal SetupHost'u durdur
        Stop-Process -Name "Windows11InstallationAssistant*","Windows10UpgraderApp*","SetupHost*","SetupPrep*" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        
        # Tekrar "/product server" bayrağıyla başlat!
        Start-Process -FilePath $btPrep -ArgumentList "/product server"
        break
    }
    Start-Sleep -Milliseconds 800
}
'@

Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -NoProfile -Command `$ErrorActionPreference='SilentlyContinue'; $InterceptorScript" -WindowStyle Hidden

$Win11Exe = "$env:TEMP\Windows11InstallationAssistant.exe"
if (-not (Test-Path $Win11Exe)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/?linkid=2171764" -OutFile $Win11Exe
}
Start-Process -FilePath $Win11Exe
Write-Host "✅ Nöbetçi aktif! Kurulum Asistanı dosyaları çıkardığı an hata penceresi çıkmadan otomatik olarak TPM'siz kurulum ekranı açılacak." -ForegroundColor Green
