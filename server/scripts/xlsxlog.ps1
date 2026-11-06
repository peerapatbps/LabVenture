# Finish the CAR log (สบค-09) layout with Excel itself, then save as .xlsx or export .pdf. Used by services/officePdf.js
# Rows First..First+Count-1 hold CARs, followed by Spare blank form rows.
#  1. autofit the CAR rows (wrapped Thai text — only Excel knows the real line breaks), never lower than the form's 23.1pt
#  2. page break whenever the next row would overflow PagePt (the form's data height); header rows repeat (print titles)
#  3. keep just enough blank rows to fill the last page, delete the rest; thin top/bottom edge on each page, like the form
param([string]$In, [string]$Out, [string]$Fmt, [int]$First, [int]$Count, [int]$Spare, [double]$PagePt)
$ErrorActionPreference = 'Stop'
$RowPt = 23.1
$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $wb = $xl.Workbooks.Open($In)
  $ws = $wb.Worksheets.Item(1)

  $pageStarts = @($First)
  $pageEnds = @()
  $used = 0.0
  if ($Count -gt 0) {
    [void]$ws.Range("A$($First):L$($First + $Count - 1)").Rows.AutoFit()
    for ($r = $First; $r -lt $First + $Count; $r++) {
      $row = $ws.Rows.Item($r)
      if ($row.RowHeight -lt $RowPt) { $row.RowHeight = $RowPt }
      $h = [double]$row.RowHeight
      if ($used -gt 0 -and ($used + $h) -gt ($PagePt + 0.01)) {
        [void]$ws.HPageBreaks.Add($ws.Rows.Item($r))
        $pageEnds += ($r - 1)
        $pageStarts += $r
        $used = 0.0
      }
      $used += $h
    }
  }

  # blank form rows to the end of the last page
  $keep = [math]::Floor(($PagePt - $used) / $RowPt + 0.001)
  $lastRow = $First + $Count + $keep - 1
  $spareEnd = $First + $Count + $Spare - 1
  if ($lastRow -lt $spareEnd) { [void]$ws.Range("A$($lastRow + 1):A$spareEnd").EntireRow.Delete() }
  $pageEnds += $lastRow

  foreach ($r in $pageStarts) { $b = $ws.Range("A$($r):L$($r)").Borders.Item(8); $b.LineStyle = 1; $b.Weight = 2 }  # top: thin
  foreach ($r in $pageEnds) { $b = $ws.Range("A$($r):L$($r)").Borders.Item(9); $b.LineStyle = 1; $b.Weight = 2 }    # bottom: thin
  $ws.PageSetup.PrintArea = "`$A`$1:`$L`$$lastRow"
  [void]$ws.Range("A1").Select()

  if ($Fmt -eq 'pdf') { $wb.ExportAsFixedFormat(0, $Out) } else { $wb.SaveAs($Out, 51) }  # 51 = xlOpenXMLWorkbook
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
