# Renders icon-180.png, icon-192.png and icon-512.png next to this script:
# an accent-coloured (#4ADE80) dumbbell on black, matching icon.svg.
# Run once from PowerShell:  powershell -ExecutionPolicy Bypass -File .\make-icons.ps1

Add-Type -AssemblyName System.Drawing

function New-RoundedRect {
    param([float]$X, [float]$Y, [float]$W, [float]$H, [float]$R)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [Math]::Min($R * 2, [Math]::Min($W, $H))
    $path.AddArc($X, $Y, $d, $d, 180, 90)
    $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
    $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
    $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Save-Icon {
    param([int]$Size, [string]$OutPath)
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Black)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#4ADE80'))

    # Same layout as icon.svg, drawn on a 512 grid and scaled.
    $s = $Size / 512.0
    $shapes = @(
        @(150, 238, 212, 36, 10),   # handle
        @(96, 166, 44, 180, 14),    # left inner plate
        @(60, 196, 32, 120, 12),    # left outer plate
        @(372, 166, 44, 180, 14),   # right inner plate
        @(420, 196, 32, 120, 12)    # right outer plate
    )
    foreach ($r in $shapes) {
        $p = New-RoundedRect -X ($r[0] * $s) -Y ($r[1] * $s) -W ($r[2] * $s) -H ($r[3] * $s) -R ($r[4] * $s)
        $g.FillPath($brush, $p)
        $p.Dispose()
    }

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $brush.Dispose()
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Wrote $OutPath"
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($size in 180, 192, 512) {
    Save-Icon -Size $size -OutPath (Join-Path $here "icon-$size.png")
}
