Add-Type -AssemblyName System.Drawing

$srcPath = "c:\macros\ts-macro-app\build\macro-source.ico"
$outPath = "c:\macros\ts-macro-app\build\macro.ico"

# ── 1. Extract the 48x48 PNG from the backup ICO (entry index 2) ────────────
# macro-source.ico contains 4 correctly-rendered images from the original source.
# Entry 2 is the 48x48 image - the highest-quality original.
$raw       = [System.IO.File]::ReadAllBytes($srcPath)
$imgSize   = [BitConverter]::ToUInt32($raw, 2 * 16 + 6 + 8)   # entry[2] size field
$imgOffset = [BitConverter]::ToUInt32($raw, 2 * 16 + 6 + 12)  # entry[2] offset field
$imgBytes  = $raw[$imgOffset..($imgOffset + $imgSize - 1)]

$srcMs  = New-Object System.IO.MemoryStream(,$imgBytes)
$srcBmp = [System.Drawing.Bitmap]::FromStream($srcMs)
Write-Host "Source loaded: $($srcBmp.Width)x$($srcBmp.Height)"

# ── 3. Render each size as a PNG byte array ──────────────────────────────────
$sizes   = @(16, 32, 48, 256)
$pngList = [System.Collections.Generic.List[byte[]]]::new()

foreach ($sz in $sizes) {
    $dst = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($srcBmp, 0, 0, $sz, $sz)
    $g.Dispose()

    $pms = New-Object System.IO.MemoryStream
    $dst.Save($pms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngList.Add($pms.ToArray())
    $pms.Dispose()
    $dst.Dispose()
    Write-Host "  Rendered $sz x $sz"
}
$srcBmp.Dispose()
$srcMs.Dispose()

# ── 4. Build the multi-size ICO using MemoryStream.WriteByte / Write ─────────
$out = New-Object System.IO.MemoryStream
$n   = $sizes.Count

# ICO file header (6 bytes)
$out.Write([BitConverter]::GetBytes([uint16]0), 0, 2)   # reserved
$out.Write([BitConverter]::GetBytes([uint16]1), 0, 2)   # type = ICO
$out.Write([BitConverter]::GetBytes([uint16]$n), 0, 2)  # image count

# Data starts after: header(6) + directory(16 * n)
$dataOff = [uint32](6 + 16 * $n)

for ($i = 0; $i -lt $n; $i++) {
    $sz  = $sizes[$i]
    if ($sz -eq 256) { $dim = [byte]0 } else { $dim = [byte]$sz }

    $out.WriteByte($dim)                                                             # width
    $out.WriteByte($dim)                                                             # height
    $out.WriteByte([byte]0)                                                          # color count
    $out.WriteByte([byte]0)                                                          # reserved
    $out.Write([BitConverter]::GetBytes([uint16]1),  0, 2)                          # planes
    $out.Write([BitConverter]::GetBytes([uint16]32), 0, 2)                          # bpp
    $out.Write([BitConverter]::GetBytes([uint32]$pngList[$i].Length), 0, 4)        # data size
    $out.Write([BitConverter]::GetBytes([uint32]$dataOff), 0, 4)                   # data offset
    $dataOff += [uint32]$pngList[$i].Length
}

foreach ($png in $pngList) {
    $out.Write($png, 0, $png.Length)
}

[System.IO.File]::WriteAllBytes($outPath, $out.ToArray())
Write-Host "ICO written: $outPath ($($out.Length) bytes)"

# ── 5. Verify ────────────────────────────────────────────────────────────────
$vb  = [System.IO.File]::ReadAllBytes($outPath)
$cnt = [BitConverter]::ToUInt16($vb, 4)
Write-Host "Verified $cnt images:"
for ($i = 0; $i -lt $cnt; $i++) {
    $o  = 6 + $i * 16
    $ww = $vb[$o]
    $display = if ($ww -eq 0) { "256" } else { "$ww" }
    Write-Host "  ${display}x${display}"
}
