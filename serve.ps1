# Minimal static file server for local preview:  powershell -File serve.ps1 [port]
param([int]$Port = 8766)
$root = $PSScriptRoot
$types = @{ ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".png" = "image/png"; ".svg" = "image/svg+xml"; ".json" = "application/json" }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
  if ($rel -eq "") { $rel = "index.html" }
  $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
  if ($path.StartsWith($root) -and (Test-Path -LiteralPath $path -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($path)
    $type = $types[[IO.Path]::GetExtension($path).ToLower()]
    if (-not $type) { $type = "application/octet-stream" }
    $ctx.Response.ContentType = $type
    $ctx.Response.Headers.Add("Cache-Control", "no-store")
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
