param(
  [Parameter(Mandatory=$true)][string]$DbUrl,
  [string]$Destination = (Join-Path $HOME "TsysOptics-Backups")
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { throw "Instala Supabase CLI antes de comenzar." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Instala Docker Desktop antes de comenzar." }
$null = docker info 2>$null
if ($LASTEXITCODE -ne 0) { throw "Inicia Docker Desktop y vuelve a ejecutar." }
if ($DbUrl -notmatch '^postgres(ql)?://') { throw "DbUrl debe ser una URL de PostgreSQL." }
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$folder=Join-Path $Destination $stamp
New-Item -ItemType Directory -Path $folder -Force | Out-Null
# Evitar colocar credenciales en el archivo de salida o mensajes de error.
try {
  & supabase db dump --db-url $DbUrl --role-only --file (Join-Path $folder "roles.sql")
  if ($LASTEXITCODE -ne 0) { throw "Fallo al exportar roles." }
  & supabase db dump --db-url $DbUrl --file (Join-Path $folder "schema.sql")
  if ($LASTEXITCODE -ne 0) { throw "Fallo al exportar esquema." }
  & supabase db dump --db-url $DbUrl --data-only --use-copy --file (Join-Path $folder "data.sql")
  if ($LASTEXITCODE -ne 0) { throw "Fallo al exportar datos." }
  $files = @("roles.sql","schema.sql","data.sql") | ForEach-Object { Get-Item (Join-Path $folder $_) }
  if (@($files | Where-Object Length -eq 0).Count -gt 0) { throw "Se detecto un archivo vacio." }
  $files | Get-FileHash -Algorithm SHA256 | Select-Object @{Name="Archivo";Expression={Split-Path $_.Path -Leaf}},Hash | Export-Csv (Join-Path $folder "SHA256.csv") -NoTypeInformation -Encoding UTF8
  Write-Host "Exportacion completada. Archivos y hashes: $folder"
  Write-Warning "NO se ha probado restauracion. Verifica cifrado, Auth, Storage y copia fuera del equipo."
} catch {
  Write-Error "La exportacion no fue completada. Revisa Docker, conectividad y permisos. Verifica/elimina archivos parciales: $folder"
  exit 1
}
