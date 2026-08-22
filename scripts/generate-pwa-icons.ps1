Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconsDirectory = Join-Path $projectRoot 'public\icons'
[System.IO.Directory]::CreateDirectory($iconsDirectory) | Out-Null

function New-NawasrahIcon {
  param(
    [Parameter(Mandatory = $true)][int]$Size,
    [Parameter(Mandatory = $true)][string]$FileName
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $canvas = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $canvas,
    [System.Drawing.Color]::FromArgb(37, 99, 235),
    [System.Drawing.Color]::FromArgb(2, 6, 23),
    45.0
  )
  $graphics.FillRectangle($background, $canvas)

  $glowMargin = [int]($Size * 0.12)
  $glowBrush = New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(45, 255, 255, 255)
  )
  $graphics.FillEllipse(
    $glowBrush,
    $glowMargin,
    $glowMargin,
    $Size - (2 * $glowMargin),
    $Size - (2 * $glowMargin)
  )

  $lineWidth = [single]($Size * 0.055)
  $whitePen = New-Object System.Drawing.Pen(
    [System.Drawing.Color]::FromArgb(248, 250, 252),
    $lineWidth
  )
  $whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $whitePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  [System.Drawing.PointF[]]$roof = @(
    (New-Object System.Drawing.PointF([single]($Size * 0.22), [single]($Size * 0.43))),
    (New-Object System.Drawing.PointF([single]($Size * 0.50), [single]($Size * 0.24))),
    (New-Object System.Drawing.PointF([single]($Size * 0.78), [single]($Size * 0.43)))
  )
  $graphics.DrawLines($whitePen, $roof)

  $left = [single]($Size * 0.28)
  $top = [single]($Size * 0.43)
  $width = [single]($Size * 0.44)
  $height = [single]($Size * 0.34)
  $graphics.DrawRectangle($whitePen, $left, $top, $width, $height)

  $doorTop = [single]($Size * 0.55)
  $doorBottom = [single]($Size * 0.77)
  foreach ($xRatio in @(0.40, 0.50, 0.60)) {
    $x = [single]($Size * $xRatio)
    $graphics.DrawLine($whitePen, $x, $doorTop, $x, $doorBottom)
  }

  $accentBrush = New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(16, 185, 129)
  )
  $accentSize = [single]($Size * 0.11)
  $graphics.FillEllipse(
    $accentBrush,
    [single]($Size * 0.68),
    [single]($Size * 0.67),
    $accentSize,
    $accentSize
  )

  $outputPath = Join-Path $iconsDirectory $FileName
  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $accentBrush.Dispose()
  $whitePen.Dispose()
  $glowBrush.Dispose()
  $background.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-NawasrahIcon -Size 180 -FileName 'apple-touch-icon-180.png'
New-NawasrahIcon -Size 192 -FileName 'admin-icon-192.png'
New-NawasrahIcon -Size 512 -FileName 'admin-icon-512.png'
