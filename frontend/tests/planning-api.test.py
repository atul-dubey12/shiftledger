"""Only targets the disposable planning-test database on port 18086."""
import json
import urllib.request
import urllib.error
import uuid
BASE = 'http://localhost:18086/api'
def call(method, path, body=None, status=200, key='planning-test-key'):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), method=method,
        headers={'Content-Type': 'application/json', 'X-Api-Key': key})
    try:
        with urllib.request.urlopen(req) as r:
            code, data = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, data = e.code, e.read()
    assert code == status, (method, path, code, data)
    return json.loads(data) if data else None
call('GET', '/payouts', status=401, key='wrong')
p = call('PUT', '/payouts/2026-10-26', {'amount': 1200.25, 'date': '2026-11-02', 'version': 0})
assert p['version'] == 1
assert call('GET', '/payouts')[0] == p  # another client sees the saved record
call('PUT', '/payouts/2026-10-26', {'amount': 1, 'date': '2026-11-02', 'version': 0}, status=409)
p = call('PUT', '/payouts/2026-10-26', {'amount': 1250, 'date': '2026-11-02', 'version': 1})
assert p['version'] == 2
call('PUT', '/payouts/2026-10-26', {'amount': 1, 'date': '2026-11-02', 'version': 1}, status=409)
for amount in [-1, 1.001, 1000000000]:
    call('PUT', '/payouts/2026-10-19', {'amount': amount, 'date': '2026-10-26', 'version': 0}, status=400)
call('PUT', '/payouts/2026-10-20', {'amount': 1, 'date': '2026-10-26', 'version': 0}, status=400)
call('PUT', '/payouts/2026-10-19', {'amount': 1, 'date': '2026-10-25', 'version': 0}, status=400)
call('PUT', '/payouts/2026-10-19', {'amount': 1, 'date': '2099-10-25', 'version': 0}, status=400)
b = call('PUT', '/bike', {'odometer': 22000, 'version': 0})
assert call('GET', '/bike') == b
call('PUT', '/bike', {'odometer': 1, 'version': 0}, status=409)
call('PUT', '/bike', {'odometer': -1, 'version': 1}, status=400)
id = str(uuid.uuid4())
t = {'title': 'Oil change', 'kind': 'OIL', 'dueDate': '2026-12-01', 'dueKm': 22500, 'estimatedCost': 600, 'completedOn': None, 'actualCost': None, 'version': 0}
t = call('PUT', '/maintenance/' + id, t)
assert call('GET', '/maintenance')[0] == t
call('PUT', '/maintenance/' + id, {**t, 'version': 0}, status=409)
call('PUT', '/maintenance/' + id, {**t, 'dueDate': None, 'dueKm': None}, status=400)
call('PUT', '/maintenance/' + id, {**t, 'actualCost': 400}, status=400)
t = call('PUT', '/maintenance/' + id, {**t, 'completedOn': '2026-11-01', 'actualCost': 500})
assert t['version'] == 2
call('DELETE', '/maintenance/' + id + '?version=1', status=409)
call('DELETE', '/maintenance/' + id + '?version=2', status=204)
assert call('GET', '/maintenance') == []
assert call('GET', '/entries') == []  # payouts/maintenance never inflate ledger earnings or expenses
print('Passed: authenticated cross-client reads, payout validation, stale-write conflicts, bike readings, maintenance lifecycle, ledger separation.')
