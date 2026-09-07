# ─────────────────────────────────────────────────────────────────────────
# Converts a single DOCX to PDF using an actual installed Microsoft Word,
# via COM automation. This is literally the same engine as opening the file
# in Word and choosing File → Save As → PDF — so header/footer positioning,
# floating images, and any other layout quirks render exactly as designed,
# with zero changes to the source document.
#
# Called from backend/utils/pdfConverter.js via child_process.
# Requires: Microsoft Word installed on this machine (Windows only).
# ─────────────────────────────────────────────────────────────────────────
param(
    [Parameter(Mandatory=$true)][string]$InputPath,
    [Parameter(Mandatory=$true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$word = $null
$doc = $null

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0        # wdAlertsNone — suppress any popup dialogs

    # Open read-only, don't touch the "recent files" list, skip format
    # conversion prompts.
    $doc = $word.Documents.Open($InputPath, $false, $true, $false)

    # wdFormatPDF = 17
    $doc.SaveAs([string]$OutputPath, 17)

    $doc.Close($false)
    $word.Quit()
    Write-Output "SUCCESS"
}
catch {
    if ($doc) { try { $doc.Close($false) } catch {} }
    if ($word) { try { $word.Quit() } catch {} }
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    # Release COM objects explicitly — Word COM automation leaks WINWORD.EXE
    # processes if these aren't released, since PowerShell's GC doesn't know
    # about COM reference counts on its own.
    if ($doc) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
    if ($word) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
