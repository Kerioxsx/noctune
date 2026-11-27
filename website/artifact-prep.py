# Makes dist/artifact.html: the host supplies the document skeleton, so the kit's <html> attributes are set by script.
import re, os, json, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist'))
s = open('index.html').read()
s = re.sub(r'<!doctype html>\s*', '', s, flags=re.I)
s = re.sub(r'<html[^>]*>', '', s, count=1)
for t in ('<head>', '</head>', '<body>', '</body>', '</html>'):
    s = s.replace(t, '', 1)
boot = '<script>(function(h){h.lang="en";h.dataset.type="software";h.dataset.radius="soft";h.dataset.buttons="arrow";h.setAttribute("data-motion","");h.style.colorScheme="dark"})(document.documentElement)</script>\n'
s = s.replace('<meta charset="utf-8">', boot, 1)
s = re.sub(r'<meta name="viewport"[^>]*>\n', '', s, count=1)
open('artifact.html', 'w').write(s)
files = sorted(os.path.relpath(os.path.join(dp, f), '.') for dp, _, fn in os.walk('.') for f in fn)
files = [f for f in files if f not in ('index.html', 'artifact.html')]
out = sys.argv[1]
json.dump(files[:240], open(f'{out}/files1.json', 'w'))
json.dump(files[240:], open(f'{out}/files2.json', 'w'))
print(len(files))
