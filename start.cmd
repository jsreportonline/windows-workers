netsh advfirewall firewall add rule name="http 80" protocol=TCP dir=in localport=80  action=allow
wkhtmltox-0.12.3.2_msvc2013-win64.exe /S
setx path "%path%;C:\app;C:\Program Files\wkhtmltopdf\bin" /M

"node_modules/.bin/winser" -i -a --set "AppStopMethodConsole 6000" --set "AppStopMethodWindow 1000"