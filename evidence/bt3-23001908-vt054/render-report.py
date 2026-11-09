from pathlib import Path
import re
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

root = Path(__file__).parent
pdfmetrics.registerFont(TTFont('ArialVN', r'C:\Windows\Fonts\arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialVN-Bold', r'C:\Windows\Fonts\arialbd.ttf'))
styles = {
    'body': ParagraphStyle('body', fontName='ArialVN', fontSize=9.2, leading=13, spaceAfter=5),
    'title': ParagraphStyle('title', fontName='ArialVN-Bold', fontSize=17, leading=21, textColor=colors.HexColor('#17395c'), spaceAfter=10),
    'heading': ParagraphStyle('heading', fontName='ArialVN-Bold', fontSize=11.5, leading=15, textColor=colors.HexColor('#17395c'), spaceBefore=8, spaceAfter=5, keepWithNext=True),
    'table': ParagraphStyle('table', fontName='ArialVN', fontSize=7.5, leading=10),
}

def footer(canvas, doc):
    canvas.setFont('ArialVN', 8)
    canvas.setFillColor(colors.grey)
    canvas.drawString(18 * mm, 12 * mm, 'BT3 · 23001908 · VT-054')
    canvas.drawRightString(192 * mm, 12 * mm, str(doc.page))

lines = (root / 'report.md').read_text(encoding='utf-8').splitlines()
story = []
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            cells = [cell.strip() for cell in lines[i].strip().strip('|').split('|')]
            if not all(set(cell) <= set('-: ') for cell in cells):
                rows.append([Paragraph(escape(cell.replace('`', '')), styles['table']) for cell in cells])
            i += 1
        table = Table(rows, colWidths=[34 * mm, 32 * mm, 75 * mm, 33 * mm], repeatRows=1)
        table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e6eef5')), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#b8c9d7')), ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]))
        story.append(table)
        story.append(Spacer(1, 5))
        continue
    if line.startswith('# '):
        style, line = 'title', line[2:]
    elif line.startswith('## '):
        style, line = 'heading', line[3:]
    else:
        style = 'body'
    line = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', line)
    story.append(Paragraph(escape(line.replace('`', '')), styles[style]))
    i += 1

doc = SimpleDocTemplate(str(root / 'BT3_23001908_VT-054.pdf'), pagesize=(210 * mm, 297 * mm), leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=19 * mm, title='BT3 23001908 VT-054', author='Vũ Quang Nam')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
