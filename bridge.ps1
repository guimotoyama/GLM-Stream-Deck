$Port = 8765

$Token = "minhasenha123"

# ----------- Descobrir IP local para mostrar no terminal -----------
try {
    $ip = (Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } |
        Select-Object -First 1 -ExpandProperty IPv4Address).IPAddress
} catch { $ip = $null }
if (-not $ip) { $ip = "127.0.0.1" }

# ----------- API do Windows para simular teclado -----------
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KeyboardSim {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$KEYEVENTF_KEYUP = 0x2

$VK = @{
    "ctrl"=0x11; "control"=0x11; "shift"=0x10; "alt"=0x12;
    "win"=0x5B; "lwin"=0x5B; "rwin"=0x5C;
    "enter"=0x0D; "esc"=0x1B; "escape"=0x1B; "tab"=0x09; "space"=0x20;
    "backspace"=0x08; "delete"=0x2E; "del"=0x2E;
    "up"=0x26; "down"=0x28; "left"=0x25; "right"=0x27;
    "home"=0x24; "end"=0x23; "pageup"=0x21; "pagedown"=0x22;
    "f1"=0x70;"f2"=0x71;"f3"=0x72;"f4"=0x73;"f5"=0x74;"f6"=0x75;
    "f7"=0x76;"f8"=0x77;"f9"=0x78;"f10"=0x79;"f11"=0x7A;"f12"=0x7B;
}

$MediaVK = @{
    "play/pause" = 0xB3
    "volume up" = 0xAF
    "volume down" = 0xAE
    "volume mute" = 0xAD
    "next track" = 0xB0
    "previous track" = 0xB1
}

function Get-VKCode($key) {
    $k = $key.ToLower().Trim()
    if ($VK.ContainsKey($k)) { return [byte]$VK[$k] }
    if ($k.Length -eq 1) { return [byte][char]$k.ToUpper() }
    return $null
}

function Send-KeyCombo($combo) {
    $parts = $combo -split "\+"
    $codes = @()
    foreach ($p in $parts) {
        $code = Get-VKCode $p
        if ($null -ne $code) { $codes += $code }
    }
    if ($codes.Count -eq 0) { return }
    foreach ($c in $codes) { [KeyboardSim]::keybd_event($c, 0, 0, [UIntPtr]::Zero) }
    [array]::Reverse($codes)
    foreach ($c in $codes) { [KeyboardSim]::keybd_event($c, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
}

function Send-Media($value) {
    $v = $value.ToLower().Trim()
    if ($MediaVK.ContainsKey($v)) {
        $code = [byte]$MediaVK[$v]
        [KeyboardSim]::keybd_event($code, 0, 0, [UIntPtr]::Zero)
        [KeyboardSim]::keybd_event($code, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    }
}

function Send-TextInput($text) {
    $escaped = $text -replace '([+^%~(){}\[\]])', '{$1}'
    [System.Windows.Forms.SendKeys]::SendWait($escaped)
}

function Invoke-OpenAction($value) {
    Start-Process $value
}

function Invoke-ShellAction($value) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $value" -WindowStyle Hidden
}

function Invoke-Action($type, $value) {
    try {
        switch ($type) {
            "key"   { Send-KeyCombo $value }
            "media" { Send-Media $value }
            "text"  { Send-TextInput $value }
            "open"  { Invoke-OpenAction $value }
            "shell" { Invoke-ShellAction $value }
            default { Write-Host "Tipo desconhecido: $type" }
        }
    } catch {
        Write-Host "Erro ao executar [$type -> $value]: $_"
    }
}

# ----------- Servidor HTTP -----------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host "ERRO ao abrir a porta $Port."
    Write-Host "Tente executar este script como Administrador."
    exit
}

Write-Host "==========================================="
Write-Host " GLM Stream Deck - bridge rodando!"
Write-Host " IP do PC:   $ip"
Write-Host " Porta:      $Port"
if ($Token -eq "") {
    Write-Host " ATENÇÃO: sem senha configurada (inseguro)."
} else {
    Write-Host " Senha protegida: SIM"
}
Write-Host "==========================================="

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $response.Headers.Add("Access-Control-Allow-Origin", "*")
    $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token")

    if ($request.HttpMethod -eq "OPTIONS") {
        $response.StatusCode = 204
        $response.Close()
        continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/ping") {
        $providedToken = $request.Headers["X-Auth-Token"]
        if ($Token -ne "" -and $providedToken -ne $Token) {
            $response.StatusCode = 401
            $response.Close()
            continue
        }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("ok")
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.Close()
        continue
    }

    if ($request.HttpMethod -eq "POST" -and $request.Url.AbsolutePath -eq "/command") {
        # ----------- Verificação de senha -----------
        $providedToken = $request.Headers["X-Auth-Token"]
        if ($Token -ne "" -and $providedToken -ne $Token) {
            Write-Host "Comando bloqueado: senha incorreta ou ausente."
            $response.StatusCode = 401
            $response.Close()
            continue
        }

        $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
        $body = $reader.ReadToEnd()
        $reader.Close()

        try {
            $data = $body | ConvertFrom-Json
            Write-Host "Comando recebido: $($data.type) -> $($data.value)"
            Invoke-Action $data.type $data.value
            $response.StatusCode = 200
        } catch {
            Write-Host "Erro ao interpretar comando: $_"
            $response.StatusCode = 400
        }

        $response.Close()
        continue
    }

    $response.StatusCode = 404
    $response.Close()
}