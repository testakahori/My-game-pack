param(
    [Parameter(Mandatory=$true)][string]$Libraries,
    [string]$Java = 'java'
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$libraryRoot = (Resolve-Path -LiteralPath $Libraries).Path
$forgeArgs = Get-ChildItem -LiteralPath (Join-Path $libraryRoot 'net\minecraftforge\forge') -Recurse -Filter win_args.txt | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $forgeArgs) { throw 'Forgeのwin_args.txtが見つかりません。' }
$eula = Join-Path (Split-Path $libraryRoot -Parent) 'eula.txt'
if (-not (Test-Path -LiteralPath $eula) -or -not (Select-String -LiteralPath $eula -Pattern '^eula=true$' -Quiet)) { throw '既存のテスト用サーバーのeula.txtを確認してください。' }
$testRoot = Join-Path $repoRoot ('UmetateMod\run-server\lab-probe-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $testRoot 'mods') -Force | Out-Null
$pushed = $false
# ジャンクションを作ったあとの写し（jar・マップ）で失敗しても、finally で外せるよう、作る所から try の中に入れる（最後のレビュー 重要2）。
try {
    # 既存ライブラリは読み取りだけ。テスト対象は完成MAPの別コピー。
    New-Item -ItemType Junction -Path (Join-Path $testRoot 'libraries') -Target $libraryRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'map\umetate_lab_map') -Destination (Join-Path $testRoot 'world') -Recurse
    Copy-Item -LiteralPath $eula -Destination (Join-Path $testRoot 'eula.txt')
    foreach ($mod in @('BridgeMod','UmetateMod')) {
        $props = Get-Content -LiteralPath (Join-Path $repoRoot ($mod + '\gradle.properties')) -Raw
        $id = [regex]::Match($props, '(?m)^mod_id=(.+)\r?$').Groups[1].Value.Trim()
        $version = [regex]::Match($props, '(?m)^mod_version=(.+)\r?$').Groups[1].Value.Trim()
        Copy-Item -LiteralPath (Join-Path $repoRoot ($mod + '\build\libs\' + $id + '-' + $version + '.jar')) -Destination (Join-Path $testRoot 'mods')
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'UmetateMod\build\qa\umetate-lab-probe.jar') -Destination (Join-Path $testRoot 'mods')
    @('server-ip=127.0.0.1','server-port=25649','level-name=world','online-mode=false','enable-command-block=true','enable-rcon=false','view-distance=2','simulation-distance=3','allow-flight=true','max-tick-time=-1') | Set-Content -LiteralPath (Join-Path $testRoot 'server.properties') -Encoding ascii
    $relativeArgs = 'libraries/' + $forgeArgs.FullName.Substring($libraryRoot.Length + 1).Replace('\','/')
    Push-Location -LiteralPath $testRoot
    $pushed = $true
    & $Java '-Xms512M' '-Xmx2G' '-Dumetate.lab.probe=true' '-Dbridgemod.bridgePort=18649' ('@' + $relativeArgs) nogui *> lab-server.log
    $result = if (Test-Path -LiteralPath 'lab-probe-result.txt') { Get-Content -LiteralPath 'lab-probe-result.txt' -Raw } else { 'FAIL: 結果ファイルなし' }
    Write-Output $testRoot
    Write-Output $result
    if (-not $result.StartsWith('PASS:')) { Get-Content lab-server.log -Tail 35; throw $result }
} finally {
    if ($pushed) { Pop-Location }
    # 使い捨てのフォルダー（ログ・結果）は調べるために残すが、libraries のジャンクションは外す。
    # 残すと、フォルダーをまとめて消したときに、先の libraries（本物のサーバーのもの）まで消えるおそれがある。
    $link = Join-Path $testRoot 'libraries'
    $item = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType -eq 'Junction') {
        # ジャンクションそのものだけを外す。先の中身には触らない。
        [IO.Directory]::Delete($link, $false)
        Write-Output ('libraries のジャンクションを外しました: ' + $link)
    }
}
