Create your account
Or sign in to existing account

CSRF token is missing
Email address
fiza8983khan@gmail.com
Password
••••••••
Confirm Password
••••••••
Create account
# PowerShell Script to Check for Secrets Before Push

Write-Host "🔍 Checking for sensitive files..." -ForegroundColor Yellow
Write-Host ""

# Files that should NOT be in git
$sensitiveFiles = @(
    "backend\.env",
    ".env.render",
    ".env.railway",
    ".env.production"
)

$foundSensitive = $false

foreach ($file in $sensitiveFiles) {
    if (git ls-files --error-unmatch $file 2>$null) {
        Write-Host "❌ DANGER: $file is tracked by git!" -ForegroundColor Red
        $foundSensitive = $true
    } else {
        Write-Host "✅ $file is NOT tracked (safe)" -ForegroundColor Green
    }
}

Write-Host ""

if ($foundSensitive) {
    Write-Host "⚠️  STOP! Remove sensitive files before pushing:" -ForegroundColor Red
    Write-Host "   git rm --cached backend/.env" -ForegroundColor Yellow
    Write-Host "   git rm --cached .env.render" -ForegroundColor Yellow
    Write-Host "   git rm --cached .env.railway" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "✅ All clear! Safe to push to GitHub" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  git add ." -ForegroundColor White
    Write-Host "  git commit -m 'Your message'" -ForegroundColor White
    Write-Host "  git push" -ForegroundColor White
}
