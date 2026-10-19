<#
.SYNOPSIS
  Monthly NPPES refresh, start to finish, with a stop before anything is written.

.DESCRIPTION
  Give it the monthly zip you downloaded (or the extracted CSV). It then:
  1. Extracts only the provider file (npidata_pfile_*.csv) into a NEW empty folder.
  2. Dry run: reads and validates the release. Writes nothing.
  3. You type YES to continue.
  4. Stage + apply to npi_records, sync claimed leads, rebuild registry matches,
     and flag providers renamed into the exclusion keyword list.
  5. Optional deactivation file (status / deactivation date only).
  6. Preview of flagged providers that could now be deleted. It never deletes;
     that stays a separate, explicit command (see the last lines of output).

  Never replaces leads or groups: leads only get their provider snapshot fields
  refreshed, and groups are not touched. The exclusion keyword list
  (scripts/nppes_ingest/exclude_keywords.txt) is applied automatically.

  The release date is read from the file name (npidata_pfile_20050523-20261011.csv
  -> 2026-10-11) unless you pass -ReleaseDate.

.EXAMPLE
  .\monthly_refresh.ps1 -Zip "$HOME\Downloads\NPPES_Data_Dissemination_October_2026_V2.zip"

.EXAMPLE
  .\monthly_refresh.ps1 -Source "D:\nppes\npidata_pfile_20050523-20261011.csv" -ExpectRows 9852180

.EXAMPLE
  # Only the deactivation file
  .\monthly_refresh.ps1 -DeactivationFile "C:\path\NPPES_Deactivated_NPI_Report.csv" -ReleaseDate 2026-10-08
#>
param(
  [string]$Zip,                 # the downloaded NPPES_Data_Dissemination_*.zip
  [string]$Source,              # or the already extracted npidata_pfile_*.csv
  [string]$ReleaseDate,         # e.g. 2026-10-11; default: taken from the file name
  [string]$Label,               # default: <ReleaseDate>-full
  [int]$ExpectRows,             # guards against a truncated file (previous release's row count)
  [string]$DeactivationFile,
  [string]$Python = "python",   # full path to python.exe if PATH is not set
  [string]$EnvFile,             # optional dotenv with the Supabase keys
  [switch]$DeleteExtracted      # remove the extracted CSV (about 11 GB) when everything succeeded
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not $Zip -and -not $Source -and -not $DeactivationFile) {
  throw "Give -Zip (the downloaded monthly zip), -Source (the extracted CSV), -DeactivationFile, or a combination."
}
if ($Zip -and $Source) { throw "Use -Zip or -Source, not both." }
if ($Zip -and -not (Test-Path -LiteralPath $Zip)) { throw "Zip not found: $Zip" }
if ($Source -and -not (Test-Path -LiteralPath $Source)) { throw "Source file not found: $Source" }
if ($DeactivationFile -and -not (Test-Path -LiteralPath $DeactivationFile)) { throw "Deactivation file not found: $DeactivationFile" }

$extractedDir = $null
if ($Zip) {
  # Only the provider file is needed (about 11 GB). It goes into a new, empty folder so
  # nothing from the download is ever mixed with other files or run from there.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Zip).Path)
  try {
    $entry = $archive.Entries | Where-Object { $_.Name -match '^npidata_pfile_\d{8}-\d{8}\.csv$' } | Select-Object -First 1
    if (-not $entry) { throw "No npidata_pfile_*.csv inside $Zip. Is this the monthly full dissemination zip?" }
    $extractedDir = Join-Path $HOME ("nppes_extract_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
    if (Test-Path -LiteralPath $extractedDir) { throw "Extract folder already exists: $extractedDir" }
    New-Item -ItemType Directory -Path $extractedDir | Out-Null
    $Source = Join-Path $extractedDir $entry.Name
    Write-Host ("Extracting {0} ({1:N1} GB) to {2} ..." -f $entry.Name, ($entry.Length / 1GB), $extractedDir) -ForegroundColor Yellow
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $Source)
  } finally { $archive.Dispose() }
}

if (-not $ReleaseDate -and $Source) {
  if ((Split-Path -Leaf $Source) -match '_\d{8}-(\d{4})(\d{2})(\d{2})\.csv$') {
    $ReleaseDate = "$($Matches[1])-$($Matches[2])-$($Matches[3])"
    Write-Host "Release date from the file name: $ReleaseDate"
  }
}
if (-not $ReleaseDate) { throw "Pass -ReleaseDate (e.g. 2026-10-11); it could not be read from a file name." }
if ($ReleaseDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "-ReleaseDate must look like 2026-10-11." }
if (-not $Label) { $Label = "$ReleaseDate-full" }

$common = @()
if ($EnvFile) { $common += @("--env-file", $EnvFile) }

function Invoke-Ingest([string[]]$Arguments) {
  Write-Host ""
  Write-Host ("> python -m nppes_ingest " + ($Arguments -join " ")) -ForegroundColor Cyan
  & $Python -m nppes_ingest @Arguments
  if ($LASTEXITCODE -ne 0) { throw "nppes_ingest failed (exit code $LASTEXITCODE). Nothing further was run." }
}

if ($Source) {
  $full = @($Source, "--run-type", "monthly-full", "--release-date", $ReleaseDate, "--label", $Label) + $common
  if ($ExpectRows) { $full += @("--expect-rows", "$ExpectRows") }

  # The checksum (a minute or two on a local disk) is what stops the same file being applied
  # twice, so the real run keeps it. The dry run skips it: it only validates and writes nothing.
  Write-Host "Step 1/3: dry run (validates the file, writes nothing)" -ForegroundColor Yellow
  Invoke-Ingest ($full + @("--dry-run", "--skip-checksum"))

  $answer = Read-Host "`nLoad this release into the database for real? Type YES to continue"
  if ($answer -ne "YES") {
    Write-Host "Stopped. Nothing was written."
    if ($extractedDir) { Write-Host "The extracted file is still in $extractedDir (delete it when you no longer need it)." }
    return
  }

  Write-Host "`nStep 2/3: stage, apply, sync claimed leads, rebuild matches, flag excluded providers" -ForegroundColor Yellow
  Invoke-Ingest ($full + @("--apply"))
}

if ($DeactivationFile) {
  Write-Host "`nDeactivation file (status and deactivation date only)" -ForegroundColor Yellow
  Invoke-Ingest (@($DeactivationFile, "--run-type", "deactivation", "--release-date", $ReleaseDate, "--apply") + $common)
}

Write-Host "`nStep 3/3: flagged providers that could now be deleted (preview only)" -ForegroundColor Yellow
Invoke-Ingest (@("--remove-excluded") + $common)

if ($DeleteExtracted -and $extractedDir) {
  Remove-Item -LiteralPath $extractedDir -Recurse -Force
  Write-Host "Removed the extracted copy: $extractedDir"
} elseif ($extractedDir) {
  Write-Host "The extracted file is still in $extractedDir (about 11 GB); delete it when you no longer need it, or use -DeleteExtracted next time."
}

Write-Host ""
Write-Host "Done. Nothing has been deleted." -ForegroundColor Green
Write-Host "To delete the flagged providers permanently (no undo): python -m nppes_ingest --remove-excluded --yes-delete"
Write-Host "Then in the Supabase SQL editor: vacuum analyze public.npi_records;"
