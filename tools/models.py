#!/usr/bin/env python3
# Собирает версии модели головы из исходной assets/head.glb. Запускать после каждого нового экспорта из Blender:
#
#     python3 tools/models.py
#
# Что получится (всё в assets/):
#   head.glb       — исходная, её скрипт не меняет: компьютеры и планшеты
#   head-m.glb     — для телефонов: те же сетки байт в байт, текстура кожи 1024² вместо 2048², «заплатка» 512² вместо 1024²
#   head.glb.gz, head-m.glb.gz — они же, сжатые gzip: сайт качает сжатую и распаковывает сам (js/model.js)
#
# Нужны Python 3 и Pillow с поддержкой WebP (pip install pillow). Какую версию берёт сайт — см. js/model.js.
import sys, os, json, struct, io, gzip
from PIL import Image

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
SMALL = {'Image_Clean_v12': (1024, 86), 'SkinPatch_v3': (512, 88)}      # какие текстуры уменьшить: имя в glTF → (сторона, качество WebP)

def read(path):
    d = open(path, 'rb').read()
    magic, ver, length = struct.unpack('<4sII', d[:12])
    assert magic == b'glTF' and ver == 2 and length == len(d), 'это не glTF 2.0 (.glb)'
    jl, jt = struct.unpack('<I4s', d[12:20]); assert jt == b'JSON'
    js = json.loads(d[20:20 + jl])
    bo = 20 + jl
    bl, bt = struct.unpack('<I4s', d[bo:bo + 8]); assert bt == b'BIN\x00'
    return js, d[bo + 8:bo + 8 + bl]

def write(path, js, data):
    j = json.dumps(js, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    j += b' ' * (-len(j) % 4)
    data += b'\x00' * (-len(data) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(j) + 8 + len(data)))
        f.write(struct.pack('<I4s', len(j), b'JSON')); f.write(j)
        f.write(struct.pack('<I4s', len(data), b'BIN\x00')); f.write(data)

def smaller(raw, side, quality):
    im = Image.open(io.BytesIO(raw)).convert('RGB').resize((side, side), Image.LANCZOS)
    out = io.BytesIO(); im.save(out, 'WEBP', quality=quality, method=6)
    return out.getvalue()

def pack(src, dst):
    raw = open(src, 'rb').read()
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode='wb', compresslevel=9, mtime=0, filename='') as f: f.write(raw)
    open(dst, 'wb').write(out.getvalue())
    assert gzip.decompress(out.getvalue()) == raw
    print(f'  {os.path.basename(dst)}: {len(raw) / 1024:.0f} → {len(out.getvalue()) / 1024:.0f} КБ')

def main():
    src = os.path.join(ASSETS, 'head.glb')
    js, data = read(src)
    # всё, что лежит в основном буфере: картинки (обычные bufferView) и сжатые сетки (EXT_meshopt_compression)
    refs = []
    for i, bv in enumerate(js['bufferViews']):
        ext = (bv.get('extensions') or {}).get('EXT_meshopt_compression')
        ref = ext if ext is not None else bv
        assert ref['buffer'] == 0, 'данные лежат не в основном буфере — скрипт на такую модель не рассчитан'
        refs.append((ref.get('byteOffset', 0), ref['byteLength'], ref, i))
    refs.sort(key=lambda r: r[0])
    names = {im['bufferView']: im.get('name') for im in js.get('images', [])}
    missing = set(SMALL) - set(names.values())
    if missing: sys.exit(f'В модели нет текстур {sorted(missing)} — поправьте список SMALL в начале скрипта')
    new = bytearray()
    print('Телефонная версия:')
    for off, ln, ref, i in refs:
        chunk = data[off:off + ln]
        name = names.get(i)
        if name in SMALL:
            side, q = SMALL[name]; before = len(chunk); chunk = smaller(chunk, side, q)
            print(f'  {name}: {before / 1024:.0f} → {len(chunk) / 1024:.0f} КБ ({side}×{side})')
        new += b'\x00' * (-len(new) % 4)
        ref['byteOffset'] = len(new); ref['byteLength'] = len(chunk)
        new += chunk
    js['buffers'][0]['byteLength'] = len(new) + (-len(new) % 4)
    small = os.path.join(ASSETS, 'head-m.glb')
    write(small, js, bytes(new))
    print(f'  head-m.glb: {os.path.getsize(small) / 1024:.0f} КБ (исходная — {os.path.getsize(src) / 1024:.0f} КБ)')
    print('Сжатые версии:')
    pack(src, src + '.gz'); pack(small, small + '.gz')

if __name__ == '__main__':
    main()
