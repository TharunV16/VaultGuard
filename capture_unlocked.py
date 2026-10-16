import asyncio
from playwright.async_api import async_playwright
import urllib.request, json
import os

async def capture_authenticated_screens():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(base_dir, "docs", "screenshots")
    os.makedirs(out_dir, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1366, 'height': 820})
        page = await context.new_page()

        # Step 1: Login through the actual UI flow
        user_email = "tharun.itech@gmail.com"
        # Let's register a dedicated user with known password so login unwrap works 100%
        dedicated_email = f"report_unlocked_{os.getpid()}@vaultguard.local"
        dedicated_password = "Correct-Horse-Battery-Staple-2026!"

        print("1. Registering user...")
        await page.goto("http://localhost:5173/register", wait_until="load")
        await page.fill('input[type="email"]', dedicated_email)
        pws = await page.query_selector_all('input[type="password"]')
        await pws[0].fill(dedicated_password)
        await pws[1].fill(dedicated_password)
        await page.click('button[type="submit"]')

        # Wait for recovery key screen
        await page.wait_for_selector('div.font-mono.select-all', timeout=15000)
        rec_el = await page.query_selector('div.font-mono.select-all')
        rec_key = (await rec_el.inner_text()).strip()
        last_group = rec_key.split()[-1]
        await page.fill('input#confirmKey', last_group)
        await page.click('button:has-text("Continue to Email Verification")')

        # Get code from test hook
        await page.wait_for_timeout(1000)
        hook_url = f"http://127.0.0.1:5000/api/v1/auth/test-hook/code?email={dedicated_email}&purpose=email_verify"
        with urllib.request.urlopen(hook_url) as resp:
            data = json.loads(resp.read().decode())
            code = data.get("code")

        await page.fill('input', code)
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(2000)

        # Now Log in
        print("2. Logging in on /login...")
        await page.goto("http://localhost:5173/login", wait_until="load")
        await page.fill('input[type="email"]', dedicated_email)
        pws = await page.query_selector_all('input[type="password"]')
        await pws[0].fill(dedicated_password)
        await page.click('button[type="submit"]')

        # Wait until navigate to /app (unlocked!)
        print("Waiting for /app...")
        await page.wait_for_url("**/app**", timeout=15000)
        await page.wait_for_timeout(2000)
        print("Successfully unlocked! URL:", page.url)

        # 1. Dashboard
        print("Capturing Dashboard...")
        await page.screenshot(path=os.path.join(out_dir, "screen_1_dashboard.png"))

        # 2. Vault
        print("Capturing Vault...")
        await page.goto("http://localhost:5173/app/vault", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "screen_2_vault.png"))

        # 3. Security Center
        print("Capturing Security Center...")
        await page.goto("http://localhost:5173/app/security", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "screen_3_security.png"))

        # 4. Generator
        print("Capturing Generator...")
        await page.goto("http://localhost:5173/app/generator", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "screen_4_generator.png"))

        # 5. Send
        print("Capturing Send...")
        await page.goto("http://localhost:5173/app/send", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "screen_5_send.png"))

        # 6. Settings
        print("Capturing Settings...")
        await page.goto("http://localhost:5173/app/settings", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "screen_6_settings.png"))

        # 7. Audit
        print("Capturing Audit...")
        await page.goto("http://localhost:5173/app/audit", wait_until="load")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(out_dir, "screen_7_audit.png"))

        await browser.close()
        print("All authenticated screens captured!")

if __name__ == '__main__':
    asyncio.run(capture_authenticated_screens())
