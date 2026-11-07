#!/usr/bin/env python3
"""Bundle app/ into ONE html file (css, js, fonts inlined) that works offline by double-click."""
import base64, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
app, out = root / 'app', root / 'dist' / 'shelem-offline.html'
h = (app / 'index.html').read_text(encoding='utf-8')

def font_css():
    css = (app / 'fonts' / 'fonts.css').read_text(encoding='utf-8')
    def sub(m):
        data = base64.b64encode((app / 'fonts' / m.group(1)).read_bytes()).decode()
        return f'url(data:font/woff2;base64,{data})'
    return re.sub(r'url\(\./fonts/([^)]+)\)', sub, css)

def inline_css(m):
    href = m.group(1)
    css = font_css() if href.endswith('fonts.css') else (app / href).read_text(encoding='utf-8')
    return f'<style>\n{css}\n</style>'

def inline_js(m):
    js = (app / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script')
    return f'<script>\n{js}\n</script>'

h = re.sub(r'<link[^>]*rel="stylesheet"[^>]*href="\./([^"]+)"[^>]*>', inline_css, h)
h = re.sub(r'<link[^>]*href="\./([^"]+\.css)"[^>]*rel="stylesheet"[^>]*>', inline_css, h)
h = re.sub(r'<script src="\./([^"]+)"></script>', inline_js, h)
h = re.sub(r'<p class="offline-dl">.*?</p>', '', h, flags=re.S)
h = re.sub(r'\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>', '', h)
h = re.sub(r'<script>\s*if \("serviceWorker".*?</script>', '', h, flags=re.S)
out.write_text(h, encoding='utf-8')
left = re.findall(r'(?:src|href)="\./[^"]+"', h)
print(f'wrote {out} ({out.stat().st_size//1024} KB); unresolved local refs: {left}')
