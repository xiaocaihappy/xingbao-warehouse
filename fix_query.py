import sys
sys.stdout.reconfigure(encoding='utf-8')
path = r'E:\AIBC\星堡移印仓储系统\app\src\pages\Query.jsx'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Fix 1: Remove onMouseDown from all selects
for i in [266, 270, 430]:
    old = lines[i]
    lines[i] = old.replace(' onMouseDown={e => e.stopPropagation()}', '')
    print(f'Fixed line {i+1}')

# Fix 2: Replace inline styles on image X delete button with CSS class
# Lines 457-465 have the inline style block
# Replace lines 457-465 with just 'className=\
img-delete-btn\' on the button
if 'borderRadius' in lines[458]:
    lines[458] = '                          className=\img-delete-btn\\n'
    # Remove the following inline style lines (459-465)
    # They're on lines 459-465 (0-indexed)
    lines[459] = ''  # style line - ''
    
    # Let me just replace the whole inline style block
    # Find the range: from 'style={{' to the closing '}}'
    pass

print('Done')
with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Saved!')

