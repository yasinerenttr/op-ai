@echo off
title EREN PATRON - WINDOWS 11 KURULUMU

echo ============================================================================
echo    EREN PATRON - WINDOWS 11 VE SISTEM ONARIM UYGULAMASI
echo ============================================================================
echo.
echo [1/4] Windows Lisans ve WMI Servisleri Onariliyor...
winmgmt /salvagerepository >nul 2>&1
net start winmgmt >nul 2>&1
net start sppsvc >nul 2>&1
net start ClipSVC >nul 2>&1

echo [2/4] Fotograflar C:\KORUNAN_RESIMLER_YEDEK klasorunde guvende!
if not exist "C:\KORUNAN_RESIMLER_YEDEK" (
    mkdir "C:\KORUNAN_RESIMLER_YEDEK\Masaustu_Resimler" >nul 2>&1
    mkdir "C:\KORUNAN_RESIMLER_YEDEK\Resimler_Klasoru" >nul 2>&1
    robocopy "%USERPROFILE%\Desktop" "C:\KORUNAN_RESIMLER_YEDEK\Masaustu_Resimler" *.jpg *.jpeg *.png *.heic *.webp *.gif *.bmp *.mp4 *.mov /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
    robocopy "%USERPROFILE%\Pictures" "C:\KORUNAN_RESIMLER_YEDEK\Resimler_Klasoru" *.* /S /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
)

echo [3/4] TPM 2.0 ve Islemci Kilitleri Kaldiriliyor...
reg add "HKLM\SYSTEM\Setup\MoSetup" /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SYSTEM\Setup\LabConfig" /v BypassCPUCheck /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\PCHC" /v UpgradeEligibility /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Microsoft\PCHC" /v UpgradeEligibility /t REG_DWORD /d 1 /f >nul 2>&1

if exist "C:\Win11_Kurulum\Sources\SetupPrep.exe" (
    echo [!] Hazir Windows 11 kurulum dosyalari bulundu! Hemen baslatiliyor...
    taskkill /F /IM Windows11InstallationAssistant.exe >nul 2>&1
    taskkill /F /IM Windows10UpgraderApp.exe >nul 2>&1
    taskkill /F /IM SetupHost.exe >nul 2>&1
    start "" "C:\Win11_Kurulum\Sources\SetupPrep.exe" /product server
    goto :DONE
)

if exist "C:\$WINDOWS.~BT\Sources\SetupPrep.exe" (
    echo [!] Indirilmis Windows 11 dosyalari yakalandi! Silinmemesi icin C:\Win11_Kurulum klasorune kopyalaniyor...
    taskkill /F /IM Windows11InstallationAssistant.exe >nul 2>&1
    taskkill /F /IM Windows10UpgraderApp.exe >nul 2>&1
    taskkill /F /IM SetupHost.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
    robocopy "C:\$WINDOWS.~BT" "C:\Win11_Kurulum" /E /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
    attrib -r -s -h "C:\Win11_Kurulum\Sources\appraiserres.dll" >nul 2>&1
    break > "C:\Win11_Kurulum\Sources\appraiserres.dll"
    echo [+] Simdi TPM 2.0 ve Islemci kontrolu kapali olarak Windows 11 kurulumu aciliyor!
    start "" "C:\Win11_Kurulum\Sources\SetupPrep.exe" /product server
    goto :DONE
)

echo [4/4] Windows 11 Kurulum Asistani indiriliyor ve baslatiliyor...
if not exist "%TEMP%\Windows11InstallationAssistant.exe" (
    curl.exe -L -s -o "%TEMP%\Windows11InstallationAssistant.exe" "https://go.microsoft.com/fwlink/?linkid=2171764"
)
start "" "%TEMP%\Windows11InstallationAssistant.exe"

echo.
echo [+] NOBETCI AKTIF: Bu siyah pencereyi KAPATMAYIN!
echo     Kurulum Asistani dosyalari indirdigi an (%75 civari), bu pencere
echo     otomatik devreye girip TPM ve Islemci hatasini engelleyecek!
echo.

:LOOP
timeout /t 2 /nobreak >nul
if exist "C:\$WINDOWS.~BT\Sources\SetupPrep.exe" (
    if exist "C:\$WINDOWS.~BT\Sources\install.esd" (
        tasklist /FI "IMAGENAME eq SetupHost.exe" 2>NUL | find /I /N "SetupHost.exe">NUL
        if "%ERRORLEVEL%"=="0" (
            echo [!] Dosyalar hazir! Kurulum Asistani durdurulup TPM'siz kurulum baslatiliyor...
            taskkill /F /IM SetupHost.exe >nul 2>&1
            taskkill /F /IM SetupPrep.exe >nul 2>&1
            taskkill /F /IM Windows11InstallationAssistant.exe >nul 2>&1
            taskkill /F /IM Windows10UpgraderApp.exe >nul 2>&1
            timeout /t 2 /nobreak >nul
            robocopy "C:\$WINDOWS.~BT" "C:\Win11_Kurulum" /E /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
            attrib -r -s -h "C:\Win11_Kurulum\Sources\appraiserres.dll" >nul 2>&1
            break > "C:\Win11_Kurulum\Sources\appraiserres.dll"
            start "" "C:\Win11_Kurulum\Sources\SetupPrep.exe" /product server
            goto :DONE
        )
    )
)
goto :LOOP

:DONE
echo.
echo ============================================================================
echo    WINDOWS 11 KURULUM EKRANI ACILDI! ILERI -> YUKLE DIYEBILIRSINIZ.
echo ============================================================================
pause
