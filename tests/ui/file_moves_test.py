import sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
SCHEME = sys.argv[2] if len(sys.argv) > 2 else 'light'
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

def crumb(page, text):
    return page.locator('#crumbs button', has_text=text).first

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1440, 'height': 900}, color_scheme=SCHEME)
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:4321/')
    page.wait_for_selector('#svg .shape'); time.sleep(0.6)
    page.screenshot(path=f'{OUT}/01-overview.png')
    if SCHEME == 'dark':
        click_path(page, 'features'); page.screenshot(path=f'{OUT}/02-features.png')
        print('errors:', errors); b.close(); sys.exit()

    click_path(page, 'features'); page.screenshot(path=f'{OUT}/02-features.png')
    click_path(page, 'features/customers'); page.screenshot(path=f'{OUT}/03-customers.png')
    print('crumbs at customers:', page.inner_text('#crumbs').replace('\n', ' '))
    page.screenshot(path=f'{OUT}/04-customers-tiles.png')

    # 1) drag and drop between visible folders
    drag(page, center(page, 'features/customers/customer-list/customer-export.service.ts'),
         center(page, 'features/customers/data-access'), f'{OUT}/05-dragging.png')
    page.wait_for_selector('#confirm'); time.sleep(0.3)
    page.screenshot(path=f'{OUT}/06-preview.png')
    print('preview:', page.inner_text('.modal header'))
    page.click('#confirm'); page.wait_for_selector('.toast'); time.sleep(0.8)
    page.screenshot(path=f'{OUT}/07-after-move.png')
    print('after move:', page.inner_text('#stats'), '|', page.inner_text('.toast'))

    # 2) undo
    page.click('#undo')
    for _ in range(50):  # the page's CSP forbids eval, so poll instead of wait_for_function
        if '2 issues' in page.inner_text('#stats'): break
        time.sleep(0.2)
    time.sleep(0.6)
    page.screenshot(path=f'{OUT}/08-after-undo.png')
    print('after undo:', page.inner_text('#stats'))

    # 3) drop onto a breadcrumb (then cancel)
    if not crumb(page, 'customers').is_disabled():
        crumb(page, 'customers').click(); time.sleep(0.9)
    cb = crumb(page, 'features').bounding_box()
    drag(page, center(page, 'features/customers/customers.routes.ts'), {'x': cb['x'] + cb['width'] / 2, 'y': cb['y'] + cb['height'] / 2}, f'{OUT}/09-crumb-drop.png')
    page.wait_for_selector('.modal header'); time.sleep(0.3)
    print('crumb drop preview:', page.inner_text('.modal header'))
    page.click('[data-close]'); time.sleep(0.3)

    # 4) pick up a deep folder and move it to a distant branch
    page.fill('#search', 'customers/ui/customer-avatar'); time.sleep(0.2); page.keyboard.press('Enter'); time.sleep(1.0)
    page.click('#pickUp'); time.sleep(0.3)
    page.screenshot(path=f'{OUT}/10-carry.png')
    crumb(page, 'src/app').click(); time.sleep(0.9)
    click_path(page, 'shared'); click_path(page, 'shared/ui')
    page.screenshot(path=f'{OUT}/11-move-here.png')
    page.click('#moveHere'); page.wait_for_selector('#confirm'); time.sleep(0.3)
    page.screenshot(path=f'{OUT}/12-carry-preview.png')
    page.click('#confirm'); page.wait_for_selector('.toast'); time.sleep(0.8)
    page.screenshot(path=f'{OUT}/13-after-carry.png')
    print('after carry move:', page.inner_text('#stats'), '|', page.inner_text('.toast'))

    # 5) edges for a file with several dependencies
    page.fill('#search', 'order-detail.comp'); time.sleep(0.2); page.keyboard.press('Enter'); time.sleep(1.0)
    page.screenshot(path=f'{OUT}/14-edges.png')
    print('errors:', errors)
    b.close()
