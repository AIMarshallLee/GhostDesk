import socket
import json
import time
import requests

UDP_PORT = 4320

def discover_workers(timeout=4.0):
    print("========================================================", flush=True)
    print(">>> 正在扫描局域网内所有 GhostDesk 电脑节点...", flush=True)
    print("========================================================", flush=True)
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", UDP_PORT))
    sock.settimeout(1.0)
    
    workers = {}
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        try:
            data, addr = sock.recvfrom(2048)
            msg = json.loads(data.decode("utf-8"))
            if msg.get("type") == "worker_online":
                ip = addr[0]
                name = msg.get("name", "Unknown")
                port = msg.get("port", 4319)
                workers[ip] = {"name": name, "ip": ip, "port": port}
        except socket.timeout:
            continue
        except Exception:
            pass

    print(f"\n[扫描完成] 发现 {len(workers)} 台在线电脑节点：")
    for ip, info in workers.items():
        print(f"  🟢 {info['name']} -> IP: {ip}:{info['port']}")
    if not workers:
        print("  ⚠️ 暂未发现局域网从机。请确保目标电脑已运行【启动集群节点】脚本并处于同一 WiFi/路由器下。")
    print("========================================================")
    return workers

def dispatch_task(worker_ip, port, action, payload):
    url = f"http://{worker_ip}:{port}/execute"
    try:
        res = requests.post(url, json={"action": action, "payload": payload}, timeout=5)
        return res.json()
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    workers = discover_workers()
