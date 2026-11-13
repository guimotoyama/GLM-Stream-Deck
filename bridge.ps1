# =========================================================
#  GLM Stream Deck - bridge.ps1
# =========================================================

# ----------- CONFIGURAÇÃO (edite aqui) -----------
$Port        = 8765
$Token       = "streamdeckglm123"   # use só letras e números; é a mesma senha digitada no app (⚙️)
$AllowShell  = $false                # $true libera o tipo de ação "Comando do sistema"
$MaxFalhas   = 5                     # senhas erradas seguidas antes de bloquear o aparelho
$BloqueioSeg = 60                    # tempo de bloqueio, em segundos

# Endereço do seu site no GitHub Pages, SEM barra no final e SEM o nome do repositório.
# Ex: se o app abre em https://joao.github.io/streamdeck/ , coloque https://joao.github.io
$AllowedOrigin = "http://localhost:5500/"

try {
    $ip = (Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } |
        Select-Object -First 1 -ExpandProperty IPv4Address).IPAddress
} catch { $ip = $null }
if (-not $ip) { $ip = "127.0.0.1" }

$hostname = $env:COMPUTERNAME

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

$VK = @{
    "ctrl"=0x11; "control"=0x11; "shift"=0x10; "alt"=0x12;
    "win"=0x5B; "lwin"=0x5B; "rwin"=0x5C;
    "enter"=0x0D; "esc"=0x1B; "escape"=0x1B; "tab"=0x09; "space"=0x20;
    "backspace"=0x08; "delete"=0x2E; "del"=0x2E; "insert"=0x2D;
    "printscreen"=0x2C; "prtsc"=0x2C;
    "up"=0x26; "down"=0x28; "left"=0x25; "right"=0x27;
    "home"=0x24; "end"=0x23; "pageup"=0x21; "pagedown"=0x22
}
# F1 a F24 (F13-F24 são ótimas para atalhos do OBS sem conflito)
1..24 | ForEach-Object { $VK["f$_"] = 0x6F + $_ }

# Teclas que o Windows exige marcar como "estendidas" (setas, Home, End, Delete...)
$Extended = @(0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5C)

$MediaVK = @{
    "play/pause"     = 0xB3
    "volume up"      = 0xAF
    "volume down"    = 0xAE
    "volume mute"    = 0xAD
    "next track"     = 0xB0
    "previous track" = 0xB1
}

function Get-VKCode($key) {
    $k = $key.ToLower().Trim()
    if ($VK.ContainsKey($k)) { return [byte]$VK[$k] }
    if ($k -match '^[a-z0-9]$') { return [byte][char]$k.ToUpper() }
    return $null
}

function Send-Key([byte]$code, [bool]$up) {
    $flags = 0
    if ($Extended -contains $code) { $flags = $flags -bor 0x1 }
    if ($up) { $flags = $flags -bor 0x2 }
    [KeyboardSim]::keybd_event($code, 0, [uint32]$flags, [UIntPtr]::Zero)
}

function Send-KeyCombo($combo) {
    $codes = @()
    foreach ($p in ($combo -split "\+")) {
        $code = Get-VKCode $p
        if ($null -eq $code) {
            # Não envia um atalho "pela metade" se alguma tecla não for reconhecida
            Write-Host "Tecla desconhecida em [$combo]: '$p'"
            return
        }
        $codes += $code
    }
    if ($codes.Count -eq 0) { return }
    foreach ($c in $codes) { Send-Key $c $false }
    Start-Sleep -Milliseconds 20
    [array]::Reverse($codes)
    foreach ($c in $codes) { Send-Key $c $true }
}

function Send-Media($value) {
    $v = $value.ToLower().Trim()
    if ($MediaVK.ContainsKey($v)) {
        Send-Key $MediaVK[$v] $false
        Send-Key $MediaVK[$v] $true
    } else {
        Write-Host "Mídia desconhecida: $value"
    }
}

function Send-TextInput($text) {
    if ($text.Length -gt 500) { Write-Host "Texto muito longo, ignorado."; return }
    $escaped = $text -replace '([+^%~(){}\[\]])', '{$1}'
    [System.Windows.Forms.SendKeys]::SendWait($escaped)
}

