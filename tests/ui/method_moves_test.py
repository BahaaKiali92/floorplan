import sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
errors = []

def center(page, path):
    box = page.evaluate("""(p) => {
      const n = d3.selectAll('#svg .shape').filter(d => d.data.path === p).node();
      if (!n || getComputedStyle(n).display === 'none') return null;
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }""", path)
    if not box: raise SystemExit(f'circle not visible: {path}')
    return box

def click_path(page, path, wait=0.9):
    c = center(page, path); page.mouse.click(c['x'], c['y']); time.sleep(wait)

def drag(page, s, t, shot=None):
    page.mouse.move(s['x'], s['y']); page.mouse.down()
    for i in range(1, 25):
        page.mouse.move(s['x'] + (t['x'] - s['x']) * i / 24, s['y'] + (t['y'] - s['y']) * i / 24); time.sleep(0.02)
    if shot: page.screenshot(path=shot)
    page.mouse.up()

SVC = 'features/orders/data-access/orders.service.ts'
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 900})
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:4321/')
    page.wait_for_selector('#svg .shape'); time.sleep(0.6)
    click_path(page, 'features'); click_path(page, 'features/orders'); click_path(page, 'features/orders/data-access')
    page.screenshot(path=f'{OUT}/m1-data-access.png')
    click_path(page, SVC)
    page.screenshot(path=f'{OUT}/m2-service-open.png')
    print('crumbs:', page.inner_text('#crumbs').replace('\n', ' '))
    click_path(page, SVC + '#exportCsv', 0.4); click_path(page, SVC + '#exportPdf', 0.4)
    page.screenshot(path=f'{OUT}/m3-picked.png')
    print('panel header:', page.inner_text('#panel h3:nth-of-type(1)') if page.locator('#panel h3').count() else '')

    # drag the selection onto the data-access breadcrumb -> new service in that folder
    cb = page.locator('#crumbs button', has_text='data-access').first.bounding_box()
    drag(page, center(page, SVC + '#exportCsv'), {'x': cb['x'] + cb['width'] / 2, 'y': cb['y'] + cb['height'] / 2}, f'{OUT}/m4-dragging.png')
    page.wait_for_selector('#svcName'); time.sleep(0.2)
    print('suggested name:', page.input_value('#svcName'))
    page.fill('#svcName', 'OrderExportService'); page.click('#svcOk')
    page.wait_for_selector('#copyTask'); time.sleep(0.4)
    page.screenshot(path=f'{OUT}/m5-preview.png')
    page.evaluate("document.querySelector('.modal .body').scrollTop = 99999"); time.sleep(0.2)
    page.screenshot(path=f'{OUT}/m6-preview-bottom.png')
    print('chips:', page.inner_text('.chips').replace('\n', ' | '))
    page.click('[data-close]'); time.sleep(0.3)

    # pick up the selection and move it into another existing service (ApiBaseService)
    page.click('#methodsCarry'); time.sleep(0.3)
    page.fill('#search', 'api-base'); time.sleep(0.2); page.keyboard.press('Enter'); time.sleep(1.0)
    page.screenshot(path=f'{OUT}/m7-carry-target.png')
    page.click('#methodsHere'); page.wait_for_selector('#copyTask'); time.sleep(0.4)
    page.screenshot(path=f'{OUT}/m8-preview-existing.png')
    print('chips 2:', page.inner_text('.chips').replace('\n', ' | '))
    print('errors:', errors)
    b.close()
