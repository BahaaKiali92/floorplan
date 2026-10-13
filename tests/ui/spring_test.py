# Browser test of the bubble graph on the Spring Boot sample (sample-spring-app).
# Start the server in a prepared copy first (see README.md), then: python3 spring_test.py ./sshots [port]
import sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
PORT = sys.argv[2] if len(sys.argv) > 2 else '4321'
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

SVC = 'orders/OrderService.java'
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 900})
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'http://localhost:{PORT}/')
    page.wait_for_selector('#svg .shape'); time.sleep(0.6)
    page.screenshot(path=f'{OUT}/s1-overview.png')
    print('legend:', page.inner_text('#legend').split('\n')[0:3])
    print('stats:', page.inner_text('#stats'))

    # 1) move the misplaced service from shared/ to orders/ (pick up, open the target, "Move here")
    click_path(page, 'shared')
    page.screenshot(path=f'{OUT}/s2-shared.png')
    click_path(page, 'shared/OrderPricingService.java', 0.4)
    page.click('#pickUp'); time.sleep(0.3)
    page.locator('#crumbs button').first.click(); time.sleep(0.9)
    click_path(page, 'orders')
    page.click('#moveHere'); page.wait_for_selector('#confirm'); time.sleep(0.4)
    page.screenshot(path=f'{OUT}/s3-move-preview.png')
    body = page.inner_text('.modal .body')
    print('preview has package change:', 'package com.acme.shop.orders;' in body, '| import added:', 'import com.acme.shop.shared.Money;' in body)
    page.click('#confirm'); time.sleep(1.5)
    page.screenshot(path=f'{OUT}/s4-moved.png')
    print('toast:', page.inner_text('#toast'))
    page.click('#undo'); time.sleep(1.5)
    print('after undo:', page.inner_text('#toast'))

    # 1b) the same fix from the rule issue's "Fix" button (suggested target), then undo
    page.locator('#crumbs button').first.click(); time.sleep(0.9)
    page.locator('[data-fix="shared/OrderPricingService.java"]').first.click(); page.wait_for_selector('#confirm'); time.sleep(0.3)
    print('fix preview:', page.inner_text('.modal header'))
    page.click('#confirm'); time.sleep(1.5)
    print('fix toast:', page.inner_text('#toast'))
    page.screenshot(path=f'{OUT}/s4b-fixed.png')
    page.click('#undo'); time.sleep(1.5)

    # 2) open OrderService, select exportCsv, drag it onto the orders breadcrumb -> new class
    page.locator('#crumbs button').first.click(); time.sleep(0.9)
    page.fill('#search', 'OrderService.java'); time.sleep(0.2); page.keyboard.press('Enter'); time.sleep(1.0)
    page.screenshot(path=f'{OUT}/s5-service-open.png')
    click_path(page, SVC + '#exportCsv', 0.4)
    cb = page.locator('#crumbs button', has_text='orders').first.bounding_box()
    drag(page, center(page, SVC + '#exportCsv'), {'x': cb['x'] + cb['width'] / 2, 'y': cb['y'] + cb['height'] / 2}, f'{OUT}/s6-dragging.png')
    page.wait_for_selector('#svcName'); time.sleep(0.2)
    print('suggested name:', page.input_value('#svcName'))
    page.fill('#svcName', 'OrderExportService'); page.click('#svcOk')
    page.wait_for_selector('#copyTask'); time.sleep(0.4)
    page.screenshot(path=f'{OUT}/s7-method-preview.png')
    print('chips:', page.inner_text('.chips').replace('\n', ' | '))
    page.evaluate("document.querySelector('.modal .body').scrollTop = 99999"); time.sleep(0.2)
    page.screenshot(path=f'{OUT}/s8-method-preview-bottom.png')
    print('errors:', errors)
    b.close()
