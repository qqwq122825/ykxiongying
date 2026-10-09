$adb = "C:\Users\Administrator\AppData\Local\Android\Sdk\platform-tools\adb.exe"
& $adb -s emulator-5566 shell am force-stop com.zq.final
Start-Sleep -Seconds 2
& $adb -s emulator-5566 shell am start -n com.zq.final/com.nest.craft.spark.activity.SplashGateway
