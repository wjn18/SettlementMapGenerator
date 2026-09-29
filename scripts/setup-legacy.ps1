$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolsPath = Join-Path $projectRoot '.tools'
$lock = Get-Content -LiteralPath (Join-Path $projectRoot 'tools/legacy-harness/toolchain.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force "$toolsPath/downloads", "$toolsPath/bin", "$projectRoot/.haxelib" | Out-Null
foreach ($archive in $lock.archives) {
    $archivePath = Join-Path "$toolsPath/downloads" $archive.file
    if (!(Test-Path -LiteralPath $archivePath)) {
        & curl.exe -fL --retry 2 --max-time 180 $archive.url -o $archivePath
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $($archive.url)" }
    }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $archive.sha256) {
        throw "Archive checksum mismatch: $archivePath"
    }
    if (!(Test-Path -LiteralPath (Join-Path $toolsPath $archive.executable))) {
        Expand-Archive -LiteralPath $archivePath -DestinationPath (Join-Path $toolsPath $archive.destination) -Force
    }
}
# Only use Haxe 4's Haxelib. The Haxe 3 compiler remains the actual compiler.
Copy-Item -LiteralPath "$toolsPath/haxe/haxe_20250509143529_e0b355c/haxelib.exe" -Destination "$toolsPath/bin/haxelib.exe" -Force
$previousPath = $env:PATH
$previousLibrary = $env:HAXELIB_PATH
try {
    $env:PATH = "$toolsPath/bin;$toolsPath/haxe3/haxe_20180221160843_bb7b827a9;$toolsPath/neko/neko-2.3.0-win64;$previousPath"
    $env:HAXELIB_PATH = Join-Path $projectRoot '.haxelib'
    foreach ($library in $lock.libraries.PSObject.Properties) {
        $installed = Join-Path $env:HAXELIB_PATH "$($library.Name)/$($library.Value.Replace('.', ','))/haxelib.json"
        if (!(Test-Path -LiteralPath $installed)) {
            & haxelib install $library.Name $library.Value --always --quiet
            if ($LASTEXITCODE -ne 0) { throw "Haxelib install failed: $($library.Name)" }
        }
    }
    & haxe -version
    if ($LASTEXITCODE -ne 0) { throw 'Haxe compiler could not start.' }
    & haxelib version
    if ($LASTEXITCODE -ne 0) { throw 'Haxelib could not start.' }
    & neko -version
    if ($LASTEXITCODE -ne 0) { throw 'Neko could not start.' }
} finally {
    $env:PATH = $previousPath
    $env:HAXELIB_PATH = $previousLibrary
}
