import asyncio
from bleak import BleakScanner

async def main():
    print("Scanning BLE devices for 5 seconds...")
    devices = await BleakScanner.discover(timeout=5.0)
    for d in devices:
        if d.name:
            print(f"Found: {d.name} ({d.address})")

if __name__ == "__main__":
    asyncio.run(main())
