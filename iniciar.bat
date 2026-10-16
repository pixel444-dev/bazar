@echo off
chcp 65001 >nul
title Central do Bazar
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado neste computador.
  echo Instale a versao LTS de https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
node -e "const [a, b] = process.versions.node.split('.').map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)"
if errorlevel 1 (
  echo Este sistema precisa do Node.js 22.13 ou mais novo.
  echo Instale a versao LTS de https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install --omit=dev
)

rem Clicar dentro desta janela poe o Windows no modo "Selecionar", que congela a central
rem (e todos os celulares) ate alguem apertar uma tecla. Este PowerShell fica em segundo plano
rem desligando esse modo nesta janela enquanto ela estiver aberta (o cmd religa o modo a cada
rem programa que termina, por isso ele repete a cada 2 s). Se falhar, a central liga do mesmo jeito.
start "" /b powershell -NoProfile -Command "try { $k = Add-Type -Name Janela -Namespace Bazar -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern System.IntPtr GetStdHandle(int n); [DllImport(\"kernel32.dll\")] public static extern bool GetConsoleMode(System.IntPtr h, out uint m); [DllImport(\"kernel32.dll\")] public static extern bool SetConsoleMode(System.IntPtr h, uint m);'; $h = $k::GetStdHandle(-10); $pai = (Get-CimInstance Win32_Process -Filter \"ProcessId=$PID\").ParentProcessId; while (Get-Process -Id $pai -ErrorAction SilentlyContinue) { $m = 0; if ($k::GetConsoleMode($h, [ref]$m) -and ($m -band 0x40)) { [void]$k::SetConsoleMode($h, ($m -band -bnot 0x40) -bor 0x80) }; Start-Sleep -Seconds 2 } } catch {}" >nul 2>nul

:ligar
node --disable-warning=ExperimentalWarning server.js
set CODIGO=%ERRORLEVEL%
rem 0: desligada com Ctrl+C. 2: problema que religar nao resolve (porta em uso, banco que nao abre).
rem Qualquer outro codigo e um erro inesperado: tudo esta salvo no banco, entao religa sozinha.
if "%CODIGO%"=="0" goto fim
if "%CODIGO%"=="2" goto fim
if "%CODIGO%"=="-1073741510" goto fim
echo.
echo A central parou por um erro inesperado (codigo %CODIGO%). Ligando de novo em 3 segundos...
echo Os celulares voltam a funcionar sozinhos. O erro ficou anotado em data\erros.log.
ping -n 4 127.0.0.1 >nul
goto ligar

:fim
pause
