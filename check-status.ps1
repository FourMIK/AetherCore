#!/usr/bin/env pwsh
# Quick Dashboard and Telemetry Check

Write-Host "`nAetherCore Status Check" -ForegroundColor Cyan
Write-Host "=====================`n" -ForegroundColor Cyan

cd C:\Users\Owner\StudioProjects\AetherCore\infra\docker

Write-Host "Backend Services:" -ForegroundColor Yellow
docker compose ps

Write-Host "`nGateway Telemetry (last 20 lines):" -ForegroundColor Yellow
docker compose logs gateway --tail 20 | Select-String "Telemetry|node_id"

Write-Host "`n`nTo monitor live:" -ForegroundColor Cyan
Write-Host "docker compose logs -f gateway`n" -ForegroundColor White

