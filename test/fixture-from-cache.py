# Свежие фикстуры для стенда: берём последний кеш плагина из LevelDB приложения.
import json
import glob

import re

files = glob.glob(r'C:/Users/user/AppData/Roaming/Hermes/Local Storage/leveldb/*')
dec = json.JSONDecoder()
best = None

PAT = re.compile(r'\{"at":\d+,"provider":"[^"]*","ok":true,"snapshot":')


def scan(text, src):
    global best
    for m in PAT.finditer(text):
        try:
            obj, end = dec.raw_decode(text[m.start():])
        except Exception as e:
            print('  decode err at', m.start(), ':', str(e)[:60])
            continue
        if isinstance(obj, dict) and obj.get('ok') and obj.get('snapshot'):
            at = obj.get('at', 0)
            if not best or at > best[0]:
                best = (at, obj, src)
                print('  candidate at', at, 'src', src)


for f in files:
    try:
        raw = open(f, 'rb').read()
    except Exception:
        continue
    for enc in ('utf-8', 'utf-16-le'):
        try:
            text = raw.decode(enc, 'ignore')
        except Exception:
            continue
        scan(text, f + ':' + enc)
        scan(text.replace('\\"', '"'), f + ':' + enc + ':unesc')

print('found:', bool(best))
if best:
    at, obj, src = best
    snap = obj['snapshot']
    import datetime
    print('fetched_at(ms -> local):', datetime.datetime.fromtimestamp(at / 1000).strftime('%Y-%m-%d %H:%M:%S'))
    with open('doc.json', 'w', encoding='utf-8') as fh:
        json.dump(snap, fh, ensure_ascii=False, indent=1)
    low = json.loads(json.dumps(snap))
    low['windows'][0]['used_percent'] = 91.0
    with open('doc-low.json', 'w', encoding='utf-8') as fh:
        json.dump(low, fh, ensure_ascii=False, indent=1)
    print('windows:', [(w['label'], w['used_percent'], w.get('resets_at')) for w in snap['windows']])
    print('ok')
