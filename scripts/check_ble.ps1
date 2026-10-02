[Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime] | Out-Null

$selector = [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromDeviceName("FlowDesk Remote")
$devices = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($selector).GetResults()
if ($devices.Count -eq 0) {
    Write-Host "No paired FlowDesk Remote found via BLE selector."
} else {
    foreach ($d in $devices) {
        Write-Host "Found device: $($d.Name), Id: $($d.Id)"
        $ble = [Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($d.Id).GetResults()
        Write-Host "ConnectionStatus: $($ble.ConnectionStatus)"
    }
}
