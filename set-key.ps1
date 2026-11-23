# Asks for your OpenRouter key (typing is hidden), saves it for your Windows
# user, then runs one live test of the router. The key is never printed.

$secure = Read-Host "Paste your OpenRouter key and press Enter" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $secure).Password.Trim()

if (-not $key.StartsWith("sk-or-")) {
    Write-Host "That does not look like an OpenRouter key (it should start with sk-or-). Nothing was saved."
    return
}

[Environment]::SetEnvironmentVariable("OPENROUTER_API_KEY", $key, "User")
$env:OPENROUTER_API_KEY = $key
Write-Host "Key saved. Running a live test with Bison..."

node "$PSScriptRoot\router.mjs" "Refactor the billing module across 6 files and find out why the retry logic sometimes charges a customer twice"
