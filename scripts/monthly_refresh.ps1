<#
.SYNOPSIS
  Monthly NPPES refresh, start to finish, with a stop before anything is written.

.DESCRIPTION
  1. Dry run: reads and validates the release. Writes nothing.
  2. You type YES to continue.
  3. Stage + apply to npi_records, sync claimed leads, rebuild registry matches,
     and flag providers renamed into the exclusion keyword list.
  4. Optional deactivation file (status / deactivation date only).
  5. Preview of flagged providers that could now be deleted. It never deletes;
     that stays a separate, explicit command (see the last lines of output).

  Never replaces leads or groups: leads only get their provider snapshot fields
  refreshed, and groups are not touched. The exclusion keyword list
  (scripts/nppes_ingest/exclude_keywords.txt) is applied automatically.

.EXAMPLE
  .\monthly_refresh.ps1 -Source "\\GGO-FILESERVER\FileServer\BD\npidata_pfile_20050523-20260809.csv" `
      -ReleaseDate 2026-08-09 -ExpectRows 9726865

.EXAMPLE
  # Only the deactivation file
  .\monthly_refresh.ps1 -DeactivationFile "C:\path\NPPES_Deactivated_NPI_Report.csv" -ReleaseDate 2026-09-08
#>
param(
  [string]$Source,
  [Parameter(Mandatory = $true)][string]$ReleaseDate,   # e.g. 2026-08-09
  [string]$Label,                                        # default: <ReleaseDate>-full
  [int]$ExpectRows,                                      # guards against a truncated file
  [string]$DeactivationFile,
  [string]$Python = "python",                            # full path to python.exe if PATH is not set
  [string]$EnvFile                                       # optional dotenv with the Supabase keys
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not $Source -and -not $DeactivationFile) {
  throw "Give -Source (the monthly full file), -DeactivationFile, or both."
}
if ($Source -and -not (Test-Path -LiteralPath $Source)) { throw "Source file not found: $Source" }
if ($DeactivationFile -and -not (Test-Path -LiteralPath $DeactivationFile)) { throw "Deactivation file not found: $DeactivationFile" }
if (-not $Label) { $Label = "$ReleaseDate-full" }

$common = @("--skip-checksum")
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

  Write-Host "Step 1/3: dry run (validates the file, writes nothing)" -ForegroundColor Yellow
  Invoke-Ingest ($full + @("--dry-run"))

  $answer = Read-Host "`nLoad this release into the database for real? Type YES to continue"
  if ($answer -cne "YES") { Write-Host "Stopped. Nothing was written."; return }

  Write-Host "`nStep 2/3: stage, apply, sync claimed leads, rebuild matches, flag excluded providers" -ForegroundColor Yellow
  Invoke-Ingest ($full + @("--apply"))
}

if ($DeactivationFile) {
  Write-Host "`nDeactivation file (status and deactivation date only)" -ForegroundColor Yellow
  Invoke-Ingest (@($DeactivationFile, "--run-type", "deactivation", "--release-date", $ReleaseDate, "--apply") + $common)
}

Write-Host "`nStep 3/3: flagged providers that could now be deleted (preview only)" -ForegroundColor Yellow
Invoke-Ingest (@("--remove-excluded") + $common)

Write-Host ""
Write-Host "Done. Nothing has been deleted." -ForegroundColor Green
Write-Host "To delete the flagged providers permanently (no undo): python -m nppes_ingest --remove-excluded --yes-delete"
Write-Host "Then in the Supabase SQL editor: vacuum analyze public.npi_records;"
