# Puts the Supabase anon public key from the clipboard into config.js and publishes it.
# Use: copy the "anon public" key in Supabase (Project Settings > API Keys > Legacy), then run this.
$ErrorActionPreference = 'Stop'
$key = (Get-Clipboard -Raw).Trim()
if (-not ($key.StartsWith('eyJ') -or $key.StartsWith('sb_publishable_'))) { Write-Host 'The clipboard does not hold an anon public key. Nothing changed.'; exit 1 }
$parts = $key.Split('.')
if ($key.StartsWith('eyJ')) {
  $p = $parts[1].Replace('-', '+').Replace('_', '/'); while ($p.Length % 4) { $p += '=' }
  $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
  if ($claims.role -ne 'anon') { Write-Host 'That is NOT the anon key (it would expose your database). Nothing changed.'; exit 1 }
}
$cfg = Join-Path $PSScriptRoot 'config.js'
$text = [IO.File]::ReadAllText($cfg)
$text = [Regex]::Replace($text, "export const SUPABASE_ANON_KEY = '[^']*';", "export const SUPABASE_ANON_KEY = '$key';")
[IO.File]::WriteAllText($cfg, $text)
Set-Location $PSScriptRoot
git add config.js; git commit -q -m 'Connect the app to Supabase'; git push -q
Write-Host 'Done. The app is connected; give GitHub about a minute to publish.'
