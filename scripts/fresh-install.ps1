$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$targetRoot = Join-Path $sourceRoot ('data/fresh-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $targetRoot | Out-Null
# Explicit source allowlist: no secrets, databases, screenshots of private evidence, build output or dependencies.
foreach ($name in @('src','public','docs','scripts','tests','package.json','package-lock.json','next.config.ts','next-env.d.ts','tsconfig.json','playwright.config.ts','README.md','LICENSE','.env.example','.gitignore','PRODUCT_BRIEF.md','PRODUCT.md','DESIGN.md','IMPLEMENTATION_PLAN.md','AGENTS.md')) {
  $sourcePath = Join-Path $sourceRoot $name
  if (Test-Path -LiteralPath $sourcePath) { Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $targetRoot $name) -Recurse }
}
if (Test-Path -LiteralPath (Join-Path $targetRoot '.env.local')) { throw 'Fresh setup must not contain local credentials' }
Write-Output $targetRoot
