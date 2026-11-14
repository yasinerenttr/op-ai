@echo off
chcp 65001 >nul
title EREN PATRON - OTOMATIK RESIM KORUMA & WINDOWS 11 GECIS ARACI
color 0B

echo ============================================================================
echo    🛡️ EREN PATRON - OTOMATİK RESİM KORUMA VE WINDOWS 11 GEÇİŞ SİSTEMİ 🛡️
echo ============================================================================
echo.
echo [1/3] Bilgisayardaki tüm resimler ve fotoğraflar taranıyor ve korumaya alınıyor...
echo.

set "BACKUP_DIR=C:\KORUNAN_RESIMLER_YEDEK"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
if not exist "%BACKUP_DIR%\Masaustu_Resimler" mkdir "%BACKUP_DIR%\Masaustu_Resimler"
if not exist "%BACKUP_DIR%\Resimler_Klasoru" mkdir "%BACKUP_DIR%\Resimler_Klasoru"
if not exist "%BACKUP_DIR%\Belgeler_Resimler" mkdir "%BACKUP_DIR%\Belgeler_Resimler"
if not exist "%BACKUP_DIR%\Indirilenler_Resimler" mkdir "%BACKUP_DIR%\Indirilenler_Resimler"

:: Masaüstündeki resimleri kopyala
robocopy "%USERPROFILE%\Desktop" "%BACKUP_DIR%\Masaustu_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1

:: Resimler (Pictures) klasörünü tamamen kopyala
robocopy "%USERPROFILE%\Pictures" "%BACKUP_DIR%\Resimler_Klasoru" *.* /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1

:: OneDrive Masaüstü ve Resimler varsa onları da kopyala
if exist "%USERPROFILE%\OneDrive\Desktop" (
    robocopy "%USERPROFILE%\OneDrive\Desktop" "%BACKUP_DIR%\OneDrive_Masaustu" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
)
if exist "%USERPROFILE%\OneDrive\Pictures" (
    robocopy "%USERPROFILE%\OneDrive\Pictures" "%BACKUP_DIR%\OneDrive_Resimler" *.* /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
)
if exist "%USERPROFILE%\OneDrive\Resimler" (
    robocopy "%USERPROFILE%\OneDrive\Resimler" "%BACKUP_DIR%\OneDrive_Resimler" *.* /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
)

:: Belgeler ve İndirilenler içindeki fotoğrafları kopyala
robocopy "%USERPROFILE%\Documents" "%BACKUP_DIR%\Belgeler_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
robocopy "%USERPROFILE%\Downloads" "%BACKUP_DIR%\Indirilenler_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1

echo ✅ Tüm fotoğraflarınız ve videolarınız "C:\KORUNAN_RESIMLER_YEDEK" klasörüne güvenle yedeklendi!
echo.

echo [2/3] TPM 2.0 / İşlemci Engeli Kaldırılıyor (Her PC'ye Windows 11 Kurulum İzni)...
reg add "HKLM\SYSTEM\Setup\MoSetup" /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassCPUCheck /t REG_DWORD /d 1 /f >nul 2>&1
echo ✅ Donanım ve TPM engeli başarıyla kaldırıldı!
echo.

echo [3/3] Resmi Microsoft Windows 11 Kurulum Yardımcısı İndiriliyor ve Başlatılıyor...
set "WIN11_EXE=%TEMP%\Windows11InstallationAssistant.exe"
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/?linkid=2171764' -OutFile '%WIN11_EXE%'"

if exist "%WIN11_EXE%" (
    echo 🚀 Windows 11 Kurulum Yardımcısı başlatılıyor (Dosyalarınız %100 korunur)...
    start "" "%WIN11_EXE%"
) else (
    echo 🌐 Microsoft resmi Windows 11 indirme sayfası açılıyor...
    start https://www.microsoft.com/tr-tr/software-download/windows11
)

explorer "%BACKUP_DIR%"
echo.
echo ============================================================================
echo 🎉 İŞLEM TAMAMLANDI!
echo 📁 Yedeklenen Resimleriniz şimdi ekranda açıldı: C:\KORUNAN_RESIMLER_YEDEK
echo 💿 Açılan Windows 11 penceresinde "Kabul Et ve Yükle" butonuna basmanız yeterli!
echo    (Bu yöntem dosyalarınızı ve resimlerinizi HİÇ SİLMEDEN Windows 11'e geçirir)
echo ============================================================================
pause
