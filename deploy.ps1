param(
    [string]$Server = 'root@vee-app.co.il',
    [string]$Branch = 'main',
    [string]$CommitMessage = 'Update Ball Coaster',
    [switch]$SkipGithub,
    [switch]$ValidateOnly
)

# Local checks, commit, push to GitHub, then deploy exactly that commit — like Seder.
# The server receives a git archive of HEAD, so what is live is always a commit you can return to.

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ($Server -notmatch '^[a-zA-Z0-9_.@-]+$') { throw 'Invalid server.' }
if ($Branch -notmatch '^[a-zA-Z0-9_/-]+$') { throw 'Invalid branch.' }
$siteUrl = 'https://lawebs.co.il/ball-coaster'
$archive = $null

function Check-Exit([string]$Message) { if ($LASTEXITCODE -ne 0) { throw $Message } }

try {
    Write-Host '[INFO] Validating Ball Coaster locally...'
    $nodeVersion = [version]((& node --version).TrimStart('v'))
    Check-Exit 'Node.js is unavailable.'
    if ($nodeVersion -lt [version]'20.6.0') { throw 'Node.js 20.6 or newer is required.' }
    $scripts = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src'), (Join-Path $projectRoot 'tools') -File | Where-Object { $_.Extension -in '.js', '.mjs' }) + @(Get-Item -LiteralPath (Join-Path $projectRoot 'serve.cjs'))
    foreach ($script in $scripts) { & node --check $script.FullName; Check-Exit "Syntax error in $($script.Name)." }
    # imports resolve, and the real physics engine still carries every ball to a goal
    & node tools/check.mjs; Check-Exit 'Pre-deploy check failed.'
    if ([IO.File]::ReadAllText((Join-Path $projectRoot 'deploy_linux.sh')).Contains("`r")) { throw 'deploy_linux.sh must use LF line endings.' }
    & git diff --check; Check-Exit 'Whitespace errors in the working tree.'
    if ($ValidateOnly) { Write-Host '[SUCCESS] Validation passed. Nothing was published.'; return }

    $currentBranch = (& git branch --show-current).Trim(); Check-Exit 'Cannot read Git branch.'
    if ($currentBranch -ne $Branch) { throw "Run from branch $Branch; current branch is $currentBranch." }
    $origin = (& git remote 2>$null) -contains 'origin'
    $pushToGithub = $origin -and !$SkipGithub
    if (!$origin -and !$SkipGithub) {
        Write-Warning 'No GitHub remote (origin) is set. The release is committed locally only. Add it with: git remote add origin <url>'
    }
    if ($pushToGithub) {
        # an empty repository has no branch yet: the first push creates it, nothing to compare
        $remoteHead = & git ls-remote --heads origin $Branch; Check-Exit 'Cannot reach GitHub.'
        if ($remoteHead) {
            & git fetch origin $Branch; Check-Exit 'Cannot fetch GitHub.'
            & git merge-base --is-ancestor "origin/$Branch" HEAD
            Check-Exit 'GitHub contains changes missing locally. Merge them before deploying; no force push was attempted.'
        }
    }

    # secrets never go into Git: environment files, keys, or a bridge key pasted into code
    $secretPaths = & git ls-files -- '.env' '.env.production' '.env.*.local' '*.pem' '*.key'
    if ($secretPaths) { throw 'Secret files are tracked. Remove them from Git before publishing.' }
    & git add --all; Check-Exit 'Could not stage the release.'
    & git grep --cached -l -E 'Signal-Key "[0-9a-fA-F]{64}"' 2>$null
    if ($LASTEXITCODE -eq 0) { throw 'A visitor signal key is hard-coded in a staged file. It belongs in /root/.visitor-signal-key on the server.' }
    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 1) { & git commit -m $CommitMessage; Check-Exit 'Could not commit the release.' }
    elseif ($LASTEXITCODE -ne 0) { throw 'Could not inspect staged changes.' }
    $commit = (& git rev-parse HEAD).Trim(); Check-Exit 'Could not read release commit.'
    if ($pushToGithub) { & git push -u origin "HEAD:$Branch"; Check-Exit 'GitHub push failed; production was not changed.' }

    $releaseId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $commit.Substring(0, 8)
    $archiveName = "ball-coaster-$releaseId.tar.gz"
    $archive = Join-Path ([System.IO.Path]::GetTempPath()) $archiveName
    $remoteArchive = "/tmp/$archiveName"
    & git archive --format=tar.gz "--output=$archive" HEAD; Check-Exit 'Could not package the committed source.'

    Write-Host "[INFO] Uploading release $releaseId..."
    & scp $archive "${Server}:$remoteArchive"; Check-Exit 'Upload failed.'

    $remoteScript = @"
set -euo pipefail
release='/root/BallCoaster.release-$releaseId'
current='/root/BallCoaster'
previous='/root/BallCoaster.previous-$releaseId'
archive='$remoteArchive'
rm -rf -- "`$release"
install -d -m 755 "`$release"
tar -xzf "`$archive" -C "`$release"
if [ -d "`$current" ]; then mv "`$current" "`$previous"; fi
mv "`$release" "`$current"
if ! (cd "`$current" && bash ./deploy_linux.sh '$commit'); then
  rm -rf -- "`$current"
  if [ -d "`$previous" ]; then mv "`$previous" "`$current"; fi
  rm -f -- "`$archive"
  exit 1
fi
rm -rf -- "`$previous"
rm -f -- "`$archive"
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript.Replace("`r`n", "`n")))
    & ssh -o BatchMode=yes $Server "echo $encoded | base64 -d | bash"
    Check-Exit "Production release failed. Commit $commit is saved; server rollback details are in the output."

    # what is live is really this commit, and the game and its modules answer
    $live = (Invoke-WebRequest -Uri "$siteUrl/release.txt" -UseBasicParsing -TimeoutSec 20 -Headers @{ 'Cache-Control' = 'no-cache' }).Content
    $liveText = if ($live -is [byte[]]) { [Text.Encoding]::UTF8.GetString($live) } else { [string]$live }
    if ($liveText.Trim() -ne $commit) { throw "Public release verification failed: live is '$($liveText.Trim())', expected $commit." }
    foreach ($path in @('/', '/src/main.js', '/vendor/three.module.js')) {
        $page = Invoke-WebRequest -Uri "$siteUrl$path" -UseBasicParsing -TimeoutSec 20
        if ($page.StatusCode -ne 200) { throw "$siteUrl$path returned HTTP $($page.StatusCode)." }
    }
    $where = if ($pushToGithub) { 'GitHub and production are' } else { 'Production is' }
    Write-Host "[SUCCESS] $where on $commit : $siteUrl/"
}
finally {
    if ($archive -and (Test-Path -LiteralPath $archive)) { Remove-Item -LiteralPath $archive -Force }
}
