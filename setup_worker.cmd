netsh advfirewall firewall add rule name="http 80" protocol=TCP dir=in localport=80  action=allow

echo Configuring powershell permissions

xcopy Patch node_modules /sy

echo SUCCESS
exit /b 0
