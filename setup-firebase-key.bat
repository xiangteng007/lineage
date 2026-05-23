@echo off
echo === Firebase Admin Key Setup ===
echo.

REM Find the most recently downloaded Firebase service account JSON
set DOWNLOADS=%USERPROFILE%\Downloads
set FOUND=

for /f "delims=" %%F in ('dir /b /o-d "%DOWNLOADS%\lineage-b0156-firebase-adminsdk*.json" 2^>nul') do (
  if not defined FOUND set FOUND=%%F
)

if not defined FOUND (
  echo [ERROR] Could not find lineage-b0156-firebase-adminsdk*.json in Downloads folder.
  echo Please make sure the file was downloaded from Firebase Console.
  pause
  exit /b 1
)

echo Found: %FOUND%
echo.

REM Copy the file to the Lineage AI folder as serviceAccountKey.json
copy "%DOWNLOADS%\%FOUND%" "%~dp0serviceAccountKey.json" >nul
echo [OK] Copied to serviceAccountKey.json (for local development)
echo.

REM Copy the JSON content to clipboard for pasting into Vercel
type "%DOWNLOADS%\%FOUND%" | clip
echo [OK] JSON content copied to clipboard!
echo.
echo ============================================
echo Next step:
echo  1. Go to: https://vercel.com/xxts-projects-ef5b1ba3/lineage/settings/environment-variables
echo  2. Click "Add Environment Variable"
echo  3. Name:  FIREBASE_SERVICE_ACCOUNT_JSON
echo  4. Value: Ctrl+V (already in clipboard)
echo  5. Click Save, then Redeploy
echo ============================================
echo.

REM Open Vercel env vars page in Chrome
start "" "https://vercel.com/xxts-projects-ef5b1ba3/lineage/settings/environment-variables"

pause
