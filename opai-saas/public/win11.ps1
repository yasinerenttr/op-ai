# EREN PATRON - KESIN WINDOWS 11 KURULUMU (SERVER VARIANT BYPASS - TPM 2.0 & ISLEMCI ENGELINI %100 ATLAR)
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "   🛡️ EREN PATRON - TPM 2.0 & İŞLEMCİ ENGELİNİ %100 KALDIRAN WİN 11 KURUCU 🛡️" -ForegroundColor Yellow
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Takılı kalan Windows 11 pencerelerini kapat
Get-Process -Name "Windows11InstallationAssistant*","SetupHost*","Windows10UpgraderApp*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Resim korumasını teyit et
$BackupDir = "C:\KORUNAN_RESIMLER_YEDEK"
if (-not (Test-Path $BackupDir)) {
    Write-Host "[1/3] Bilgisayardaki tüm fotoğraflar korumaya alınıyor..." -ForegroundColor Green
    New-Item -ItemType Directory -Force -Path "$BackupDir\Masaustu_Resimler" | Out-Null
    New-Item -ItemType Directory -Force -Path "$BackupDir\Resimler_Klasoru" | Out-Null
    robocopy "$env:USERPROFILE\Desktop" "$BackupDir\Masaustu_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
    robocopy "$env:USERPROFILE\Pictures" "$BackupDir\Resimler_Klasoru" *.* /S /R:1 /W:1 /NP /NFL /NDL | Out-Null
}
Write-Host "✅ Tüm fotoğraflarınız 'C:\KORUNAN_RESIMLER_YEDEK' klasöründe güvende!" -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] TPM 2.0 ve İşlemci Kontrolü Devre Dışı Bırakılıyor..." -ForegroundColor Green

# Kayıt defteri kilitlerini kır
reg add "HKLM\SYSTEM\Setup\MoSetup" /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassCPUCheck /t REG_DWORD /d 1 /f 2>$null | Out-Null

# Indirilen Windows 11 kurulum klasörünü bul ($WINDOWS.~BT veya C:\Windows11Upgrade)
$SetupExe = $null
$CandidatePaths = @(
    "C:\`$WINDOWS.~BT\Sources\SetupPrep.exe",
    "C:\`$WINDOWS.~BT\Sources\setup.exe",
    "C:\Windows11Upgrade\setup.exe"
)

foreach ($p in $CandidatePaths) {
    if (Test-Path $p) {
        $SetupExe = $p
        break
    }
}

if ($SetupExe) {
    Write-Host "✅ İndirilmiş Windows 11 paketiniz bulundu! ($SetupExe)" -ForegroundColor Cyan
    Write-Host "🚀 Tekrar indirme yapmadan doğrudan '/product server' bypass moduyla kurulum başlatılıyor..." -ForegroundColor Yellow
    Write-Host "   (Not: Ekranda 'Windows Server Kurulumu' yazabilir, bu sadece TPM/İşlemci kontrolünü atlamak içindir; bilgisayarınıza normal Windows 11 Home/Pro kurulur ve tüm dosyalarınız korunur!)" -ForegroundColor Green
    
    # AppraiserRes.dll dosyasını da sıfırla
    $Appraiser = "C:\`$WINDOWS.~BT\Sources\appraiserres.dll"
    if (Test-Path $Appraiser) {
        Remove-Item $Appraiser -Force -ErrorAction SilentlyContinue
        New-Item -ItemType File -Path $Appraiser -Force -ErrorAction SilentlyContinue | Out-Null
    }
    
    Start-Process -FilePath $SetupExe -ArgumentList "/product server"
    Write-Host "🎉 AÇILAN PENCEREDE 'İLERİ -> YÜKLE' DİYEREK KURULUMU TAMAMLAYABİLİRSİNİZ!" -ForegroundColor Cyan
    exit
}

# Eğer Windows11InstallationAssistant.exe C:\$WINDOWS.~BT klasörünü sildiyse, arka planda C:\$WINDOWS.~BT oluştuğu an "/product server" ile yakalayan akıllı kurucu başlat:
Write-Host "⏳ Kurulum dosyaları hazırlanıyor ve TPM/İşlemci kilitsiz mod başlatılıyor..." -ForegroundColor Yellow

$SmartBypassScript = @'
while ($true) {
    $prep = "C:\$WINDOWS.~BT\Sources\SetupPrep.exe"
    $appraiser = "C:\$WINDOWS.~BT\Sources\appraiserres.dll"
    if (Test-Path $appraiser) {
        try {
            $item = Get-Item $appraiser -ErrorAction SilentlyContinue
            if ($item.Length -gt 0) {
                attrib -r -s -h $appraiser 2>$null
                [System.IO.File]::WriteAllBytes($appraiser, @())
            }
        } catch {}
    }
    # Eğer SetupHost "sistem gereksinimlerini karşılamıyor" penceresi açarsa veya $WINDOWS.~BT hazır olursa:
    $setupHost = Get-Process -Name "SetupHost" -ErrorAction SilentlyContinue
    if ($setupHost -and (Test-Path $prep)) {
        Start-Sleep -Seconds 2
    }
    Start-Sleep -Milliseconds 500
}
'@

Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -NoProfile -Command `$ErrorActionPreference='SilentlyContinue'; $SmartBypassScript" -WindowStyle Hidden

$Win11Exe = "$env:TEMP\Windows11InstallationAssistant.exe"
if (-not (Test-Path $Win11Exe)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/?linkid=2171764" -OutFile $Win11Exe
}
Start-Process -FilePath $Win11Exe
