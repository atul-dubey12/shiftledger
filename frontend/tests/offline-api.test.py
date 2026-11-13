import urllib.request, urllib.error, json, uuid, concurrent.futures
base='http://localhost:18085/api/entries'
draft={'type':'EXPENSE','category':'FUEL','amount':150,'date':'2026-11-13'}
def call(method,path,data=None):
    req=urllib.request.Request(base+path, data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as r:
        body=r.read()
        return json.loads(body) if body else None
path='/queued/'+str(uuid.uuid4())
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    rows=list(pool.map(lambda _:call('PUT',path,draft),range(6)))
assert len({r['id'] for r in rows})==1
assert len(call('GET',''))==1
try: call('PUT',path,dict(draft,amount=200)); raise AssertionError('Expected conflict')
except urllib.error.HTTPError as e: assert e.code==409
call('DELETE','/'+str(rows[0]['id']))
assert call('PUT',path,draft)['id']==rows[0]['id']
assert call('GET','')==[]
try: call('PUT','/queued/'+str(uuid.uuid4()),dict(draft,amount=-1)); raise AssertionError('Expected validation failure')
except urllib.error.HTTPError as e: assert e.code==400
assert call('GET','')==[]
print('Passed: six concurrent retries create once; changed payload conflicts; late retry after deletion does not resurrect; invalid draft rolls back.')
