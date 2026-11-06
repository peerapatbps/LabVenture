# docx -> pdf with Word itself (same rendering as opening the form in Word). Used by services/memoDocx.js
param([string]$In, [string]$Out)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($In, $false, $true)
  $doc.ExportAsFixedFormat($Out, 17)  # 17 = wdExportFormatPDF
  $doc.Close($false)
} finally {
  $word.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
