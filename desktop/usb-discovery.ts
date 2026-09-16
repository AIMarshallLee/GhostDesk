import type { UsbDiscoveryResult, UsbPort } from '../shared/types';
import type { UsbDevice } from './usb-device';

const portOk = (value: unknown): value is string => typeof value === 'string' && /^COM[1-9][0-9]{0,3}$/i.test(value);
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export interface WindowsUsbRecord { path: unknown; label: unknown; instanceId: unknown; product: unknown; manufacturer: unknown }

/** The USB product string is bus-reported; Manufacturer is retained only for display because Windows derives it from INF metadata. */
export function flowDeskPort(record: WindowsUsbRecord): UsbPort | undefined {
  const path = string(record.path).toUpperCase();
  const instanceId = string(record.instanceId);
  const product = string(record.product);
  const manufacturer = string(record.manufacturer);
  if (!portOk(path) || !/VID_CAFE&PID_4001/i.test(instanceId) || product !== 'FlowDesk USB Bridge') return undefined;
  return { path, label: string(record.label) || `${product} (${path})`, product, manufacturer };
}

export function parseFlowDeskUsbRecords(value: unknown): UsbPort[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const ports = rows.map(row => row && typeof row === 'object' ? flowDeskPort(row as WindowsUsbRecord) : undefined).filter((port): port is UsbPort => !!port);
  return [...new Map(ports.map(port => [port.path, port])).values()].sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }));
}

/**
 * Reads only PnP metadata. The initial CIM filter limits parent-property walks
 * to the firmware's VID/PID; it never opens a COM endpoint.
 */
export const windowsFlowDeskMetadataScript = String.raw`
$ports = Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_CAFE&PID_4001' -and $_.Name -match '\(COM[1-9][0-9]{0,3}\)' }
$flowDeskMatches = foreach ($port in $ports) {
  $cursor = $port.PNPDeviceID; $ids = @(); $products = @(); $makers = @()
  for ($depth = 0; $depth -lt 4 -and $cursor; $depth++) {
    $ids += $cursor
    $properties = Get-PnpDeviceProperty -InstanceId $cursor -KeyName 'DEVPKEY_Device_Parent','DEVPKEY_Device_BusReportedDeviceDesc','DEVPKEY_Device_Manufacturer' -ErrorAction SilentlyContinue
    $products += @($properties | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_BusReportedDeviceDesc' } | ForEach-Object { $_.Data })
    $makers += @($properties | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_Manufacturer' } | ForEach-Object { $_.Data })
    $cursor = ($properties | Where-Object { $_.KeyName -eq 'DEVPKEY_Device_Parent' } | Select-Object -First 1).Data
  }
  $product = @($products | Where-Object { $_ -eq 'FlowDesk USB Bridge' } | Select-Object -First 1)[0]
  $maker = @($makers | Select-Object -First 1)[0]
  if (($ids -join ';') -match 'VID_CAFE&PID_4001' -and $product -eq 'FlowDesk USB Bridge') {
    [pscustomobject]@{ path = ([regex]::Match($port.Name, 'COM[1-9][0-9]{0,3}')).Value; label = $port.Name; instanceId = ($ids -join ';'); product = $product; manufacturer = $maker }
  }
}
$flowDeskMatches | ConvertTo-Json -Compress`;

export function createUsbDiscovery(dependencies: { list(): Promise<UsbPort[]>; device: UsbDevice; canConnect?: () => boolean }) {
  let epoch = 0;
  let autoConnecting = false;
  let inflight: Promise<UsbDiscoveryResult> | undefined;
  const current = (token: number) => { if (token !== epoch) throw new Error('USB 识别已取消。'); };
  const refresh = (): Promise<UsbDiscoveryResult> => {
    if (inflight) return inflight;
    const token = ++epoch;
    const running = (async () => {
      const matches = await dependencies.list(); current(token);
      // Metadata can lag a manual connection. Probe only the already-open FlowDesk channel;
      // a real unplug updates device state and stops its active session without any reconnect.
      if (dependencies.device.state().connected) return { matches, autoConnected: false, status: await dependencies.device.status() };
      if (matches.length !== 1 || dependencies.device.busy()) return { matches, autoConnected: false };
      if (dependencies.canConnect?.() === false) return { matches, autoConnected: false };
      autoConnecting = true;
      try {
        await dependencies.device.connect(matches[0].path); current(token);
        const status = await dependencies.device.requireHealthy(); current(token);
        return { matches, autoConnected: true, status };
      } catch (error) {
        if (dependencies.device.state().port === matches[0].path) await dependencies.device.disconnect();
        throw error;
      } finally { autoConnecting = false; }
    })();
    inflight = running;
    void running.then(
      () => { if (inflight === running) inflight = undefined; },
      () => { if (inflight === running) inflight = undefined; },
    );
    return running;
  };
  return {
    refresh,
    async cancel() {
      epoch++;
      if (autoConnecting) await dependencies.device.disconnect();
      await inflight?.catch(() => {});
    },
  };
}
