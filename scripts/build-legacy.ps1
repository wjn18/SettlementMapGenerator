param([switch]$Instrumented)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$compilerPath = Join-Path $projectRoot '.tools/haxe3/haxe_20180221160843_bb7b827a9'
$managerPath = Join-Path $projectRoot '.tools/bin'
$runtimePath = Join-Path $projectRoot '.tools/neko/neko-2.3.0-win64'
foreach ($file in @("$compilerPath/haxe.exe", "$managerPath/haxelib.exe", "$runtimePath/neko.exe")) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing $file. Run scripts/setup-legacy.ps1 first." }
}
$previousPath = $env:PATH
$previousLibrary = $env:HAXELIB_PATH
$previousConfig = $env:LIME_CONFIG
try {
    # Modern Haxelib MUST precede the compiler's old Haxelib (MSVCR120 dependency).
    $env:PATH = "$managerPath;$compilerPath;$runtimePath;$previousPath"
    $env:HAXELIB_PATH = Join-Path $projectRoot '.haxelib'
    $env:LIME_CONFIG = Join-Path $projectRoot '.tools/lime-config.xml'
    Set-Content -LiteralPath $env:LIME_CONFIG -Value '<config />'
    Push-Location $projectRoot
    try {
        $prepareArgs = @('scripts/prepare-legacy.mjs')
        if ($Instrumented) { $prepareArgs += '--instrumented' }
        & node @prepareArgs
        if ($LASTEXITCODE -ne 0) { throw 'Reference preparation failed.' }
        $target = if ($Instrumented) { 'legacy-instrumented' } else { 'legacy-original' }
        $javascript = Join-Path $projectRoot "artifacts/$target/Export/html5/bin/TownGenerator.js"
        # Never accept a stale successful output after a failed rebuild.
        if (Test-Path -LiteralPath $javascript) { Remove-Item -LiteralPath $javascript }
        & haxelib run lime build "artifacts/$target/project.xml" html5 -debug
        if ($LASTEXITCODE -ne 0) { throw "Legacy build failed: $LASTEXITCODE" }
        if (!(Test-Path -LiteralPath "artifacts/$target/Export/html5/bin/TownGenerator.js")) { throw 'Build did not produce JavaScript.' }
    } finally { Pop-Location }
} finally {
    $env:PATH = $previousPath
    $env:HAXELIB_PATH = $previousLibrary
    $env:LIME_CONFIG = $previousConfig
}
