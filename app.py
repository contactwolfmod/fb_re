"""
Locket Gold Web — Flask Backend
================================
Người dùng chỉ cần nhập username → kích hoạt Gold tự động.
Cài đặt: pip install flask aiohttp
Chạy: python app.py
"""

import aiohttp
import json
import re
import time
import asyncio
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static")

# ==================== ⚙️ CẤU HÌNH TOKEN (chỉnh tại đây) ====================
TOKEN_CONFIG = {
    "fetch_token":    "",   # ← Điền fetch_token của bạn vào đây
    "app_transaction":"",   # ← Điền app_transaction của bạn vào đây
    "hash_params":    "",   # Tuỳ chọn
    "hash_headers":   "",   # Tuỳ chọn
    "is_sandbox":     False,
}
# =============================================================================

HEADERS = {
    'Host': 'api.revenuecat.com',
    'Authorization': 'Bearer appl_JngFETzdodyLmCREOlwTUtXdQik',
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'X-Platform': 'iOS',
    'X-Platform-Version': 'Version 26.2 (Build 23C55)',
    'X-Platform-Device': 'iPhone15,3',
    'X-Platform-Flavor': 'native',
    'X-Version': '5.41.0',
    'X-Client-Version': '2.32.2',
    'X-Client-Bundle-ID': 'com.locket.Locket',
    'X-Client-Build-Version': '3',
    'X-StoreKit2-Enabled': 'true',
    'X-StoreKit-Version': '2',
    'X-Observer-Mode-Enabled': 'false',
    'X-Is-Sandbox': 'false',
    'X-Storefront': 'VNM',
    'X-Apple-Device-Identifier': '39A73C25-1E05-4350-ADA7-5CD3FE1079E8',
    'X-Preferred-Locales': 'vi_KR,ko_KR,en_KR',
    'X-Nonce': 'w0Mlb6+AmV4WYuVv',
    'X-Is-Backgrounded': 'false',
    'X-Retry-Count': '0',
    'X-Is-Debug-Build': 'false',
    'User-Agent': 'Locket/3 CFNetwork/3860.300.31 Darwin/25.2.0',
    'Accept-Language': 'vi-VN,vi;q=0.9',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'X-RevenueCat-ETag': ''
}


# ==================== LOGIC CORE ====================

async def resolve_uid(username: str):
    """Phân giải username hoặc link Locket thành UID 28 ký tự"""
    # Nếu đã là UID 28 ký tự thì trả về luôn
    if re.match(r'^[A-Za-z0-9]{28}$', username):
        return username

    # Xử lý trường hợp URL đầy đủ: https://locket.cam/xxx
    if username.startswith('http'):
        m = re.search(r'/invites/([A-Za-z0-9]{28})', username)
        if m:
            return m.group(1)
        # Lấy phần cuối URL làm username
        username = username.rstrip('/').split('/')[-1]

    url = f"https://locket.cam/{username}"
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        "Accept": "text/html"
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, allow_redirects=True, timeout=10) as res:
                html = await res.text()
                redirect_url = str(res.url)

                def extract(text):
                    if not text:
                        return None
                    m = re.search(r'/invites/([A-Za-z0-9]{28})', text)
                    if m:
                        return m.group(1)
                    lp = re.search(r'link=([^\s"\'<>]+)', text)
                    if lp:
                        try:
                            d = lp.group(1).replace('%3A', ':').replace('%2F', '/')
                            dm = re.search(r'/invites/([A-Za-z0-9]{28})', d)
                            if dm:
                                return dm.group(1)
                        except:
                            pass
                    return None

                return extract(redirect_url) or extract(html)
    except Exception as e:
        raise RuntimeError(f"Lỗi phân giải UID: {e}")


async def check_status(uid: str):
    """Kiểm tra trạng thái Gold hiện tại của UID"""
    url = f"https://api.revenuecat.com/v1/subscribers/{uid}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=HEADERS, timeout=10) as res:
                if 200 <= res.status < 300:
                    data = await res.json()
                    ent = data.get('subscriber', {}).get('entitlements', {}).get('Gold', {})
                    if ent:
                        return {"active": True, "expires": ent.get('expires_date')}
                    return {"active": False}
                return {"active": False}
    except Exception:
        return {"active": False}


