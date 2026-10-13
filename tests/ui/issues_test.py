"""Rule issues panel (filter, accepted list), keyboard navigation and image export.
Run against a prepared sample-app copy that uses presets: ['angular-feature-sliced'] (see README.md):
    python3 issues_test.py ./ishots 4400
"""
import sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
PORT = sys.argv[2] if len(sys.argv) > 2 else '4321'
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'http://localhost:{PORT}/')
    page.wait_for_selector('#svg .shape'); time.sleep(0.6)

    # 1) issues panel: filter by rule and severity
    print('issues header:', page.inner_text('#panel h3 >> nth=1') if page.locator('#panel h3').count() > 1 else page.inner_text('#panel h3'))
    total = page.locator('#panel .viol:not(.accepted)').count()
    rules = page.locator('#issueRule option').all_inner_texts()
    print('rules in filter:', len(rules) - 1, '| cards:', total)
    page.select_option('#issueRule', index=1); time.sleep(0.3)
    print('after rule filter:', page.locator('#panel .viol:not(.accepted)').count())
    page.select_option('#issueRule', index=0); time.sleep(0.2)
    page.check('input[name="sev"][value="warn"]'); time.sleep(0.3)
    warn = page.locator('#panel .viol:not(.accepted)').count()
    print('warnings only:', warn, '| all are warnings:', page.locator('#panel .viol.warn').count() == warn)
    page.check('input[name="sev"][value="all"]'); time.sleep(0.2)
    print('accepted summary:', page.inner_text('#panel details summary') if page.locator('#panel details summary').count() else 'none')
    page.screenshot(path=f'{OUT}/i1-issues.png')

    # 2) click an issue's file link: jumps to the file
    page.locator('#panel .viol a[data-loc]').first.click(); time.sleep(1.0)
    print('after jump, panel title:', page.inner_text('#panel h2'))
    page.screenshot(path=f'{OUT}/i2-jump.png')

    # 3) keyboard: Escape up to the root, Tab to a shape, Enter opens it, / focuses search
    for _ in range(4):
        page.keyboard.press('Escape'); time.sleep(0.5)
    page.locator('#svg .shape[tabindex="0"]').first.focus()
    label = page.evaluate("document.activeElement.getAttribute('aria-label')")
    page.keyboard.press('Enter'); time.sleep(1.0)
    print('keyboard opened:', label, '| crumbs:', page.inner_text('#crumbs').replace('\n', ' '))
    page.keyboard.press('Escape'); time.sleep(0.6)
    page.keyboard.press('/')
    print('slash focuses search:', page.evaluate("document.activeElement.id"))
    page.keyboard.press('Escape')

    # 4) save the view as PNG and SVG
    page.click('#exportBtn'); time.sleep(0.2)
    with page.expect_download() as d:
        page.click('#savePng')
    png = d.value; png.save_as(f'{OUT}/i3-export.png'); print('png download:', png.suggested_filename)
    page.click('#exportBtn'); time.sleep(0.2)
    with page.expect_download() as d:
        page.click('#saveSvg')
    svg = d.value; svg.save_as(f'{OUT}/i4-export.svg'); print('svg download:', svg.suggested_filename)
    print('errors:', errors)
    b.close()
