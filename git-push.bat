@echo off
echo === Lineage AI - Git Push Script ===
cd /d "C:\Users\xiang\Lineage AI"

echo Removing git lock if exists...
if exist ".git\index.lock" del /f ".git\index.lock"

echo Staging all files...
git add -A

echo Committing...
git commit -m "feat: Firebase + LINE Bot + attendance system + Phase 4 visual redesign"

echo Pushing to GitHub...
git push origin main

echo Done!
pause