# Retorna o código HTTP que será devolvido ao app
function Invoke-Action($type, $value) {
    try {
        switch ($type) {
            "key"   { Send-KeyCombo $value }
            "media" { Send-Media $value }
            "text"  { Send-TextInput $value }
            "open"  { Start-Process $value }
            "shell" {
                if (-not $AllowShell) {
                    Write-Host "Comando shell bloqueado (AllowShell = `$false)."
                    return 403
                }
                Start-Process -FilePath "cmd.exe" -ArgumentList "/c $value" -WindowStyle Hidden
            }
            default {
                Write-Host "Tipo desconhecido: $type"
                return 400
            }
        }
        return 200
    } catch {
        Write-Host "Erro ao executar [$type -> $value]: $_"
        return 500
    }
}

# ----------- Segurança -----------

# Só aceita aparelhos da rede local (192.168.x.x, 10.x.x.x, 172.16-31.x.x, Tailscale etc.)
function Test-RedeLocal($addr) {
    if ([System.Net.IPAddress]::IsLoopback($addr)) { return $true }
    $b = $addr.GetAddressBytes()
    if ($b.Length -ne 4) { return ($addr.IsIPv6LinkLocal -or $addr.IsIPv6SiteLocal) }
    return (($b[0] -eq 10) -or
            ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or
            ($b[0] -eq 192 -and $b[1] -eq 168) -or
            ($b[0] -eq 169 -and $b[1] -eq 254) -or
            ($b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127))
}

# Comparação de senha em tempo constante (não vaza quantas letras acertou)
function Test-Token($provided) {
    if ($Token -eq "") { return $true }
    if ($null -eq $provided) { return $false }
    $a = [System.Text.Encoding]::UTF8.GetBytes([string]$provided)
    $b = [System.Text.Encoding]::UTF8.GetBytes($Token)
    $diff = $a.Length -bxor $b.Length
    for ($i = 0; $i -lt $b.Length; $i++) {
        $x = 0
        if ($i -lt $a.Length) { $x = $a[$i] }
        $diff = $diff -bor ($x -bxor $b[$i])
    }
    return ($diff -eq 0)
}

# Bloqueio temporário após muitas senhas erradas
$falhas = @{}

function Test-Bloqueado($remoto) {
    $f = $script:falhas[$remoto]
    return ($null -ne $f -and $f.Ate -gt (Get-Date))
}

function Registrar-Falha($remoto) {
    $f = $script:falhas[$remoto]
    if ($null -eq $f) {
        $f = @{ N = 0; Ate = [datetime]::MinValue }
        $script:falhas[$remoto] = $f
    }
    $f.N++
    if ($f.N -ge $MaxFalhas) {
        $f.Ate = (Get-Date).AddSeconds($BloqueioSeg)
        $f.N = 0
    }
}

function Limpar-Falhas($remoto) {
    $script:falhas.Remove($remoto)
}

# ----------- Servidor HTTP -----------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host "ERRO ao abrir a porta $Port (já está em uso ou falta permissão)."
    Write-Host "Permissão (uma vez, como Administrador):"
    Write-Host "  netsh http add urlacl url=http://+:$Port/ sddl=D:(A;;GX;;;WD)"
    exit
}

Write-Host "==========================================="
Write-Host " GLM Stream Deck - bridge rodando!"
Write-Host " Abra no celular um destes enderecos:"
Write-Host "   http://$($ip):$Port/"
Write-Host "   http://$($hostname):$Port/"
if ($Token -eq "") {
    Write-Host " ATENCAO: sem senha configurada (inseguro)."
} elseif ($Token -eq "troque-esta-senha") {
    Write-Host " ATENCAO: troque a senha padrao em `$Token."
} else {
    Write-Host " Senha protegida: SIM"
}
Write-Host " Comando shell: $(if ($AllowShell) { 'LIBERADO' } else { 'bloqueado' })"
if ($AllowedOrigin -like "*SEUUSUARIO*") {
    Write-Host " ATENCAO: ajuste `$AllowedOrigin com o endereco do seu GitHub Pages."
} else {
    Write-Host " Origem permitida (CORS): $AllowedOrigin"
}
Write-Host "==========================================="

