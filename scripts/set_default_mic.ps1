$Source = @'
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("f8679f50-850a-41cf-9c72-430f290290c8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig {
    [PreserveSig] int GetMixFormat();
    [PreserveSig] int GetDeviceFormat();
    [PreserveSig] int ResetDeviceFormat();
    [PreserveSig] int SetDeviceFormat();
    [PreserveSig] int GetProcessingPeriod();
    [PreserveSig] int SetProcessingPeriod();
    [PreserveSig] int GetShareMode();
    [PreserveSig] int SetShareMode();
    [PreserveSig] int GetPropertyValue();
    [PreserveSig] int SetPropertyValue();
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string devId, int role);
    [PreserveSig] int SetEndpointVisibility();
}

[ComImport]
[Guid("294fc6d3-e7dc-4730-ad06-464e9a0a4ed1")]
internal class PolicyConfigClientWin11 {}

public class AudioSwitcherWin11 {
    public static int SetDefault(string devId) {
        IPolicyConfig policy = (IPolicyConfig)new PolicyConfigClientWin11();
        policy.SetDefaultEndpoint(devId, 0); // eConsole
        policy.SetDefaultEndpoint(devId, 1); // eMultimedia
        policy.SetDefaultEndpoint(devId, 2); // eCommunications
        return 0;
    }
}
'@

try {
    Add-Type -TypeDefinition $Source -Language CSharp
    $devId = "{0.0.1.00000000}.{fe81cf1b-20e2-46ac-98dc-d49127c2f2fc}"
    [AudioSwitcherWin11]::SetDefault($devId)
    Write-Output "SET_DEFAULT_OK"
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
}
