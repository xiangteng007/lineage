Write-Host "Deploying Lineage AI Tactical Terminal to Google Cloud Run..." -ForegroundColor Cyan

Write-Host "Deploying Lineage AI Tactical Terminal to Google Cloud Run (Project: lineage-ai-tactical)..." -ForegroundColor Cyan

gcloud run deploy lineage-ai-tactical `
  --source . `
  --region asia-east1 `
  --project lineage-ai-tactical `
  --allow-unauthenticated `
  --platform managed

if ($LASTEXITCODE -eq 0) {
    Write-Host "Deployment completed successfully!" -ForegroundColor Green
    Write-Host "Environment variables will be injected automatically via gcloud or can be set in the Cloud Run Console." -ForegroundColor Yellow
} else {
    Write-Host "Deployment failed. Please check the logs." -ForegroundColor Red
}