# Só estes arquivos são entregues ao celular (o bridge.ps1, com a senha, nunca é servido)
$staticFiles = @{
    "/"                        = "index.html"
    "/index.html"              = "index.html"
    "/style.css"               = "style.css"
    "/script.js"               = "script.js"
    "/imagens/logo-perfil.jpg" = "imagens/logo-perfil.jpg"
    "/imagens/logo-branco.png" = "imagens/logo-branco.png"
}

$contentTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
}

while ($listener.IsListening) {
    try { $context = $listener.GetContext() } catch { break }

    $request  = $context.Request
    $response = $context.Response
    $status   = 404
    $bytes    = $null
    $tipo     = "text/plain; charset=utf-8"

    try {
        $path   = $request.Url.AbsolutePath
        $metodo = $request.HttpMethod

        # CORS: só o seu site no GitHub Pages pode chamar a API pelo navegador.
        # Os cabeçalhos vão em TODAS as respostas (inclusive 401), senão o app não consegue ler o erro.
        $origem = $request.Headers["Origin"]
        if ($origem -and $origem -eq $AllowedOrigin) {
            $response.Headers.Add("Access-Control-Allow-Origin", $AllowedOrigin)
            $response.Headers.Add("Vary", "Origin")
            $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token")
            $response.Headers.Add("Access-Control-Allow-Private-Network", "true")
            $response.Headers.Add("Access-Control-Max-Age", "600")
        }

        if (-not (Test-RedeLocal $request.RemoteEndPoint.Address)) {
            $status = 403
        }
        elseif ($metodo -eq "OPTIONS") {
            # preflight do navegador (não carrega senha; só autoriza o envio da requisição real)
            $status = 204
        }
        elseif ($metodo -eq "GET" -and $staticFiles.ContainsKey($path)) {
            # ----------- Arquivos do app -----------
            $filePath = Join-Path $PSScriptRoot $staticFiles[$path]
            if (Test-Path -LiteralPath $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $tipo = $contentTypes[$ext]
                if (-not $tipo) { $tipo = "application/octet-stream" }
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.Headers.Add("Cache-Control", "no-cache")
                $status = 200
            }
        }
        elseif ($path -eq "/ping" -or $path -eq "/command") {
            # ----------- API (exige senha) -----------
            $remoto = $request.RemoteEndPoint.Address.ToString()

            if (Test-Bloqueado $remoto) {
                $status = 429
            }
            elseif (-not (Test-Token $request.Headers["X-Auth-Token"])) {
                Registrar-Falha $remoto
                Write-Host "Acesso bloqueado: senha incorreta ou ausente ($remoto)."
                $status = 401
            }
            else {
                Limpar-Falhas $remoto

                if ($metodo -eq "GET" -and $path -eq "/ping") {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes("ok")
                    $status = 200
                }
                elseif ($metodo -eq "POST" -and $path -eq "/command") {
                    if ($request.ContentLength64 -gt 4096) {
                        $status = 413
                    } else {
                        $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                        try { $body = $reader.ReadToEnd() } finally { $reader.Close() }

                        $data = $null
                        try { $data = $body | ConvertFrom-Json } catch { $data = $null }

                        if ($null -eq $data -or -not $data.type -or $null -eq $data.value) {
                            $status = 400
                        } else {
                            Write-Host "Comando recebido: $($data.type) -> $($data.value)"
                            $status = [int](@(Invoke-Action ([string]$data.type) ([string]$data.value))[-1])
                        }
                    }
                }
            }
        }
    } catch {
        Write-Host "Erro ao tratar requisicao: $_"
        $status = 500
        $bytes = $null
    }

    # ----------- Resposta -----------
    try {
        $response.StatusCode = $status
        if ($bytes) {
            $response.ContentType = $tipo
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    } catch {
        # o celular pode ter fechado a conexão no meio; segue o loop
    } finally {
        try { $response.Close() } catch {}
    }
}
