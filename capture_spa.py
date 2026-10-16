import asyncio
from playwright.async_api import async_playwright
import urllib.request, json
import os

async def capture_spa_screens():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(base_dir, "docs", "screenshots")
    os.makedirs(out_dir, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1366, 'height': 820})
        page = await context.new_page()

        email = f"spa_user_{os.getpid()}@vaultguard.local"
        password = "Correct-Horse-Battery-Staple-2026!"

        # 1. Login Page
        print("1. Capturing Login page...")
        await page.goto("http://localhost:5173/login", wait_until="load")
        await page.wait_for_timeout(800)
        await page.screenshot(path=os.path.join(out_dir, "fig_1_login.png"))

        # 2. Register Page
        print("2. Capturing Register page...")
        await page.goto("http://localhost:5173/register", wait_until="load")
        await page.fill('input[type="email"]', email)
        pws = await page.query_selector_all('input[type="password"]')
        await pws[0].fill(password)
        await pws[1].fill(password)
        await page.wait_for_timeout(800)
        await page.screenshot(path=os.path.join(out_dir, "fig_2_register.png"))

        # Submit Register
        print("Submitting register...")
        await page.click('button[type="submit"]')
        await page.wait_for_selector('div.font-mono.select-all', timeout=15000)
        rec_el = await page.query_selector('div.font-mono.select-all')
        rec_key = (await rec_el.inner_text()).strip()

        # 3. Recovery Key Page
        print("3. Capturing Recovery Key page...")
        await page.screenshot(path=os.path.join(out_dir, "fig_3_recovery_key.png"))

        last_group = rec_key.split()[-1]
        await page.fill('input#confirmKey', last_group)
        await page.wait_for_timeout(400)
        await page.click('button:has-text("Continue to Email Verification")')
        await page.wait_for_timeout(1500)

        # 4. Verify Email Page
        print("4. Capturing Verify Email page...")
        await page.screenshot(path=os.path.join(out_dir, "fig_4_verify_email.png"))

        hook_url = f"http://127.0.0.1:5000/api/v1/auth/test-hook/code?email={email}&purpose=email_verify"
        with urllib.request.urlopen(hook_url) as resp:
            data = json.loads(resp.read().decode())
            code = data.get("code")

        await page.fill('input', code)
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(2000)

        # 5. Log in
        print("Logging in...")
        await page.goto("http://localhost:5173/login", wait_until="load")
        await page.fill('input[type="email"]', email)
        pws = await page.query_selector_all('input[type="password"]')
        await pws[0].fill(password)
        await page.click('button[type="submit"]')

        # Wait until /app
        await page.wait_for_url("**/app**", timeout=15000)
        await page.wait_for_timeout(2000)
        print("Dashboard loaded!")

        # 5. Dashboard
        await page.screenshot(path=os.path.join(out_dir, "fig_5_dashboard.png"))

        # Click Sidebar links to stay in SPA memory!
        # 6. Vault
        print("Clicking Vault link...")
        await page.click('a[href="/app/vault"], button:has-text("Vault"), nav a:has-text("Vault")')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(out_dir, "fig_6_vault.png"))

        # 7. Generator
        print("Clicking Generator link...")
        await page.click('a[href="/app/generator"], nav a:has-text("Generator")')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(out_dir, "fig_7_generator.png"))

        # 8. Security Center
        print("Clicking Security link...")
        await page.click('a[href="/app/security"], nav a:has-text("Security")')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(out_dir, "fig_8_security.png"))

        # 9. Send
        print("Clicking Send link...")
        await page.click('a[href="/app/send"], nav a:has-text("Send")')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(out_dir, "fig_9_send.png"))

        # 10. Settings
        print("Clicking Settings link...")
        await page.click('a[href="/app/settings"], nav a:has-text("Settings")')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(out_dir, "fig_10_settings.png"))

        # 11. Audit Log
        print("Clicking Audit link...")
        await page.click('a[href="/app/audit"], nav a:has-text("Audit")')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(out_dir, "fig_11_audit.png"))

        await browser.close()
        print("ALL INTERIOR SPA VIEWS CAPTURED!")

if __name__ == '__main__':
    asyncio.run(capture_spa_screens())
