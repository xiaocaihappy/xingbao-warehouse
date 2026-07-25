import sys
sys.stdout.reconfigure(encoding='utf-8')
path = r'E:\AIBC\星堡移印仓储系统\app\src\pages\Storage.jsx'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
print(f'Read {len(lines)} lines')
# Fix 1: HistoryInput orphaned </>
del lines[100]
print('Fix 1 done')
# Fix 2: Main component - wrap return in Fragment
lines[343] = '    <>\n'
lines.insert(345, '      <div className=\
stg-page\>\n')
print('Fix 2 done')
# Fix 3: StaffManagementModal orphaned </>
del lines[634]
print('Fix 3 done')
# Verify
orphans = [(i+1, lines[i].rstrip()) for i, l in enumerate(lines) if l.strip() == '</>']
print(f'Remaining orphaned </> count: {len(orphans)}')
for num, content in orphans:
    print(f'  Line {num}: {content}')
with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Saved!')

