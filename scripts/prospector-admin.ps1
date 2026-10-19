<#
.SYNOPSIS
  Prospector Admin CLI – ownership conflicts & duplicate match reviews.

.DESCRIPTION
  Drives /admin/conflicts and /admin/match-reviews without a browser.
  Session token is cached in .admin-session.json next to this script.

.EXAMPLE
  # Authenticate
  .\prospector-admin.ps1 login

  # Ownership conflicts
  .\prospector-admin.ps1 conflicts list
  .\prospector-admin.ps1 conflicts resolve --group <groupId> --to <userId> --reason "Kaity owns both"

  # Possible duplicates (leads scope, all tiers)
  .\prospector-admin.ps1 reviews list
  .\prospector-admin.ps1 reviews list --tier 3

  # All-providers registry (scope=registry, Tier 3 only by default)
  .\prospector-admin.ps1 reviews list --scope registry --tier 3

  # Merge or dismiss one pair
  .\prospector-admin.ps1 reviews resolve --left 1164389458 --right 1174405633 --decision merge   --reason "Same practice, confirmed"
  .\prospector-admin.ps1 reviews resolve --left 1164389458 --right 1174405633 --decision dismiss --reason "Different businesses"

  # Bulk merge all ownership-safe pairs (leads scope)
  .\prospector-admin.ps1 reviews bulk-merge

  # Registry: preview then run incremental merge-all
  .\prospector-admin.ps1 reviews merge-all-preview
  .\prospector-admin.ps1 reviews merge-all
