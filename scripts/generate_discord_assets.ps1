Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot | Split-Path -Parent
$outDir = Join-Path $root "discord-assets"
if (!(Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# 1. Copy icon.png (Abbadon App Logo)
$sourceIcon = Join-Path $root "build\icon.png"
$targetIcon = Join-Path $outDir "icon.png"
Copy-Item $sourceIcon $targetIcon -Force
Write-Output "Copied $targetIcon"

# 2. Generate play.png (512x512)
$bmpPlay = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gPlay = [System.Drawing.Graphics]::FromImage($bmpPlay)
$gPlay.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gPlay.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gPlay.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gPlay.Clear([System.Drawing.Color]::Transparent)

# Outer glow / halo
$glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 255, 85, 0))
$gPlay.FillEllipse($glowBrush, 24, 24, 464, 464)

# Disc background with vibrant gradient
$rectDisc = New-Object System.Drawing.Rectangle(40, 40, 432, 432)
$gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rectDisc, [System.Drawing.Color]::FromArgb(255, 255, 110, 0), [System.Drawing.Color]::FromArgb(255, 230, 45, 0), 45.0)
$gPlay.FillEllipse($gradBrush, $rectDisc)

# Sleek rim border
$penRim = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 255, 255, 255), 8)
$gPlay.DrawEllipse($penRim, 44, 44, 424, 424)

# Play Triangle (smooth, centered, optical balance)
$p1 = [System.Drawing.PointF]::new(208, 155)
$p2 = [System.Drawing.PointF]::new(368, 256)
$p3 = [System.Drawing.PointF]::new(208, 357)
[System.Drawing.PointF[]]$pts = @($p1, $p2, $p3)
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$gPlay.FillPolygon($whiteBrush, $pts)

$playPath = Join-Path $outDir "play.png"
$bmpPlay.Save($playPath, [System.Drawing.Imaging.ImageFormat]::Png)
$gPlay.Dispose()
$bmpPlay.Dispose()
Write-Output "Created $playPath"

# 3. Generate pause.png (512x512)
$bmpPause = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gPause = [System.Drawing.Graphics]::FromImage($bmpPause)
$gPause.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gPause.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gPause.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gPause.Clear([System.Drawing.Color]::Transparent)

# Outer glow
$glowDark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 255, 255))
$gPause.FillEllipse($glowDark, 24, 24, 464, 464)

# Dark obsidian disc background
$gradBrushDark = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rectDisc, [System.Drawing.Color]::FromArgb(255, 36, 36, 42), [System.Drawing.Color]::FromArgb(255, 16, 16, 20), 90.0)
$gPause.FillEllipse($gradBrushDark, $rectDisc)

# Orange accent rim
$penRimOrange = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 255, 85, 0), 8)
$gPause.DrawEllipse($penRimOrange, 44, 44, 424, 424)

# Two rounded pause bars helper
function DrawRoundedBar($g, $brush, $x, $y, $w, $h, $radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $path.Dispose()
}

DrawRoundedBar $gPause $whiteBrush 190 162 44 188 14
DrawRoundedBar $gPause $whiteBrush 278 162 44 188 14

$pausePath = Join-Path $outDir "pause.png"
$bmpPause.Save($pausePath, [System.Drawing.Imaging.ImageFormat]::Png)
$gPause.Dispose()
$bmpPause.Dispose()
Write-Output "Created $pausePath"