async def inject_gold(uid: str):
    """Kích hoạt Locket Gold — dùng TOKEN_CONFIG đã cấu hình sẵn"""
    url = "https://api.revenuecat.com/v1/receipts"
    token_config = TOKEN_CONFIG

    body = {
        "product_id": "locket_199_1m",
        "fetch_token": token_config['fetch_token'],
        "app_transaction": token_config['app_transaction'],
        "app_user_id": uid,
        "is_restore": True,
        "store_country": "VNM",
        "currency": "USD",
        "price": "1.99",
        "normal_duration": "P1M",
        "subscription_group_id": "21419447",
        "observer_mode": False,
        "initiation_source": "restore",
        "offers": [],
        "attributes": {
            "$attConsentStatus": {
                "updated_at_ms": int(time.time() * 1000),
                "value": "notDetermined"
            }
        }
    }

    current_headers = HEADERS.copy()
    current_headers['Content-Length'] = str(len(json.dumps(body)))
    if token_config.get('hash_params'):
        current_headers['X-Post-Params-Hash'] = token_config['hash_params']
    if token_config.get('hash_headers'):
        current_headers['X-Headers-Hash'] = token_config['hash_headers']
    current_headers['X-Is-Sandbox'] = str(token_config['is_sandbox']).lower()

    logs = []

    async with aiohttp.ClientSession() as session:
        for attempt in range(5):
            logs.append(f"[>] Lần thử {attempt + 1}/5: Đang gửi request...")
            try:
                async with session.post(url, headers=current_headers, json=body, timeout=15) as res:
                    status_code = res.status

                    if status_code == 200:
                        logs.append("[+] HTTP 200 OK. Đang xác thực quyền Gold...")
                        status = await check_status(uid)
                        if status and status.get('active'):
                            logs.append(f"[SUCCESS] Kích hoạt thành công! Hết hạn: {status.get('expires')}")
                            return {"success": True, "expires": status.get('expires'), "logs": logs}
                        await asyncio.sleep(2)
                        status = await check_status(uid)
                        if status and status.get('active'):
                            logs.append("[SUCCESS] Kích hoạt thành công sau khi chờ xác thực!")
                            return {"success": True, "expires": status.get('expires'), "logs": logs}
                        logs.append("[-] Server chấp nhận nhưng chưa cấp quyền Gold.")
                        return {"success": False, "message": "Server chấp nhận nhưng chưa cấp quyền Gold.", "logs": logs}

                    elif status_code == 529:
                        logs.append("[!] Server quá tải (529). Đang chờ 2 giây...")
                        await asyncio.sleep(2)
                        continue

                    else:
                        msg = str(status_code)
                        try:
                            resp_json = await res.json()
                            msg = resp_json.get('message', msg)
                        except:
                            pass
                        logs.append(f"[x] Bị từ chối: {msg}")
                        return {"success": False, "message": msg, "logs": logs}

            except Exception as e:
                logs.append(f"[!] Lỗi mạng: {e}")
                if attempt == 4:
                    return {"success": False, "message": str(e), "logs": logs}
                await asyncio.sleep(2)

    return {"success": False, "message": "Hết số lần thử.", "logs": logs}


def run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ==================== API ROUTES ====================

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/activate', methods=['POST'])
def api_activate():
    """
    Endpoint chính: nhận username/link → phân giải UID → kích hoạt Gold.
    Body JSON: { "username": "..." }
    """
    data = request.get_json()
    username = (data or {}).get('username', '').strip()

    if not username:
        return jsonify({"success": False, "message": "Vui lòng nhập username hoặc link Locket."}), 400

    # Kiểm tra token đã cấu hình chưa
    if not TOKEN_CONFIG.get('fetch_token'):
        return jsonify({
            "success": False,
            "message": "⚙️ Server chưa cấu hình token. Vui lòng điền fetch_token vào app.py."
        }), 500

    logs = []

    try:
        # Bước 1: Phân giải UID
        logs.append(f"[>] Đang phân giải: {username}")
        uid = run_async(resolve_uid(username))

        if not uid:
            return jsonify({
                "success": False,
                "message": "Không tìm thấy UID. Kiểm tra lại username/link.",
                "logs": logs
            }), 404

        logs.append(f"[+] UID: {uid}")

        # Bước 2: Kích hoạt Gold
        result = run_async(inject_gold(uid))
        result['uid'] = uid
        result['logs'] = logs + result.get('logs', [])
        return jsonify(result)

    except Exception as e:
        logs.append(f"[!] Lỗi: {e}")
        return jsonify({"success": False, "message": str(e), "logs": logs}), 500


if __name__ == '__main__':
    print("✨ Locket Gold Web đang chạy tại http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