#>
# Manual arg parsing so both --flag (GNU style) and -Flag (PS style) work.
$Command    = ""; $SubCommand = ""
$Group      = ""; $To         = ""
$Scope      = "leads"; $Tier = ""; $Limit = 25
$Left       = ""; $Right = ""; $Decision = ""
$Reason     = ""; $DryRun = $false
$_pos = 0; $_i = 0
while ($_i -lt $args.Count) {
    $_a = $args[$_i]
    switch -Regex ($_a) {
        '^--?(group|Group)$'    { $_i++; $Group    = $args[$_i] }
        '^--?(to|To)$'          { $_i++; $To       = $args[$_i] }
        '^--?(scope|Scope)$'    { $_i++; $Scope    = $args[$_i] }
        '^--?(tier|Tier)$'      { $_i++; $Tier     = $args[$_i] }
        '^--?(limit|Limit)$'    { $_i++; $Limit    = [int]$args[$_i] }
        '^--?(left|Left)$'      { $_i++; $Left     = $args[$_i] }
        '^--?(right|Right)$'    { $_i++; $Right    = $args[$_i] }
        '^--?(decision|Decision)$' { $_i++; $Decision = $args[$_i] }
        '^--?(reason|Reason)$'  { $_i++; $Reason   = $args[$_i] }
        '^--?(dry-run|DryRun)$' { $DryRun = $true }
        default {
            if    ($_pos -eq 0) { $Command    = $_a; $_pos++ }
            elseif($_pos -eq 1) { $SubCommand = $_a; $_pos++ }
        }
    }
    $_i++
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── config ──────────────────────────────────────────────────────────────────

$API_BASE     = "https://dmedesk-prospector-api.malakadam246.workers.dev"
$SESSION_FILE = Join-Path $PSScriptRoot ".admin-session.json"

# ── colours ─────────────────────────────────────────────────────────────────

function cGreen  { param($t) Write-Host $t -ForegroundColor Green  -NoNewline }
function cRed    { param($t) Write-Host $t -ForegroundColor Red    -NoNewline }
function cYellow { param($t) Write-Host $t -ForegroundColor Yellow -NoNewline }
function cCyan   { param($t) Write-Host $t -ForegroundColor Cyan   -NoNewline }
function cGray   { param($t) Write-Host $t -ForegroundColor Gray   -NoNewline }
function cWhite  { param($t) Write-Host $t -ForegroundColor White  -NoNewline }
function nl      { Write-Host "" }

function Banner {
    nl
    cCyan  "╔══════════════════════════════════════════╗"; nl
    cCyan  "║  "; cWhite "DME Desk Prospector Admin CLI"; cCyan "           ║"; nl
    cCyan  "╚══════════════════════════════════════════╝"; nl
    nl
}

# ── session helpers ──────────────────────────────────────────────────────────

function Load-Session {
    if (Test-Path $SESSION_FILE) {
        $s = Get-Content $SESSION_FILE -Raw | ConvertFrom-Json
        return $s
    }
    return $null
}

function Save-Session($token, $username, $displayName) {
    @{ token = $token; username = $username; displayName = $displayName } |
        ConvertTo-Json | Set-Content $SESSION_FILE -Encoding UTF8
}

function Require-Session {
    $s = Load-Session
    if (-not $s -or -not $s.token) {
        cRed "Not logged in. Run: .\prospector-admin.ps1 login"; nl
        exit 1
    }
    return $s
}

# ── HTTP helpers ─────────────────────────────────────────────────────────────

function Api-Get($path, $token, [hashtable]$Query = @{}) {
    $url = "$API_BASE/$path"
    if ($Query.Count) {
        $qs = ($Query.GetEnumerator() | ForEach-Object { "$($_.Key)=$([Uri]::EscapeDataString($_.Value))" }) -join "&"
        $url = "$url`?$qs"
    }
    $resp = Invoke-RestMethod -Uri $url -Method GET `
        -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
        -ErrorAction Stop
    if (-not $resp.success) { throw $resp.error }
    return $resp.data
}

function Api-Post($path, $token, $body) {
    $url  = "$API_BASE/$path"
    $json = $body | ConvertTo-Json -Depth 10 -Compress
    $resp = Invoke-RestMethod -Uri $url -Method POST `
        -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
        -Body $json -ErrorAction Stop
    if (-not $resp.success) { throw $resp.error }
    return $resp.data
}

# ── formatting helpers ───────────────────────────────────────────────────────

function Truncate($s, $len) {
    $s = [string]$s
    if ($s.Length -le $len) { return $s.PadRight($len) }
    return $s.Substring(0, $len - 1) + [char]0x2026
}

function DateShort($iso) {
    if (-not $iso) { return "—" }
    try { return ([datetime]$iso).ToString("yyyy-MM-dd") } catch { return $iso }
}

function HR($char = "─", $width = 72) { Write-Host ($char * $width) -ForegroundColor DarkGray }

# ═══════════════════════════════════════════════════════════════════════════
# LOGIN
# ═══════════════════════════════════════════════════════════════════════════

function Cmd-Login {
    Banner
    $username = Read-Host "Username"
    $password = Read-Host "Password" -AsSecureString
    $plain    = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))

    try {
        $resp = Invoke-RestMethod -Uri "$API_BASE/auth/login" -Method POST `
            -Headers @{ "Content-Type" = "application/json" } `
            -Body (@{ username = $username; password = $plain } | ConvertTo-Json) `
            -ErrorAction Stop
        if (-not $resp.success) { throw $resp.error }
        $d = $resp.data
        if (-not $d.isAdmin) {
            cRed "Logged in as $($d.displayName) but this account is not an admin."; nl
            exit 1
        }
        Save-Session $d.token $d.username $d.displayName
        cGreen "Logged in as $($d.displayName) (admin)"; nl
        cGray  "  Session saved to $SESSION_FILE"; nl
    } catch {
        cRed "Login failed: $_"; nl
        exit 1
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# CONFLICTS
# ═══════════════════════════════════════════════════════════════════════════

function Print-Conflict($c, $idx) {
    nl
    cCyan  "[$idx] "; cWhite $c.groupName; cGray " - $($c.groupState)"; nl
    cGray  "    Group ID : "; cWhite $c.groupId; nl
    cGray  "    Match    : "; cYellow $c.matchReason; nl
    cGray  "    Owners   : "
    foreach ($o in $c.owners) { cWhite "$($o.displayName)"; cGray " ($($o.leadCount) lead$(if($o.leadCount -ne 1){'s'}))  " }; nl
    cGray  "    Leads:"; nl
    foreach ($lead in $c.leads) {
        $name    = Truncate $lead.companyName 38
        $loc     = "$($lead.city), $($lead.state)".PadRight(18)
        $owner   = Truncate $lead.claimedByName 18
        $claimed = DateShort $lead.claimedAt
        cGray "      "; cWhite $lead.npi; cGray "  "
        cWhite $name; cGray "  $loc  "
        cYellow $owner; cGray "  $claimed"; nl
    }
}

function Cmd-Conflicts-List {
    $s = Require-Session
    Banner
    Write-Host "Fetching ownership conflicts…" -ForegroundColor Gray
    $data = Api-Get "admin/conflicts" $s.token

    if (-not $data.available) {
        cYellow "WARNING: $($data.reason)"; nl; return
    }
    if (-not $data.conflicts -or $data.conflicts.Count -eq 0) {
        cGreen "No ownership conflicts."; nl; return
    }

    cWhite "$($data.conflicts.Count) conflict(s) need a decision:"; nl
    HR
    $i = 1
    foreach ($c in $data.conflicts) { Print-Conflict $c $i; $i++ }
    HR
    nl
    cGray "Resolve with: "; cWhite ".\prospector-admin.ps1 conflicts resolve --group <groupId> --to <userId> --reason `"...`""; nl
    nl
}

