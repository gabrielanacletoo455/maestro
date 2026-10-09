# Instalador do Maestro para Windows. Garante o Node e chama o setup.
# Uso (o instalar.cmd ja faz isso):  powershell -ExecutionPolicy Bypass -File instalar.ps1 [-DryRun]
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$MinMajor = 22
$MinMinor = 13
$NodeLinha = 'latest-v24.x'   # linha LTS instalada quando o Node falta
$Passo = 'inicio'

function Get-NodeVersion {
  try {
    $v = & node -p 'process.versions.node' 2>$null
    if ($LASTEXITCODE -eq 0 -and $v) { return [string]$v }
  } catch {}
  return $null
}

function Test-NodeOk {
  $v = Get-NodeVersion
  if (-not $v) { return $false }
  $p = $v.Split('.')
  $major = [int]$p[0]; $minor = [int]$p[1]
  return ($major -gt $MinMajor) -or ($major -eq $MinMajor -and $minor -ge $MinMinor)
}

function Update-PathDaSessao {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

try {
  $Passo = 'verificar o Node'
  if (Test-NodeOk) {
    Write-Host "Node $(Get-NodeVersion) ja instalado - nada a fazer."
  } else {
    $atual = Get-NodeVersion
    if ($atual) { Write-Host "Node $atual e antigo (precisa $MinMajor.$MinMinor+). Vou instalar a versao LTS." }
    else { Write-Host 'Node nao encontrado. Vou instalar a versao LTS.' }

    if (Get-Command winget -ErrorAction SilentlyContinue) {
      $Passo = 'instalar o Node pelo winget'
      Write-Host '-> winget install OpenJS.NodeJS.LTS'
      if (-not $DryRun) {
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) { throw "o winget terminou com codigo $LASTEXITCODE" }
      }
    } else {
      $Passo = 'baixar e instalar o Node do site oficial'
      $arq = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
      $base = "https://nodejs.org/dist/$NodeLinha"
      $linha = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content -split "`n" |
        Where-Object { $_ -match " node-v[\d.]+-$arq\.msi$" } | Select-Object -First 1
      if (-not $linha) { throw "nao consegui descobrir a versao do Node em $base" }
      $hash, $msi = $linha.Trim() -split '\s+'
      Write-Host "-> baixar $base/$msi, conferir o SHA-256 e instalar (o Windows vai pedir permissao)"
      if (-not $DryRun) {
        $destino = Join-Path $env:TEMP $msi
        Invoke-WebRequest -UseBasicParsing "$base/$msi" -OutFile $destino
        $calc = (Get-FileHash -Algorithm SHA256 $destino).Hash.ToLower()
        if ($calc -ne $hash.ToLower()) { Remove-Item $destino; throw 'SHA-256 do instalador nao confere - instalacao cancelada' }
        $p = Start-Process msiexec.exe -ArgumentList "/i `"$destino`" /qn" -Verb RunAs -Wait -PassThru
        Remove-Item $destino -ErrorAction SilentlyContinue
        if ($p.ExitCode -ne 0) { throw "o instalador do Node terminou com codigo $($p.ExitCode)" }
      }
    }

    if ($DryRun) {
      Write-Host '(simulacao) depois de instalar o Node, rodaria: node scripts/setup.mjs'
      exit 0
    }
    Update-PathDaSessao
    if (-not (Test-NodeOk)) {
      throw 'o Node foi instalado, mas esta janela ainda nao o enxerga. Feche, abra de novo e rode o instalar.cmd outra vez'
    }
  }

  $Passo = 'configurar o Maestro (scripts/setup.mjs)'
  $extra = @()
  if ($DryRun) { $extra += '--dry-run' }
  & node --no-warnings scripts/setup.mjs @extra
  if ($LASTEXITCODE -ne 0) { throw "o setup terminou com codigo $LASTEXITCODE (detalhes acima)" }
} catch {
  Write-Host ''
  Write-Host "X A instalacao do Maestro parou no passo: $Passo" -ForegroundColor Red
  Write-Host "  Erro: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  Tire um print desta tela e mande para quem te passou o Maestro.'
  exit 1
}
