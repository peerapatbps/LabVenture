# xlsx -> pdf with Excel itself (same page setup / print area as the form). Used by services/carXlsx.js
param([string]$In, [string]$Out)
$ErrorActionPreference = 'Stop'
$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $wb = $xl.Workbooks.Open($In, 0, $true)
  $wb.ExportAsFixedFormat(0, $Out)  # 0 = xlTypePDF (print area + page setup of each sheet)
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
