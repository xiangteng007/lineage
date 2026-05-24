@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  Lineage AI - Go Live  (merge deep-dev-golive into main)
echo ============================================================
echo.

echo [1/8] Clearing any stale git lock...
if exist ".git\index.lock" del /f /q ".git\index.lock"

echo [2/8] Fetching latest from origin...
git fetch origin
if errorlevel 1 goto :err

echo [3/8] Reset to clean known state (deep-dev-golive)...
git checkout -f deep-dev-golive
if errorlevel 1 goto :err

echo [4/8] Aligning local main with origin/main...
git branch -f main origin/main
git checkout main
if errorlevel 1 goto :err

echo [5/8] Merging our complete build into main (no auto-commit)...
git merge --no-ff --no-commit deep-dev-golive

echo [6/8] Resolving the 5 shared files in favour of our version...
git checkout deep-dev-golive -- .env.example public/app.js public/index.html server.js vercel.json

echo [7/8] Committing the merge...
git add -A
git commit -m "merge: adopt comprehensive deep-dev build as production (keep remote LIFF attend page)"
if errorlevel 1 goto :err

echo [8/8] Pushing to origin/main  (Vercel will auto-deploy)...
git push origin main
if errorlevel 1 goto :err

echo.
echo ============================================================
echo  DONE. main updated and pushed. Vercel is now deploying.
echo ============================================================
goto :end

:err
echo.
echo *** A step failed. Copy everything above and send it to me. ***

:end
echo.
pause
