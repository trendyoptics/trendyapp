# TsysOptics - respaldo manual de SOLO LECTURA (Supabase Free)
# Requisitos: Supabase CLI, Docker Desktop iniciado, "supabase login" y
# "supabase link --project-ref rzeqdhddbmxcpyzssuod" desde el directorio de trabajo.
# Nunca pegar ni guardar contrasenas o cadenas de conexion en este script.
param(
  [string]$Destination = (Join-Path $HOME "TsysOptics-Backups")
)
$ErrorActionPreference = "Stop"
$expectedProject = "rzeqdhddbmxcpyzssuod"
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { throw "No se encuentra Supabase CLI." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "No se encuentra Docker Desktop." }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop no esta iniciado." }

# No adivinar proyectos: exige proyecto vinculado y valida la referencia.
$configFile = Join-Path (Get-Location) "supabase\.temp\project-ref"
if (-not (Test-Path -LiteralPath $configFile)) {
  throw "Proyecto no vinculado en esta carpeta. Ejecuta: supabase login; supabase link --project-ref $expectedProject"
}
$actualProject = (Get-Content -LiteralPath $configFile -Raw).Trim()
if ($actualProject -ne $expectedProject) { throw "Proyecto incorrecto vinculado. No se realizo respaldo." }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$folder = Join-Path $Destination $stamp
New-Item -ItemType Directory -Path $folder -Force | Out-Null
try {
  # Los comandos --linked son lecturas. No incluyen db reset, db push ni imports.
  & supabase db dump --linked --role-only --file (Join-Path $folder "roles.sql")
  if ($LASTEXITCODE -ne 0) { throw "No se pudo exportar roles." }
  & supabase db dump --linked --file (Join-Path $folder "schema.sql")
  if ($LASTEXITCODE -ne 0) { throw "No se pudo exportar esquema." }
  & supabase db dump --linked --data-only --use-copy --file (Join-Path $folder "data.sql")
  if ($LASTEXITCODE -ne 0) { throw "No se pudo exportar datos." }

  $files = @("roles.sql","schema.sql","data.sql") | ForEach-Object {
    Get-Item -LiteralPath (Join-Path $folder $_)
  }
  if (@($files | Where-Object { $_.Length -le 0 }).Count -gt 0) {
    throw "Hay archivos vacios. El respaldo NO se considera completo."
  }
  $files | Get-FileHash -Algorithm SHA256 |
    Select-Object @{Name="Archivo";Expression={Split-Path $_.Path -Leaf}},Hash |
    Export-Csv -LiteralPath (Join-Path $folder "SHA256.csv") -NoTypeInformation -Encoding UTF8
  $files | Select-Object Name,Length | Format-Table
  Write-Host "RESPALDO GENERADO: $folder"
  Write-Warning "Sin restauracion probada. Cifra la carpeta y copia a almacenamiento externo."
  Write-Warning "NO incluye objetos de Storage ni garantiza recuperar usuarios de Auth."
} catch {
  Write-Warning "Respaldo INCOMPLETO. Los archivos parciales estan en: $folder"
  throw
}
