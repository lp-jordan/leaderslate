$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $root 'bin'
$output = Join-Path $outputDir 'atem-bridge.exe'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$cmdFile = Join-Path $PSScriptRoot 'build-temp.cmd'

if (-not (Test-Path $vcvars)) {
  throw "vcvars64.bat not found at $vcvars"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

@"
@echo off
call "$vcvars"
cl /nologo /EHsc /std:c++17 /O2 /Fe$output $PSScriptRoot\atem-bridge.cpp /link ole32.lib oleaut32.lib ws2_32.lib
"@ | Set-Content $cmdFile

try {
  & cmd.exe /c $cmdFile
  if ($LASTEXITCODE -ne 0) {
    throw "Bridge build failed with exit code $LASTEXITCODE"
  }
} finally {
  Remove-Item $cmdFile -ErrorAction SilentlyContinue
}
