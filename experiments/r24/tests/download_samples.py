"""Download public corpus for local QA only; fail if source rows have changed."""
import json, pathlib, urllib.request
out=pathlib.Path(__file__).resolve().parents[3]/'evidence/r24'
url='https://datasets-server.huggingface.co/first-rows?dataset=PolyAI%2Fminds14&config=zh-CN&split=train'
with urllib.request.urlopen(url,timeout=30) as r: data=json.load(r)
for expected,row in zip(json.loads((out/'samples.json').read_text()),data['rows']):
    assert expected['reference']==row['row']['transcription'], 'corpus changed: stop'
    urllib.request.urlretrieve(row['row']['audio'][0]['src'],out/expected['file'])
print('Public Mandarin samples downloaded locally; no user recordings uploaded.')