function Cmd-Conflicts-Resolve {
    if (-not $Group)  { cRed "--group <groupId> is required"; nl; exit 1 }
    if (-not $To)     { cRed "--to <userId> is required (see userId in 'conflicts list')"; nl; exit 1 }
    if (-not $Reason) { cRed "--reason is required"; nl; exit 1 }

    $s    = Require-Session
    $body = @{ groupId = $Group; toUserId = $To; reason = $Reason }

    if ($DryRun) {
        cYellow "DRY RUN — would assign group $Group to user $To"; nl; return
    }

    try {
        $result = Api-Post "admin/conflicts/resolve" $s.token $body
        cGreen "Conflict resolved."; nl
        $result | ConvertTo-Json -Depth 5 | Write-Host
    } catch {
        cRed "Failed: $_"; nl; exit 1
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# MATCH REVIEWS (possible duplicates / all-providers)
# ═══════════════════════════════════════════════════════════════════════════

function Side-Line($side, $label) {
    $name    = Truncate $side.name 36
    $loc     = if ($side.city) { "$($side.city), $($side.state)" } else { $side.state }
    $loc     = $loc.PadRight(16)
    $owners  = if ($side.owners -and $side.owners.Count) {
        ($side.owners | ForEach-Object { $_.displayName }) -join ", "
    } else { "unclaimed" }
    cGray   "    $($label): "; cWhite $side.npi; cGray "  "
    cWhite  $name; cGray "  $loc  "
    cYellow $owners; nl
}

function Print-Review($r, $idx) {
    nl
    $keys = if ($r.matchedKeys -and $r.matchedKeys.Count) { $r.matchedKeys -join " + " } else { "?" }
    cCyan  "[$idx] "; cGray "Tier $($r.tier)  matched on: "; cYellow $keys; nl
    Side-Line $r.left  "L"
    Side-Line $r.right "R"
}

function Cmd-Reviews-List {
    $s     = Require-Session
    $scope = if ($Scope -eq "registry") { "registry" } else { "leads" }
    Banner
    $tierNote = if ($Tier) { ", tier=$Tier" } else { "" }
    Write-Host "Fetching match reviews (scope=$scope$tierNote)…" -ForegroundColor Gray

    $query = @{ scope = $scope; limit = [string]$Limit }
    if ($Tier) { $query["tier"] = $Tier }

    $data = Api-Get "admin/match-reviews" $s.token $query

    if (-not $data.available) {
        cYellow "WARNING: $($data.reason)"; nl; return
    }

    $reviews = $data.reviews
    if (-not $reviews -or $reviews.Count -eq 0) {
        cGreen "No pending match reviews."; nl; return
    }

    cWhite "$($reviews.Count) review(s) pending"; nl
    if ($data.hasMore) { cGray "  (showing first $Limit — use --limit to see more)"; nl }
    HR

    $i = 1
    foreach ($r in $reviews) { Print-Review $r $i; $i++ }

    HR; nl
    cGray "Merge:   "; cWhite ".\prospector-admin.ps1 reviews resolve --left <NPI> --right <NPI> --decision merge   --reason `"...`""; nl
    cGray "Dismiss: "; cWhite ".\prospector-admin.ps1 reviews resolve --left <NPI> --right <NPI> --decision dismiss --reason `"...`""; nl
    cGray "Bulk merge safe pairs: "; cWhite ".\prospector-admin.ps1 reviews bulk-merge"; nl
    nl
}

function Cmd-Reviews-Resolve {
    if (-not $Left)     { cRed "--left <NPI> is required"; nl; exit 1 }
    if (-not $Right)    { cRed "--right <NPI> is required"; nl; exit 1 }
    if ($Decision -notin @("merge","merged","dismiss","dismissed")) {
        cRed "--decision must be 'merge' or 'dismiss'"; nl; exit 1
    }
    if (-not $Reason) { cRed "--reason is required (every decision is audit-logged)"; nl; exit 1 }

    $decision = switch ($Decision) { "merge" { "merged" } "dismiss" { "dismissed" } default { $Decision } }
    $s = Require-Session

    # Try to look up tier/matchedKeys for the pair so we send complete data
    $tier = $null; $matchedKeys = $null
    try {
        $scope = if ($Scope -eq "registry") { "registry" } else { "leads" }
        $data  = Api-Get "admin/match-reviews" $s.token @{ scope = $scope; limit = "200" }
        if ($data.reviews) {
            $found = $data.reviews | Where-Object {
                ($_.leftNpi -eq $Left  -and $_.rightNpi -eq $Right) -or
                ($_.leftNpi -eq $Right -and $_.rightNpi -eq $Left)
            } | Select-Object -First 1
            if ($found) { $tier = $found.tier; $matchedKeys = $found.matchedKeys }
        }
    } catch { <# not fatal — the server accepts nulls #> }

    $body = @{
        leftNpi     = $Left
        rightNpi    = $Right
        decision    = $decision
        reason      = $Reason
        tier        = $tier
        matchedKeys = $matchedKeys
    }

    if ($DryRun) {
        cYellow "DRY RUN — would $decision pair $Left / $Right"; nl; return
    }

    try {
        $result = Api-Post "admin/match-reviews/resolve" $s.token $body
        cGreen "${decision}: $Left / $Right"; nl
        $result | ConvertTo-Json -Depth 5 | Write-Host
    } catch {
        cRed "Failed: $_"; nl; exit 1
    }
}

function Cmd-Reviews-BulkMerge {
    $s     = Require-Session
    $scope = if ($Scope -eq "registry") { "registry" } else { "leads" }
    Banner
    Write-Host "Loading match reviews for bulk merge (scope=$scope)…" -ForegroundColor Gray

    $data = Api-Get "admin/match-reviews" $s.token @{ scope = $scope; limit = "200" }
    if (-not $data.available) { cYellow "WARNING: $($data.reason)"; nl; return }

    $reviews = $data.reviews
    if (-not $reviews -or $reviews.Count -eq 0) { cGreen "Nothing to merge."; nl; return }

    # Mirror getBulkMergeEligibility: eligible when <=1 distinct owner across both sides
    $eligible = @()
    foreach ($r in $reviews) {
        $ownerIds = @()
        if ($r.left.owners)  { $ownerIds += $r.left.owners  | ForEach-Object { $_.userId } }
        if ($r.right.owners) { $ownerIds += $r.right.owners | ForEach-Object { $_.userId } }
        $distinct = $ownerIds | Sort-Object -Unique
        if ($distinct.Count -le 1) { $eligible += $r }
    }

    if ($eligible.Count -eq 0) {
        cYellow "No ownership-safe pairs (all have conflicting owners — resolve those manually)."; nl; return
    }

    cWhite "$($eligible.Count) pair(s) eligible:"; nl
    HR
    $eligible | ForEach-Object {
        cGray "  "; cWhite "$($_.left.npi)"; cGray " / "; cWhite "$($_.right.npi)"
        cGray "  Tier $($_.tier)  "
        cWhite "$($_.left.name)"; cGray " / "; cWhite "$($_.right.name)"; nl
    }
    HR

    if ($DryRun) { cYellow "DRY RUN — no changes made."; nl; return }

    $answer = Read-Host "Merge all $($eligible.Count) pair(s)? [y/N]"
    if ($answer -notmatch "^[Yy]$") { cGray "Cancelled."; nl; return }

    $pairs = $eligible | ForEach-Object {
        @{ leftNpi = $_.left.npi; rightNpi = $_.right.npi; tier = $_.tier; matchedKeys = $_.matchedKeys }
    }

    try {
        $result = Api-Post "admin/match-reviews/bulk-merge" $s.token @{ pairs = @($pairs); scope = $scope }
        $merged  = if ($result.merged)  { @($result.merged).Count  } else { 0 }
        $skipped = if ($result.skipped) { @($result.skipped).Count } else { 0 }
        $failed  = if ($result.failed)  { @($result.failed).Count  } else { 0 }
        cGreen "Merged: $merged"; cGray "  Skipped: $skipped  Failed: $failed"; nl
        if ($failed -gt 0) {
            cRed "Failures:"; nl
            $result.failed | ForEach-Object { cRed "  $($_.leftNpi)/$($_.rightNpi): $($_.reason)"; nl }
        }
    } catch {
        cRed "Failed: $_"; nl; exit 1
    }
}

function Cmd-Reviews-MergeAllPreview {
    $s = Require-Session
    Banner
    Write-Host "Counting eligible registry merges…" -ForegroundColor Gray
    try {
        $data = Api-Get "admin/match-reviews/merge-all-preview" $s.token
        cGray "Eligible to merge: "; cGreen "$($data.eligible)"; nl
        if ($data.reason) { cGray "  $($data.reason)"; nl }
    } catch {
        cRed "Failed: $_"; nl; exit 1
    }
}

function Cmd-Reviews-MergeAll {
    $s = Require-Session
    Banner

    $preview = Api-Get "admin/match-reviews/merge-all-preview" $s.token
    if ($preview.eligible -eq 0) { cGreen "No eligible registry merges."; nl; return }

    cGray "Eligible: "; cWhite "$($preview.eligible)"; nl

    if ($DryRun) { cYellow "DRY RUN — no changes made."; nl; return }

    $answer = Read-Host "Run incremental merge-all for $($preview.eligible) pair(s)? [y/N]"
    if ($answer -notmatch "^[Yy]$") { cGray "Cancelled."; nl; return }

    $after = $null; $totalMerged = 0; $batch = 0
    do {
        $body   = @{ after = $after }
        $result = Api-Post "admin/match-reviews/merge-all" $s.token $body
        $n      = if ($result.merged) { @($result.merged).Count } else { 0 }
        $totalMerged += $n; $batch++
        cGreen "  Batch $batch`: merged $n"; nl
        $after  = $result.next
    } while (-not $result.done -and $after)

    cGreen "Done — $totalMerged pair(s) merged across $batch batch(es)."; nl
}

# ═══════════════════════════════════════════════════════════════════════════
# DISPATCH
# ═══════════════════════════════════════════════════════════════════════════

# ── BATCH: all Tier 3 from both scopes in one pass ─────────────────────────

function Cmd-Reviews-Batch {
    if (-not $Reason) { cRed "--reason is required (applied to every decision, audit-logged)"; nl; exit 1 }
    if ($Decision -and $Decision -notin @("merge","merged","dismiss","dismissed")) {
        cRed "--decision must be 'merge' or 'dismiss'"; nl; exit 1
    }

    $decision = if (-not $Decision -or $Decision -eq "merge")    { "merged" } `
                elseif ($Decision -eq "dismiss") { "dismissed" } `
                else { $Decision }

    $s = Require-Session
    Banner
    Write-Host "Loading Tier 3 reviews from both scopes…" -ForegroundColor Gray

    # ── leads scope (identity_review_queue) ──────────────────────────────────
    # This view can time out when there are many rows — we warn and skip rather
    # than crashing, since the registry scope is the main source of Tier 3 pairs.
    $leadsReviews = @()
    try {
        $leadsData = Api-Get "admin/match-reviews" $s.token @{ scope = "leads"; tier = "3"; limit = "200" }
        if ($leadsData.available -and $leadsData.reviews) { $leadsReviews = @($leadsData.reviews) }
        cGray "  leads scope: $($leadsReviews.Count) pair(s)"; nl
    } catch {
        cYellow "  leads scope timed out (identity_review_queue is slow at scale) — skipping."; nl
    }

    # ── registry scope (registry_review_page RPC, paginated) ─────────────────
    $regReviews = @()
    $after = $null
    $regPage = 0
    $batchSize = if ($Limit -and $Limit -gt 0) { [Math]::Min($Limit, 50) } else { 25 }
    do {
        $query = @{ scope = "registry"; tier = "3"; limit = [string]$batchSize }
        if ($after -and $after.leftNpi -and $after.rightNpi) {
            $query["afterLeft"]  = $after.leftNpi
            $query["afterRight"] = $after.rightNpi
        }
        try {
            $regData = Api-Get "admin/match-reviews" $s.token $query
            if ($regData.available -and $regData.reviews) {
                $regReviews += @($regData.reviews)
                $regPage++
                cGray "  registry page $regPage`: $(@($regData.reviews).Count) pair(s)"; nl
            }
            $after = if ($regData.hasMore -and $regData.next) { $regData.next } else { $null }
        } catch {
            cYellow "  registry page $($regPage+1) error: $_"; nl
            if ("$_" -like "*statement timeout*") {
                cYellow "  Hint: Registry scan timed out in Supabase. Run sql/045_registry_review_speed.sql in Supabase SQL editor."; nl
            }
            $after = $null
        }
    } while ($after)
    cGray "  registry scope total: $($regReviews.Count) pair(s)"; nl

    # ── combine ──────────────────────────────────────────────────────────────
    foreach ($r in $leadsReviews) { $r | Add-Member -NotePropertyName _scope -NotePropertyValue "leads"    -Force }
    foreach ($r in $regReviews)   { $r | Add-Member -NotePropertyName _scope -NotePropertyValue "registry" -Force }

    $all = @($leadsReviews) + @($regReviews)

    if ($all.Count -eq 0) {
        cGreen "No Tier 3 reviews pending in either scope."; nl; return
    }

    nl
    cWhite "$($all.Count) Tier 3 pair(s) — will $decision all with reason: "; cYellow $Reason; nl
    HR
    $i = 1
    foreach ($r in $all) {
        $scopeLabel = if ($r._scope -eq "registry") { " [registry]" } else { " [leads]" }
        $keys = if ($r.matchedKeys -and $r.matchedKeys.Count) { $r.matchedKeys -join " + " } else { "?" }
        nl
        cCyan "[$i]$scopeLabel "; cGray "matched on: "; cYellow $keys; nl
        Side-Line $r.left  "L"
        Side-Line $r.right "R"
        $i++
    }
    HR; nl

    if ($DryRun) { cYellow "DRY RUN — $($all.Count) pair(s) would be ${decision}. No changes made."; nl; return }

    $answer = Read-Host "$decision all $($all.Count) Tier 3 pair(s)? [y/N]"
    if ($answer -notmatch "^[Yy]$") { cGray "Cancelled."; nl; return }

    $ok = 0; $fail = 0
    foreach ($r in $all) {
        $body = @{
            leftNpi     = $r.leftNpi
            rightNpi    = $r.rightNpi
            decision    = $decision
            reason      = $Reason
            tier        = $r.tier
            matchedKeys = $r.matchedKeys
        }
        try {
            Api-Post "admin/match-reviews/resolve" $s.token $body | Out-Null
            cGreen "  OK  "; cGray "$($r.leftNpi) / $($r.rightNpi)  [$($r._scope)]"; nl
            $ok++
        } catch {
            cRed "  ERR "; cGray "$($r.leftNpi) / $($r.rightNpi): $_"; nl
            $fail++
        }
    }
    nl
    cGreen "Done — ${ok} ${decision}d"
    if ($fail) { cRed ", $fail failed" }
    nl
}

function Show-Help {
    Banner
    Write-Host @"
USAGE
  .\prospector-admin.ps1 <command> [subcommand] [options]

AUTH
  login                              Authenticate and cache session token

OWNERSHIP CONFLICTS
  conflicts list                     List groups with split ownership
  conflicts resolve                  Assign a group to one owner
    --group <groupId>                  Group ID  (from 'conflicts list')
    --to    <userId>                   User ID of the winning owner
    --reason <text>                    Why (required, audit-logged)

POSSIBLE DUPLICATES / MATCH REVIEWS
  reviews list                       List pending pairs
    --scope  leads|registry            Scope (default: leads)
    --tier   2|3                       Filter to a specific tier
    --limit  <n>                       Page size (default: 25)

  reviews resolve                    Merge or dismiss one pair
    --left   <NPI>
    --right  <NPI>
    --decision merge|dismiss
    --scope  leads|registry
    --reason <text>                    Required

  reviews bulk-merge                 Merge all ownership-safe pairs
    --scope  leads|registry
    --dry-run

  reviews batch                      Batch-process ALL Tier 3 from leads + registry
    --decision merge|dismiss           Default: merge
    --reason <text>                    Required — applied to every pair
    --dry-run                          Preview without writing

  reviews merge-all-preview          Count eligible registry auto-merges
  reviews merge-all                  Run incremental registry merge-all
    --dry-run

GLOBAL
  --dry-run                          Print what would happen; write nothing
"@
}

switch ($Command) {
    "login" { Cmd-Login }
    "conflicts" {
        switch ($SubCommand) {
            "list"    { Cmd-Conflicts-List }
            "resolve" { Cmd-Conflicts-Resolve }
            default   { cRed "Unknown subcommand '$SubCommand'"; nl; Show-Help }
        }
    }
    "reviews" {
        switch ($SubCommand) {
            "list"               { Cmd-Reviews-List }
            "resolve"            { Cmd-Reviews-Resolve }
            "bulk-merge"         { Cmd-Reviews-BulkMerge }
            "batch"              { Cmd-Reviews-Batch }
            "merge-all-preview"  { Cmd-Reviews-MergeAllPreview }
            "merge-all"          { Cmd-Reviews-MergeAll }
            default              { cRed "Unknown subcommand '$SubCommand'"; nl; Show-Help }
        }
    }
    default { Show-Help }
}
