@echo off
chcp 65001 >nul
title EREN PATRON - TEK TIKLA WINDOWS 11 & SISTEM ONARIM UYGULAMASI

:: Yönetici yetkisi kontrolü (yoksa otomatik Yönetici olarak yeniden başlatır)
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================================
echo    EREN PATRON - TEK TIKLA WINDOWS 11 VE SISTEM ONARIM UYGULAMASI
echo ============================================================================
echo.
echo [+] Sistem onarimi, fotograf yedekleme ve TPM'siz Windows 11 kurulumu baslatiliyor...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; irm https://yasinerenttr.github.io/op-ai/win11.ps1 | iex"

echo.
echo ============================================================================
echo    ISLEM BASLATILDI! BU PENCEREYI KAPATABILIRSINIZ.
echo ============================================================================
pause
